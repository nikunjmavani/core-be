// Apply Postgres migration SQL into cumulative schema snapshots that match
// the normalized model from lib/parser.js: { dialect, enums, tables, relations }.
// Structural only: CREATE/ALTER/DROP TABLE & columns, FKs. RLS/indexes/functions ignored.

import fs from 'node:fs';
import path from 'node:path';

function emptySchema() {
  return { dialect: 'postgres', enums: [], tables: [], relations: [] };
}

function cloneSchema(schema) {
  return JSON.parse(JSON.stringify(schema || emptySchema()));
}

function rebuildRelations(schema) {
  const relations = [];
  for (const t of schema.tables) {
    for (const c of t.columns) {
      if (c.references?.table) {
        relations.push({
          from: t.name,
          fromColumn: c.name,
          fromKey: c.key,
          to: c.references.table,
          toColumn: c.references.column,
          onDelete: c.references.onDelete,
        });
      }
    }
  }
  schema.relations = relations;
  return schema;
}

function stripSqlComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    // dollar-quote body — keep intact
    if (c === '$') {
      const m = src.slice(i).match(/^(\$[A-Za-z0-9_]*\$)/);
      if (m) {
        const tag = m[1];
        const end = src.indexOf(tag, i + tag.length);
        if (end === -1) {
          out += src.slice(i);
          break;
        }
        out += src.slice(i, end + tag.length);
        i = end + tag.length;
        continue;
      }
    }
    if (c === "'") {
      out += c;
      i++;
      while (i < n) {
        out += src[i];
        if (src[i] === "'" && src[i + 1] === "'") {
          out += src[++i];
          i++;
          continue;
        }
        if (src[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '"') {
      out += c;
      i++;
      while (i < n) {
        out += src[i];
        if (src[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '-' && c2 === '-') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function splitStatements(src) {
  const cleaned = stripSqlComments(src).replace(/-->\s*statement-breakpoint/gi, ';');
  const stmts = [];
  let cur = '';
  let i = 0;
  const n = cleaned.length;
  while (i < n) {
    const c = cleaned[i];
    if (c === '$') {
      const m = cleaned.slice(i).match(/^(\$[A-Za-z0-9_]*\$)/);
      if (m) {
        const tag = m[1];
        const end = cleaned.indexOf(tag, i + tag.length);
        if (end === -1) {
          cur += cleaned.slice(i);
          break;
        }
        cur += cleaned.slice(i, end + tag.length);
        i = end + tag.length;
        continue;
      }
    }
    if (c === "'") {
      cur += c;
      i++;
      while (i < n) {
        cur += cleaned[i];
        if (cleaned[i] === "'" && cleaned[i + 1] === "'") {
          cur += cleaned[++i];
          i++;
          continue;
        }
        if (cleaned[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '"') {
      cur += c;
      i++;
      while (i < n) {
        cur += cleaned[i];
        if (cleaned[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === ';') {
      const t = cur.trim();
      if (t) stmts.push(t);
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  const t = cur.trim();
  if (t) stmts.push(t);
  return stmts;
}

function unquote(id) {
  if (!id) return id;
  const trimmed = id.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Parse `schema.table` / `"schema"."table"` / `table` → { schema, name } */
function parseQualifiedName(raw) {
  const s = raw.trim();
  const m = s.match(/^(?:"([^"]+)"|([A-Za-z_][\w$]*))\s*\.\s*(?:"([^"]+)"|([A-Za-z_][\w$]*))$/);
  if (m) return { schema: m[1] || m[2], name: m[3] || m[4] };
  return { schema: null, name: unquote(s) };
}

function findTable(schema, q) {
  const { schema: sch, name } = typeof q === 'string' ? parseQualifiedName(q) : q;
  if (sch) {
    const hit = schema.tables.find((t) => t.name === name && t.schema === sch);
    if (hit) return hit;
  }
  return schema.tables.find((t) => t.name === name) || null;
}

function parseTypeAndFlags(rest) {
  const input = rest.trim();
  // type may be "timestamp with time zone", "double precision", "character varying(N)"
  let type = '';
  let length = null;
  let withTimezone = false;
  let i = 0;

  const typePatterns = [
    [/^timestamp\s+with\s+time\s+zone\b/i, 'timestamp', true],
    [/^timestamptz\b/i, 'timestamp', true],
    [/^timestamp\s+without\s+time\s+zone\b/i, 'timestamp', false],
    [/^timestamp\b/i, 'timestamp', false],
    [/^time\s+with\s+time\s+zone\b/i, 'time', true],
    [/^double\s+precision\b/i, 'doublePrecision', false],
    [/^character\s+varying\b/i, 'varchar', false],
    [/^bigint\b/i, 'bigint', false],
    [/^bigserial\b/i, 'bigserial', false],
    [/^smallint\b/i, 'smallint', false],
    [/^smallserial\b/i, 'smallserial', false],
    [/^serial\b/i, 'serial', false],
    [/^integer\b/i, 'integer', false],
    [/^int\b/i, 'integer', false],
    [/^boolean\b/i, 'boolean', false],
    [/^bool\b/i, 'boolean', false],
    [/^text\b/i, 'text', false],
    [/^jsonb\b/i, 'jsonb', false],
    [/^json\b/i, 'json', false],
    [/^uuid\b/i, 'uuid', false],
    [/^date\b/i, 'date', false],
    [/^real\b/i, 'real', false],
    [/^numeric\b/i, 'numeric', false],
    [/^decimal\b/i, 'numeric', false],
    [/^varchar\b/i, 'varchar', false],
    [/^char\b/i, 'char', false],
    [/^bytea\b/i, 'bytea', false],
  ];

  let matched = false;
  for (const [re, tname, tz] of typePatterns) {
    const m = input.match(re);
    if (m) {
      type = tname;
      withTimezone = !!tz;
      i = m[0].length;
      matched = true;
      break;
    }
  }
  if (!matched) {
    const m = input.match(/^([A-Za-z_][\w$]*)/);
    if (m) {
      type = m[1].toLowerCase();
      i = m[0].length;
    } else type = 'unknown';
  }

  let after = input.slice(i).trim();
  const lenM = after.match(/^\(\s*(\d+)\s*\)/);
  if (lenM) {
    length = Number(lenM[1]);
    after = after.slice(lenM[0].length).trim();
  }

  const col = {
    key: null,
    name: null,
    type,
    isEnum: false,
    enumName: null,
    enumValues: null,
    pk: false,
    notNull: false,
    unique: false,
    array: false,
    default: null,
    references: null,
  };
  if (length != null) col.length = length;
  if (withTimezone) col.withTimezone = true;

  // flags
  const flags = after;
  if (/\bPRIMARY\s+KEY\b/i.test(flags)) {
    col.pk = true;
    col.notNull = true;
  }
  if (/\bNOT\s+NULL\b/i.test(flags)) col.notNull = true;
  if (/\bUNIQUE\b/i.test(flags)) col.unique = true;
  if (/\[\]/.test(flags.slice(0, 4))) col.array = true;

  const defM = flags.match(
    /\bDEFAULT\s+((?:'(?:[^']|'')*')|(?:"(?:[^"]|"")*")|(?:\([^)]*\))|(?:[^\s,]+(?:\s+[^\s,]+)*?)(?=\s+(?:NOT\s+NULL|NULL|PRIMARY|UNIQUE|REFERENCES|CHECK|COLLATE)|$))/i,
  );
  if (defM) {
    let d = defM[1].trim();
    // normalize common defaults
    if (/^now\(\)$/i.test(d) || /^CURRENT_TIMESTAMP$/i.test(d)) d = 'now()';
    else if (/^gen_random_uuid\(\)$/i.test(d)) d = 'random()';
    col.default = d;
  }

  const refM = flags.match(
    /\bREFERENCES\s+((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)\s*\(\s*(?:"([^"]+)"|([A-Za-z_][\w$]*))\s*\)/i,
  );
  if (refM) {
    const q = parseQualifiedName(refM[1]);
    const onDel = flags.match(
      /\bON\s+DELETE\s+(cascade|set\s+null|set\s+default|restrict|no\s+action)/i,
    );
    col.references = {
      tableVar: q.name,
      table: q.name,
      column: refM[2] || refM[3],
      onDelete: onDel ? onDel[1].toLowerCase().replace(/\s+/g, ' ') : null,
    };
  }

  return col;
}

function parseColumnDef(line) {
  const trimmed = line.trim().replace(/,\s*$/, '');
  if (!trimmed || /^(CONSTRAINT|CHECK|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY)/i.test(trimmed)) {
    return null;
  }
  const m = trimmed.match(/^(?:"([^"]+)"|([A-Za-z_][\w$]*))\s+([\s\S]+)$/);
  if (!m) return null;
  const name = m[1] || m[2];
  const col = parseTypeAndFlags(m[3]);
  col.key = name;
  col.name = name;
  return col;
}

function splitTopLevelComma(src) {
  const parts = [];
  let depth = 0;
  let cur = '';
  let str = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (str) {
      cur += c;
      if (c === str && src[i - 1] !== '\\') str = null;
      continue;
    }
    if (c === "'" || c === '"') {
      str = c;
      cur += c;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function makeTable(schemaName, tableName, columns) {
  return {
    var: tableName,
    name: tableName,
    schema: schemaName || null,
    dialect: 'pg',
    columns,
    indexes: [],
  };
}

function applyCreateTable(schema, stmt) {
  const m = stmt.match(
    /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]+?)\s*\(([\s\S]*)\)\s*$/i,
  );
  if (!m) return false;
  const q = parseQualifiedName(m[1]);
  if (findTable(schema, q)) return true; // IF NOT EXISTS
  const columns = [];
  for (const part of splitTopLevelComma(m[2])) {
    const col = parseColumnDef(part);
    if (col) columns.push(col);
    else {
      // table-level PRIMARY KEY (col)
      const pk = part.match(/^\s*PRIMARY\s+KEY\s*\(\s*([^)]+)\)/i);
      if (pk) {
        const names = pk[1].split(',').map((x) => unquote(x.trim()));
        for (const c of columns)
          if (names.includes(c.key)) {
            c.pk = true;
            c.notNull = true;
          }
      }
      const uq = part.match(/^\s*UNIQUE\s*\(\s*([^)]+)\)/i);
      if (uq) {
        const names = uq[1].split(',').map((x) => unquote(x.trim()));
        for (const c of columns) if (names.includes(c.key)) c.unique = true;
      }
      const fk = part.match(
        /FOREIGN\s+KEY\s*\(\s*(?:"([^"]+)"|([A-Za-z_][\w$]*))\s*\)\s*REFERENCES\s+((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)\s*\(\s*(?:"([^"]+)"|([A-Za-z_][\w$]*))\s*\)(?:\s*ON\s+DELETE\s+(cascade|set\s+null|set\s+default|restrict|no\s+action))?/i,
      );
      if (fk) {
        const local = fk[1] || fk[2];
        const refQ = parseQualifiedName(fk[3]);
        const c = columns.find((x) => x.key === local);
        if (c) {
          c.references = {
            tableVar: refQ.name,
            table: refQ.name,
            column: fk[4] || fk[5],
            onDelete: fk[6] ? fk[6].toLowerCase().replace(/\s+/g, ' ') : null,
          };
        }
      }
    }
  }
  schema.tables.push(makeTable(q.schema, q.name, columns));
  return true;
}

function applyDropTable(schema, stmt) {
  const m = stmt.match(/^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+?)(?:\s+CASCADE|\s+RESTRICT)?\s*$/i);
  if (!m) return false;
  // may be comma-separated
  for (const part of m[1].split(',')) {
    const q = parseQualifiedName(part.trim());
    schema.tables = schema.tables.filter(
      (t) => !(t.name === q.name && (!q.schema || t.schema === q.schema)),
    );
  }
  return true;
}

function applyAddColumn(schema, stmt) {
  const m = stmt.match(
    /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+?)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]+)$/i,
  );
  if (!m) return false;
  const table = findTable(schema, m[1]);
  if (!table) return true;
  const col = parseColumnDef(m[2]);
  if (!col) return true;
  if (table.columns.some((c) => c.key === col.key)) return true;
  table.columns.push(col);
  return true;
}

function applyDropColumn(schema, stmt) {
  const m = stmt.match(
    /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+?)\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([A-Za-z_][\w$]*))/i,
  );
  if (!m) return false;
  const table = findTable(schema, m[1]);
  if (!table) return true;
  const name = m[2] || m[3];
  table.columns = table.columns.filter((c) => c.key !== name);
  return true;
}

function applyRenameColumn(schema, stmt) {
  const m = stmt.match(
    /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+?)\s+RENAME\s+COLUMN\s+(?:"([^"]+)"|([A-Za-z_][\w$]*))\s+TO\s+(?:"([^"]+)"|([A-Za-z_][\w$]*))/i,
  );
  if (!m) return false;
  const table = findTable(schema, m[1]);
  if (!table) return true;
  const from = m[2] || m[3];
  const to = m[4] || m[5];
  const col = table.columns.find((c) => c.key === from);
  if (col) {
    col.key = to;
    col.name = to;
  }
  return true;
}

function applyRenameTable(schema, stmt) {
  const m = stmt.match(
    /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+?)\s+RENAME\s+TO\s+(?:"([^"]+)"|([A-Za-z_][\w$]*))/i,
  );
  if (!m) return false;
  if (/\bRENAME\s+COLUMN\b/i.test(stmt)) return false;
  const table = findTable(schema, m[1]);
  if (!table) return true;
  const to = m[2] || m[3];
  table.name = to;
  table.var = to;
  return true;
}

function applyAlterColumn(schema, stmt) {
  const m = stmt.match(
    /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+?)\s+ALTER\s+COLUMN\s+(?:"([^"]+)"|([A-Za-z_][\w$]*))\s+([\s\S]+)$/i,
  );
  if (!m) return false;
  const table = findTable(schema, m[1]);
  if (!table) return true;
  const col = table.columns.find((c) => c.key === (m[2] || m[3]));
  if (!col) return true;
  const rest = m[4].trim();

  const typeM = rest.match(/^TYPE\s+([\s\S]+?)(?:\s+USING\s+[\s\S]+)?$/i);
  if (typeM) {
    const parsed = parseTypeAndFlags(typeM[1]);
    col.type = parsed.type;
    if (parsed.length != null) col.length = parsed.length;
    else delete col.length;
    if (parsed.withTimezone) col.withTimezone = true;
    else delete col.withTimezone;
    return true;
  }
  if (/^SET\s+NOT\s+NULL\b/i.test(rest)) {
    col.notNull = true;
    return true;
  }
  if (/^DROP\s+NOT\s+NULL\b/i.test(rest)) {
    col.notNull = false;
    return true;
  }
  const setDef = rest.match(/^SET\s+DEFAULT\s+([\s\S]+)$/i);
  if (setDef) {
    col.default = setDef[1].trim().replace(/;$/, '');
    return true;
  }
  if (/^DROP\s+DEFAULT\b/i.test(rest)) {
    col.default = null;
    return true;
  }
  return true;
}

function applyAddForeignKey(schema, stmt) {
  // ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY (col) REFERENCES …
  const m = stmt.match(
    /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+?)\s+ADD\s+CONSTRAINT\s+(?:"[^"]+"|[A-Za-z_][\w$]*)\s+FOREIGN\s+KEY\s*\(\s*(?:"([^"]+)"|([A-Za-z_][\w$]*))\s*\)\s*REFERENCES\s+((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)\s*\(\s*(?:"([^"]+)"|([A-Za-z_][\w$]*))\s*\)(?:\s*ON\s+DELETE\s+(cascade|set\s+null|set\s+default|restrict|no\s+action))?/i,
  );
  if (!m) {
    // without constraint name
    const m2 = stmt.match(
      /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+?)\s+ADD\s+FOREIGN\s+KEY\s*\(\s*(?:"([^"]+)"|([A-Za-z_][\w$]*))\s*\)\s*REFERENCES\s+((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)\s*\(\s*(?:"([^"]+)"|([A-Za-z_][\w$]*))\s*\)(?:\s*ON\s+DELETE\s+(cascade|set\s+null|set\s+default|restrict|no\s+action))?/i,
    );
    if (!m2) return false;
    return applyFkMatch(schema, m2);
  }
  return applyFkMatch(schema, m);
}

function applyFkMatch(schema, m) {
  const table = findTable(schema, m[1]);
  if (!table) return true;
  const local = m[2] || m[3];
  const refQ = parseQualifiedName(m[4]);
  const col = table.columns.find((c) => c.key === local);
  if (col) {
    col.references = {
      tableVar: refQ.name,
      table: refQ.name,
      column: m[5] || m[6],
      onDelete: m[7] ? m[7].toLowerCase().replace(/\s+/g, ' ') : null,
    };
  }
  return true;
}

function applyStatement(schema, stmt) {
  const s = stmt.trim();
  if (!s) return false;
  // Skip non-structural noise early
  if (
    /^(CREATE|DROP|ALTER)\s+(EXTENSION|SCHEMA|ROLE|POLICY|INDEX|UNIQUE\s+INDEX|FUNCTION|PROCEDURE|TRIGGER|TYPE|VIEW|MATERIALIZED|SEQUENCE)\b/i.test(
      s,
    )
  )
    return false;
  if (
    /^GRANT\b|^REVOKE\b|^COMMENT\b|^ANALYZE\b|^VACUUM\b|^SELECT\b|^INSERT\b|^UPDATE\b|^DELETE\b|^DO\b/i.test(
      s,
    )
  )
    return false;
  if (
    /\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b|\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b|\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(
      s,
    )
  )
    return false;
  if (/\bADD\s+CONSTRAINT\b/i.test(s) && !/\bFOREIGN\s+KEY\b/i.test(s)) return false;
  if (/\bDROP\s+CONSTRAINT\b|\bVALIDATE\s+CONSTRAINT\b/i.test(s)) return false;

  if (/^CREATE\s+TABLE\b/i.test(s)) return applyCreateTable(schema, s);
  if (/^DROP\s+TABLE\b/i.test(s)) return applyDropTable(schema, s);
  if (/^ALTER\s+TABLE\b/i.test(s) && /\bADD\s+COLUMN\b/i.test(s)) return applyAddColumn(schema, s);
  if (/^ALTER\s+TABLE\b/i.test(s) && /\bDROP\s+COLUMN\b/i.test(s))
    return applyDropColumn(schema, s);
  if (/^ALTER\s+TABLE\b/i.test(s) && /\bRENAME\s+COLUMN\b/i.test(s))
    return applyRenameColumn(schema, s);
  if (/^ALTER\s+TABLE\b/i.test(s) && /\bRENAME\s+TO\b/i.test(s)) return applyRenameTable(schema, s);
  if (/^ALTER\s+TABLE\b/i.test(s) && /\bALTER\s+COLUMN\b/i.test(s))
    return applyAlterColumn(schema, s);
  if (/^ALTER\s+TABLE\b/i.test(s) && /\bFOREIGN\s+KEY\b/i.test(s))
    return applyAddForeignKey(schema, s);
  return false;
}

function schemaSignature(schema) {
  return JSON.stringify({
    tables: (schema.tables || []).map((t) => ({
      schema: t.schema,
      name: t.name,
      cols: t.columns.map((c) => [
        c.key,
        c.type,
        c.pk,
        c.notNull,
        c.unique,
        c.default,
        c.length ?? '',
        c.references ? `${c.references.table}.${c.references.column}:${c.references.onDelete}` : '',
      ]),
    })),
  });
}

function applyMigrationSql(schema, sql) {
  const next = cloneSchema(schema);
  let structural = false;
  const before = schemaSignature(next);
  for (const stmt of splitStatements(sql)) {
    applyStatement(next, stmt);
  }
  rebuildRelations(next);
  if (schemaSignature(next) !== before) structural = true;
  return { schema: next, structural };
}

function parseMigrationFilename(filePath) {
  const base = path.basename(filePath, '.sql');
  // 20260706000000_auth_users_add_job_title  or  00000000000000_init
  const m = base.match(/^(\d{14}|0+)(?:_(.+))?$/);
  let at;
  let slug;
  if (m) {
    const ts = m[1];
    slug = m[2] || 'init';
    if (/^0+$/.test(ts)) {
      at = '1970-01-01T00:00:00.000Z';
    } else {
      // YYYYMMDDHHmmss → ISO
      const y = ts.slice(0, 4),
        mo = ts.slice(4, 6),
        d = ts.slice(6, 8);
      const h = ts.slice(8, 10),
        mi = ts.slice(10, 12),
        s = ts.slice(12, 14);
      at = `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
    }
  } else {
    slug = base;
    at = new Date().toISOString();
  }
  return { slug, at, file: `${base}.sql` };
}

function listMigrationFiles(dir) {
  if (!(dir && fs.existsSync(dir))) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Build cumulative version snapshots from a migrations directory.
 * Returns [{ id, at, reason, file, kind, structural, schema }, ...] with ids 1..N.
 */
function buildMigrationVersions(migrationsDir) {
  const files = listMigrationFiles(migrationsDir);
  const versions = [];
  let state = emptySchema();
  let id = 0;
  for (const filePath of files) {
    const meta = parseMigrationFilename(filePath);
    let sql = '';
    try {
      sql = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const { schema, structural } = applyMigrationSql(state, sql);
    state = schema;
    id += 1;
    versions.push({
      id,
      at: meta.at,
      reason: meta.slug,
      file: meta.file,
      kind: 'migration',
      structural,
      schema: cloneSchema(state),
    });
  }
  return versions;
}

export {
  emptySchema,
  cloneSchema,
  buildMigrationVersions,
  listMigrationFiles,
  applyMigrationSql,
  parseMigrationFilename,
};
