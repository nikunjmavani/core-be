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

/**
 * Copy a `$tag$…$tag$` dollar-quoted body verbatim.
 *
 * Returns null when `$` does not in fact open one; an unterminated body runs to
 * end of input.
 */
function copyDollarQuoted(src, i) {
  const m = src.slice(i).match(/^(\$[A-Za-z0-9_]*\$)/);
  if (!m) return null;
  const tag = m[1];
  const end = src.indexOf(tag, i + tag.length);
  if (end === -1) return { text: src.slice(i), next: src.length };
  return { text: src.slice(i, end + tag.length), next: end + tag.length };
}

/** Copy a single-quoted SQL literal, honouring the doubled-quote (`''`) escape. */
function copySingleQuoted(src, i) {
  let out = src[i];
  let cursor = i + 1;
  while (cursor < src.length) {
    out += src[cursor];
    if (src[cursor] === "'" && src[cursor + 1] === "'") {
      cursor++;
      out += src[cursor];
      cursor++;
      continue;
    }
    if (src[cursor] === "'") {
      cursor++;
      break;
    }
    cursor++;
  }
  return { text: out, next: cursor };
}

/** Copy a double-quoted identifier. */
function copyDoubleQuoted(src, i) {
  let out = src[i];
  let cursor = i + 1;
  while (cursor < src.length) {
    out += src[cursor];
    if (src[cursor] === '"') {
      cursor++;
      break;
    }
    cursor++;
  }
  return { text: out, next: cursor };
}

/**
 * Copy whichever verbatim-preserving literal starts at `i` — a dollar-quoted
 * body, a single-quoted string, or a double-quoted identifier.
 *
 * Returns null when the character at `i` opens none of them. Shared by the
 * comment stripper and the statement splitter, which must both step over these
 * regions without interpreting their contents.
 */
function copyVerbatimLiteral(src, i) {
  const c = src[i];
  if (c === '$') return copyDollarQuoted(src, i);
  if (c === "'") return copySingleQuoted(src, i);
  if (c === '"') return copyDoubleQuoted(src, i);
  return null;
}

/** Index just past a `--` line comment. */
function skipSqlLineComment(src, i) {
  let cursor = i;
  while (cursor < src.length && src[cursor] !== '\n') cursor++;
  return cursor;
}

/** Index just past a block comment. */
function skipSqlBlockComment(src, i) {
  let cursor = i + 2;
  while (cursor < src.length && !(src[cursor] === '*' && src[cursor + 1] === '/')) cursor++;
  return cursor + 2;
}

function stripSqlComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const literal = copyVerbatimLiteral(src, i);
    if (literal) {
      out += literal.text;
      i = literal.next;
      continue;
    }
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '-' && c2 === '-') {
      i = skipSqlLineComment(src, i);
      continue;
    }
    if (c === '/' && c2 === '*') {
      i = skipSqlBlockComment(src, i);
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
    const literal = copyVerbatimLiteral(cleaned, i);
    if (literal) {
      cur += literal.text;
      i = literal.next;
      continue;
    }
    if (cleaned[i] === ';') {
      const t = cur.trim();
      if (t) stmts.push(t);
      cur = '';
      i++;
      continue;
    }
    cur += cleaned[i];
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
    // Strict: never fall back to bare name when a schema qualifier was provided.
    return schema.tables.find((t) => t.name === name && (t.schema || 'public') === sch) || null;
  }
  const hits = schema.tables.filter((t) => t.name === name);
  if (hits.length === 1) return hits[0];
  // Ambiguous bare name across pg schemas — refuse to guess.
  return null;
}

/**
 * SQL type spellings mapped to the viewer's canonical name, as
 * `[pattern, canonicalType, carriesTimezone]`.
 *
 * Order matters: multi-word spellings come first so `timestamp with time zone`
 * wins over bare `timestamp`, and `int` never shadows `integer`.
 */
const SQL_TYPE_PATTERNS = [
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

/**
 * Canonical type for a column definition tail, plus how many characters of
 * `input` the type spelling consumed.
 *
 * Falls back to a quoted identifier, then a bare one, then `unknown` — which
 * consumes nothing, leaving the whole tail to be read as flags.
 */
function resolveColumnType(input) {
  for (const [re, name, tz] of SQL_TYPE_PATTERNS) {
    const m = input.match(re);
    if (m) return { type: name, withTimezone: !!tz, next: m[0].length };
  }
  const quoted = input.match(/^"([^"]+)"/);
  if (quoted) return { type: quoted[1].toLowerCase(), withTimezone: false, next: quoted[0].length };
  const bare = input.match(/^([A-Za-z_][\w$]*)/);
  if (bare) return { type: bare[1].toLowerCase(), withTimezone: false, next: bare[0].length };
  return { type: 'unknown', withTimezone: false, next: 0 };
}

/** Read the `DEFAULT …` clause, normalizing the common Postgres spellings. */
function applyColumnDefault(col, flags) {
  const defM = flags.match(
    /\bDEFAULT\s+((?:'(?:[^']|'')*')|(?:"(?:[^"]|"")*")|(?:\([^)]*\))|(?:[^\s,]+(?:\s+[^\s,]+)*?)(?=\s+(?:NOT\s+NULL|NULL|PRIMARY|UNIQUE|REFERENCES|CHECK|COLLATE)|$))/i,
  );
  if (!defM) return;
  let d = defM[1].trim();
  if (/^now\(\)$/i.test(d) || /^CURRENT_TIMESTAMP$/i.test(d)) d = 'now()';
  else if (/^gen_random_uuid\(\)$/i.test(d)) d = 'random()';
  col.default = d;
}

/** Read an inline `REFERENCES …` clause and its optional `ON DELETE` action. */
function applyColumnReference(col, flags) {
  const refM = flags.match(
    /\bREFERENCES\s+((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)\s*\(\s*(?:"([^"]+)"|([A-Za-z_][\w$]*))\s*\)/i,
  );
  if (!refM) return;
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

/** Constraints, DEFAULT and REFERENCES from the tail following the column type. */
function applyColumnFlags(col, flags) {
  // Strip string literals first so `DEFAULT 'x NOT NULL y'` cannot set notNull.
  const flagsBare = flags.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
  if (/\bPRIMARY\s+KEY\b/i.test(flagsBare)) {
    col.pk = true;
    col.notNull = true;
  }
  if (/\bNOT\s+NULL\b/i.test(flagsBare)) col.notNull = true;
  if (/\bUNIQUE\b/i.test(flagsBare)) col.unique = true;
  if (/\[\]/.test(flags.slice(0, 4))) col.array = true;

  applyColumnDefault(col, flags);
  applyColumnReference(col, flags);
}

function parseTypeAndFlags(rest) {
  const input = rest.trim();
  const { type, withTimezone, next } = resolveColumnType(input);

  let after = input.slice(next).trim();
  const lenM = after.match(/^\(\s*(\d+)\s*\)/);
  let length = null;
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

  applyColumnFlags(col, after);
  return col;
}

function parseColumnDef(line) {
  const trimmed = line.trim().replace(/,\s*$/, '');
  // Word-boundary required — otherwise UNIQUE/CHECK/CONSTRAINT eat columns like unique_code.
  if (!trimmed || /^(CONSTRAINT|CHECK|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY)\b/i.test(trimmed)) {
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

/**
 * Index of the ')' matching the '(' at openIndex, honoring the same quote rules as
 * splitTopLevelComma. -1 when unbalanced.
 */
function findMatchingParen(src, openIndex) {
  let depth = 0;
  let str = null;
  for (let i = openIndex; i < src.length; i++) {
    const c = src[i];
    if (str) {
      if (c === str && src[i - 1] !== '\\') str = null;
      continue;
    }
    if (c === "'" || c === '"') str = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
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

/** Table-level `PRIMARY KEY (a, b)` — bare, or named via `CONSTRAINT "x"`. */
function applyTableLevelPrimaryKey(part, columns) {
  const pk = part.match(
    /^\s*(?:CONSTRAINT\s+(?:"[^"]+"|[A-Za-z_][\w$]*)\s+)?PRIMARY\s+KEY\s*\(\s*([^)]+)\)/i,
  );
  if (!pk) return;
  const names = pk[1].split(',').map((x) => unquote(x.trim()));
  for (const c of columns) {
    if (!names.includes(c.key)) continue;
    c.pk = true;
    c.notNull = true;
  }
}

/** Table-level `UNIQUE (a, b)` — bare, or named via `CONSTRAINT "x"`. */
function applyTableLevelUnique(part, columns) {
  const uq = part.match(
    /^\s*(?:CONSTRAINT\s+(?:"[^"]+"|[A-Za-z_][\w$]*)\s+)?UNIQUE\s*\(\s*([^)]+)\)/i,
  );
  if (!uq) return;
  const names = uq[1].split(',').map((x) => unquote(x.trim()));
  for (const c of columns) if (names.includes(c.key)) c.unique = true;
}

/** Table-level `FOREIGN KEY (…) REFERENCES …`, recorded on the local column. */
function applyTableLevelForeignKey(part, columns) {
  const fk = part.match(
    /FOREIGN\s+KEY\s*\(\s*(?:"([^"]+)"|([A-Za-z_][\w$]*))\s*\)\s*REFERENCES\s+((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)\s*\(\s*(?:"([^"]+)"|([A-Za-z_][\w$]*))\s*\)(?:\s*ON\s+DELETE\s+(cascade|set\s+null|set\s+default|restrict|no\s+action))?/i,
  );
  if (!fk) return;
  const local = fk[1] || fk[2];
  const c = columns.find((x) => x.key === local);
  if (!c) return;
  const refQ = parseQualifiedName(fk[3]);
  c.references = {
    tableVar: refQ.name,
    table: refQ.name,
    column: fk[4] || fk[5],
    onDelete: fk[6] ? fk[6].toLowerCase().replace(/\s+/g, ' ') : null,
  };
}

/**
 * Apply one entry from a CREATE TABLE body that is not a column definition.
 *
 * Each form is tried independently — a single entry declares only one of them,
 * and a non-match is simply a no-op.
 */
function applyTableConstraint(part, columns) {
  applyTableLevelPrimaryKey(part, columns);
  applyTableLevelUnique(part, columns);
  applyTableLevelForeignKey(part, columns);
}

function applyCreateTable(schema, stmt) {
  // Balanced-paren walk (not a greedy regex to the last ')') so trailing clauses —
  // `PARTITION BY LIST (…)`, `WITH (…)` — never bleed into the column-def block.
  const head = stmt.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]+?)\s*\(/i);
  if (!head) return false;
  const open = head[0].length - 1;
  const close = findMatchingParen(stmt, open);
  if (close === -1) return false;

  const q = parseQualifiedName(head[1]);
  if (findTable(schema, q)) return true; // IF NOT EXISTS

  const columns = [];
  for (const part of splitTopLevelComma(stmt.slice(open + 1, close))) {
    const col = parseColumnDef(part);
    if (col) columns.push(col);
    else applyTableConstraint(part, columns);
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
  // Support multi-action: ALTER TABLE t ADD COLUMN a int, ADD COLUMN b text;
  // Mixed ADD+ALTER/DROP siblings must fail closed (→ skipped, no partial apply).
  const m = stmt.match(/^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+?)\s+([\s\S]+)$/i);
  if (!(m && /\bADD\s+COLUMN\b/i.test(m[2]))) return false;
  const table = findTable(schema, m[1]);
  if (!table) return false;
  const pending = [];
  let otherStructural = 0;
  for (const action of splitTopLevelComma(m[2])) {
    const trimmed = action.trim();
    if (!trimmed) continue;
    const colM = trimmed.match(/^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]+)$/i);
    if (colM) {
      const col = parseColumnDef(colM[1]);
      if (!col) {
        otherStructural += 1;
        continue;
      }
      pending.push(col);
      continue;
    }
    if (/^(ADD|DROP|ALTER|RENAME)\b/i.test(trimmed)) otherStructural += 1;
  }
  if (otherStructural > 0 || pending.length === 0) return false;
  for (const col of pending) {
    if (!table.columns.some((c) => c.key === col.key)) table.columns.push(col);
  }
  return true;
}

function applyDropColumn(schema, stmt) {
  const m = stmt.match(
    /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+?)\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([A-Za-z_][\w$]*))/i,
  );
  if (!m) return false;
  const table = findTable(schema, m[1]);
  if (!table) return false;
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
  if (!table) return false;
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
  if (!table) return false;
  const to = m[2] || m[3];
  table.name = to;
  table.var = to;
  return true;
}

function applyAlterColumnAction(col, rest) {
  const typeM = rest.match(/^(?:SET\s+DATA\s+)?TYPE\s+([\s\S]+?)(?:\s+USING\s+[\s\S]+)?$/i);
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
  return false;
}

function applyAlterColumn(schema, stmt) {
  // Support multi-action: ALTER TABLE t ALTER COLUMN a …, ALTER COLUMN b …;
  // Mixed non-ALTER-COLUMN siblings fail closed (→ skipped). Unrecognized
  // ALTER COLUMN forms (including future dialect) return false so skipped bumps.
  const m = stmt.match(/^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+?)\s+([\s\S]+)$/i);
  if (!(m && /\bALTER\s+COLUMN\b/i.test(m[2]))) return false;
  const table = findTable(schema, m[1]);
  if (!table) return false;

  const pending = [];
  let otherStructural = 0;
  for (const action of splitTopLevelComma(m[2])) {
    const trimmed = action.trim();
    if (!trimmed) continue;
    const colM = trimmed.match(/^ALTER\s+COLUMN\s+(?:"([^"]+)"|([A-Za-z_][\w$]*))\s+([\s\S]+)$/i);
    if (colM) {
      pending.push({ name: colM[1] || colM[2], rest: colM[3].trim() });
      continue;
    }
    if (/^(ADD|DROP|ALTER|RENAME)\b/i.test(trimmed)) otherStructural += 1;
  }
  if (otherStructural > 0 || pending.length === 0) return false;

  // Validate every action first so we never partially apply then bail.
  const ops = [];
  for (const p of pending) {
    const col = table.columns.find((c) => c.key === p.name);
    if (!col) continue; // column gone — no-op, same as prior single-action behaviour
    // Probe without mutating: clone flags via a dry-run on a shallow copy.
    const probe = { ...col };
    if (!applyAlterColumnAction(probe, p.rest)) return false;
    ops.push({ col, rest: p.rest });
  }
  for (const op of ops) applyAlterColumnAction(op.col, op.rest);
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
  if (!table) return false;
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

function applyAddUniqueConstraint(schema, stmt) {
  const m = stmt.match(
    /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+?)\s+ADD\s+CONSTRAINT\s+(?:"[^"]+"|[A-Za-z_][\w$]*)\s+UNIQUE\s*\(\s*([^)]+)\)/i,
  );
  if (!m) return false;
  const table = findTable(schema, m[1]);
  if (!table) return false;
  const names = m[2].split(',').map((x) => unquote(x.trim()));
  for (const c of table.columns) if (names.includes(c.key)) c.unique = true;
  return true;
}

function applyAddPrimaryKeyConstraint(schema, stmt) {
  const m = stmt.match(
    /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+?)\s+ADD\s+CONSTRAINT\s+(?:"[^"]+"|[A-Za-z_][\w$]*)\s+PRIMARY\s+KEY\s*\(\s*([^)]+)\)/i,
  );
  if (!m) return false;
  const table = findTable(schema, m[1]);
  if (!table) return false;
  const names = m[2].split(',').map((x) => unquote(x.trim()));
  for (const c of table.columns)
    if (names.includes(c.key)) {
      c.pk = true;
      c.notNull = true;
    }
  return true;
}

/**
 * Expand DO $$ … $$ bodies into inner statements (idempotent constraint idiom).
 * Returns null when not a DO block.
 */
function expandDoBlock(stmt) {
  const m = stmt.match(/^DO\s+(\$[A-Za-z0-9_]*\$)([\s\S]*)\1\s*;?\s*$/i);
  if (!m) return null;
  let body = m[2];
  body = body.replace(/EXCEPTION\s+WHEN[\s\S]*$/i, '');
  body = body.replace(/^\s*BEGIN\s+/i, '').replace(/\s*END\s*;?\s*$/i, '');
  return splitStatements(body);
}

/**
 * Apply one statement. Returns:
 *   'applied' | 'ignored' | 'unhandled'
 */
/** Statements carrying no structure the viewer models. */
const IGNORED_STATEMENT_PATTERNS = [
  /^(CREATE|DROP|ALTER)\s+(EXTENSION|SCHEMA|ROLE|POLICY|INDEX|UNIQUE\s+INDEX|FUNCTION|PROCEDURE|TRIGGER|TYPE|VIEW|MATERIALIZED|SEQUENCE)\b/i,
  /^GRANT\b|^REVOKE\b|^COMMENT\b|^ANALYZE\b|^VACUUM\b|^SELECT\b|^INSERT\b|^UPDATE\b|^DELETE\b/i,
  /\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b|\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b|\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i,
  /\bDROP\s+CONSTRAINT\b|\bVALIDATE\s+CONSTRAINT\b/i,
];

/**
 * True for statements deliberately skipped rather than left unhandled.
 *
 * CHECK and other constraints outside the PK/UNIQUE/FK model are ignored on
 * purpose — counting them as unhandled would inflate the skip counter.
 */
function isIgnoredStatement(s) {
  if (IGNORED_STATEMENT_PATTERNS.some((re) => re.test(s))) return true;
  return /\bADD\s+CONSTRAINT\b/i.test(s) && /\bCHECK\b/i.test(s);
}

/**
 * Structural DDL the viewer replays. Every marker must match for a handler to
 * run, and the first match wins — so order is behaviour, not style. `FOREIGN
 * KEY` precedes the `ADD CONSTRAINT` entries so a named FK constraint routes to
 * the FK handler, and `UNIQUE` precedes `PRIMARY KEY`.
 */
const STATEMENT_HANDLERS = [
  { markers: [/^CREATE\s+TABLE\b/i], apply: applyCreateTable },
  { markers: [/^DROP\s+TABLE\b/i], apply: applyDropTable },
  { markers: [/^ALTER\s+TABLE\b/i, /\bADD\s+COLUMN\b/i], apply: applyAddColumn },
  { markers: [/^ALTER\s+TABLE\b/i, /\bDROP\s+COLUMN\b/i], apply: applyDropColumn },
  { markers: [/^ALTER\s+TABLE\b/i, /\bRENAME\s+COLUMN\b/i], apply: applyRenameColumn },
  { markers: [/^ALTER\s+TABLE\b/i, /\bRENAME\s+TO\b/i], apply: applyRenameTable },
  { markers: [/^ALTER\s+TABLE\b/i, /\bALTER\s+COLUMN\b/i], apply: applyAlterColumn },
  { markers: [/^ALTER\s+TABLE\b/i, /\bFOREIGN\s+KEY\b/i], apply: applyAddForeignKey },
  {
    markers: [/^ALTER\s+TABLE\b/i, /\bADD\s+CONSTRAINT\b/i, /\bUNIQUE\b/i],
    apply: applyAddUniqueConstraint,
  },
  {
    markers: [/^ALTER\s+TABLE\b/i, /\bADD\s+CONSTRAINT\b/i, /\bPRIMARY\s+KEY\b/i],
    apply: applyAddPrimaryKeyConstraint,
  },
];

/** Replay the statements lifted out of a `DO $$ … $$` block. */
function applyDoBlock(schema, inners) {
  let any = false;
  for (const inner of inners) {
    if (applyStatement(schema, inner) === 'applied') any = true;
  }
  return any ? 'applied' : 'ignored';
}

function applyStatement(schema, stmt) {
  const s = stmt.trim();
  if (!s) return 'ignored';

  const doInner = expandDoBlock(s);
  if (doInner) return applyDoBlock(schema, doInner);

  if (isIgnoredStatement(s)) return 'ignored';

  const handler = STATEMENT_HANDLERS.find((h) => h.markers.every((re) => re.test(s)));
  if (handler) return handler.apply(schema, s) ? 'applied' : 'unhandled';

  // Recognised as table DDL but not modelled — counted as skipped, not ignored.
  if (/^ALTER\s+TABLE\b/i.test(s) || /^CREATE\s+TABLE\b/i.test(s)) return 'unhandled';
  return 'ignored';
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
  let skipped = 0;
  const before = schemaSignature(next);
  for (const stmt of splitStatements(sql)) {
    const result = applyStatement(next, stmt);
    if (result === 'unhandled') skipped += 1;
  }
  rebuildRelations(next);
  if (schemaSignature(next) !== before) structural = true;
  return { schema: next, structural, skipped };
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
  let unreadFiles = 0;
  for (const filePath of files) {
    const meta = parseMigrationFilename(filePath);
    let sql = '';
    try {
      sql = fs.readFileSync(filePath, 'utf8');
    } catch {
      unreadFiles += 1;
      continue;
    }
    const { schema, structural, skipped } = applyMigrationSql(state, sql);
    state = schema;
    id += 1;
    versions.push({
      id,
      at: meta.at,
      reason: meta.slug,
      file: meta.file,
      kind: 'migration',
      structural,
      skipped: skipped || 0,
      schema: cloneSchema(state),
    });
  }
  return { versions, unreadFiles };
}

export {
  emptySchema,
  cloneSchema,
  buildMigrationVersions,
  listMigrationFiles,
  applyMigrationSql,
  parseMigrationFilename,
  findTable,
  parseColumnDef,
  parseQualifiedName,
  applyStatement,
  splitStatements,
  stripSqlComments,
};
