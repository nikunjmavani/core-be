// Drizzle schema parser.
// Turns a Drizzle ORM schema (TypeScript) into a normalized JSON model:
//   { dialect, enums: [...], tables: [...] }
// It is a focused, brace-aware parser for the common Drizzle DSL — it does not
// need the user's node_modules and never executes their code.

const TABLE_FNS = ['pgTable', 'mysqlTable', 'sqliteTable'];
const ENUM_FNS = ['pgEnum', 'mysqlEnum'];

// ---- low-level scanning helpers -------------------------------------------

// A '/' after any of these (as the last significant token) starts a regex literal, not
// division — the standard operand-position heuristic.
const REGEX_KEYWORD_BEFORE =
  /(?:^|[^\w$])(?:return|case|typeof|instanceof|in|of|new|delete|void|do|else|yield|await)\s*$/;

function regexCanFollow(out) {
  const trimmed = out.replace(/\s+$/, '');
  if (!trimmed) return true;
  const prev = trimmed[trimmed.length - 1];
  if ('=(,[!&|?:;{}+-*%~^<>'.includes(prev)) return true;
  return REGEX_KEYWORD_BEFORE.test(trimmed);
}

// Strip // line comments and /* */ block comments without touching string bodies or
// regex literals (a `//` inside e.g. `replace(/\/\//g, …)` is not a comment).
/** Index just past a `//` line comment. Its text is dropped. */
function skipLineComment(src, i) {
  let cursor = i;
  while (cursor < src.length && src[cursor] !== '\n') cursor++;
  return cursor;
}

/** Index just past a block comment. Its text is dropped. */
function skipBlockComment(src, i) {
  let cursor = i + 2;
  while (cursor < src.length && !(src[cursor] === '*' && src[cursor + 1] === '/')) cursor++;
  return cursor + 2;
}

/**
 * Copy one character of an in-progress string literal.
 *
 * Returns the text to emit, the next index, and the delimiter still in force
 * (null once the literal closes). A backslash consumes the character after it,
 * so an escaped quote cannot end the string.
 */
function copyStringCharacter(src, i, delimiter) {
  const c = src[i];
  if (c === '\\') return { text: c + (src[i + 1] ?? ''), next: i + 2, delimiter };
  return { text: c, next: i + 1, delimiter: c === delimiter ? null : delimiter };
}

/**
 * Copy a whole regex literal through verbatim — escapes and `[]` character
 * classes, inside which `/` needs no escape — so its body can never be mistaken
 * for a comment.
 */
function copyRegexLiteral(src, i) {
  let out = src[i];
  let cursor = i + 1;
  let inClass = false;
  while (cursor < src.length && src[cursor] !== '\n') {
    out += src[cursor];
    if (src[cursor] === '\\') {
      out += src[cursor + 1] ?? '';
      cursor += 2;
      continue;
    }
    if (src[cursor] === '[') inClass = true;
    else if (src[cursor] === ']') inClass = false;
    else if (src[cursor] === '/' && !inClass) {
      cursor++;
      break;
    }
    cursor++;
  }
  return { text: out, next: cursor };
}

function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let str = null; // current string delimiter or null
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    if (str) {
      const step = copyStringCharacter(src, i, str);
      out += step.text;
      i = step.next;
      str = step.delimiter;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      str = c;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && c2 === '/') {
      i = skipLineComment(src, i);
      continue;
    }
    if (c === '/' && c2 === '*') {
      i = skipBlockComment(src, i);
      continue;
    }
    if (c === '/' && regexCanFollow(out)) {
      const step = copyRegexLiteral(src, i);
      out += step.text;
      i = step.next;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// Given src and the index of an opening bracket, return the index of its match.
function matchBracket(src, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const close = pairs[src[open]];
  let depth = 0;
  let str = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (str) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      str = c;
      continue;
    }
    if (c === src[open]) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Split a string on a separator char, but only at bracket-depth 0 and outside strings.
/**
 * Bracket and generic nesting after consuming one character.
 *
 * Angle brackets count only when they look like a generic (`foo<…>`), and the
 * `>` of an arrow (`=>`) is never treated as a closer.
 */
function updateNesting(src, i, depth, angle) {
  const c = src[i];
  if (c === '(' || c === '[' || c === '{') return { depth: depth + 1, angle };
  if (c === ')' || c === ']' || c === '}') return { depth: depth - 1, angle };
  if (c === '<' && /[A-Za-z0-9_$]/.test(src[i - 1] || '')) return { depth, angle: angle + 1 };
  if (c === '>' && src[i - 1] !== '=' && angle > 0) return { depth, angle: angle - 1 };
  return { depth, angle };
}

function splitTopLevel(src, sep = ',') {
  const parts = [];
  let depth = 0; // () [] {}
  let angle = 0; // TS generics <...>
  let str = null;
  let cur = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (str) {
      const step = copyStringCharacter(src, i, str);
      cur += step.text;
      str = step.delimiter;
      i = step.next - 1; // the loop's own i++ supplies the final advance
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      str = c;
      cur += c;
      continue;
    }

    const nesting = updateNesting(src, i, depth, angle);
    depth = nesting.depth;
    angle = nesting.angle;

    if (c === sep && depth === 0 && angle === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts;
}

function firstStringLiteral(argsSrc) {
  const m = argsSrc.match(/^\s*['"`]([^'"`]*)['"`]/);
  return m ? m[1] : null;
}

// ---- chain parsing --------------------------------------------------------

// Parse a column expression like:
//   varchar('email', { length: 255 }).notNull().unique()
// into { type, args, methods: [{ name, args }] }
/**
 * Drop a leading TypeScript generic argument list, e.g. the `<Record<string, X>>`
 * in `.$type<…>()`.
 *
 * Without this the generic's `>` would swallow the rest of the chain
 * (.primaryKey(), .notNull(), …).
 */
function skipGenericArguments(after) {
  let depth = 0;
  let j = 0;
  for (; j < after.length; j++) {
    if (after[j] === '<') depth++;
    else if (after[j] === '>') {
      depth--;
      if (depth === 0) {
        j++;
        break;
      }
    }
  }
  return after.slice(j).replace(/^\s+/, '');
}

/** The `.a().b()` tail of a column expression, as `{ name, args }` entries. */
function parseMethodChain(tail) {
  const methods = [];
  let rest = tail;
  while (true) {
    const m = rest.match(/^\s*\.\s*([A-Za-z_$][\w$]*)\s*/);
    if (!m) break;
    const name = m[1];
    let after = rest.slice(m[0].length);
    if (after[0] === '<') after = skipGenericArguments(after);

    if (after[0] !== '(') {
      methods.push({ name, args: '' });
      rest = after;
      continue;
    }
    const closeIdx = matchBracket(after, 0);
    methods.push({ name, args: after.slice(1, closeIdx) });
    rest = after.slice(closeIdx + 1);
  }
  return methods;
}

function parseChain(expr) {
  const source = expr.trim();
  const typeMatch = source.match(/^([A-Za-z_$][\w$]*)\s*\(/);
  if (!typeMatch) {
    // e.g. `roleEnum('role')` handled above; bare identifier fallback
    const id = source.match(/^([A-Za-z_$][\w$]*)/);
    return { type: id ? id[1] : source, args: '', methods: [] };
  }
  const type = typeMatch[1];
  const i = source.indexOf('(', typeMatch.index);
  const close = matchBracket(source, i);
  return {
    type,
    args: source.slice(i + 1, close),
    methods: parseMethodChain(source.slice(close + 1)),
  };
}

// ---- enums ----------------------------------------------------------------

function parseEnums(src) {
  const enums = [];
  const varByName = {};
  const re = new RegExp(
    `(?:export\\s+)?const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(${ENUM_FNS.join('|')})\\s*\\(`,
    'g',
  );
  for (const m of src.matchAll(re)) {
    const varName = m[1];
    const openIdx = src.indexOf('(', m.index + m[0].length - 1);
    const close = matchBracket(src, openIdx);
    const argsSrc = src.slice(openIdx + 1, close);
    const args = splitTopLevel(argsSrc);
    const dbName = firstStringLiteral(args[0] || '') || varName;
    let values = [];
    if (args[1]) {
      const arrMatch = args[1].match(/\[([\s\S]*)\]/);
      if (arrMatch) {
        values = splitTopLevel(arrMatch[1])
          .map((v) => v.trim().replace(/^['"`]|['"`]$/g, ''))
          .filter(Boolean);
      }
    }
    const e = { var: varName, name: dbName, values };
    enums.push(e);
    varByName[varName] = e;
  }
  return { enums, enumVarByName: varByName };
}

// ---- tables ---------------------------------------------------------------

/**
 * The column record as declared by its constructor, before any chained builder
 * calls are applied.
 */
function baseColumn(key, chain, ctx) {
  const declaredEnum = ctx.enumVarByName[chain.type];
  const col = {
    key,
    name: firstStringLiteral(chain.args) || key,
    type: chain.type,
    isEnum: !!declaredEnum,
    enumName: declaredEnum?.name || null,
    enumValues: declaredEnum?.values || null,
    pk: false,
    notNull: false,
    unique: false,
    array: false,
    default: null,
    references: null,
  };

  // Precision/length hints live in the constructor args (e.g. varchar length).
  const lengthM = chain.args.match(/length\s*:\s*(\d+)/);
  if (lengthM) col.length = Number(lengthM[1]);
  if (/withTimezone\s*:\s*true/.test(chain.args)) col.withTimezone = true;
  return col;
}

/** Apply one chained builder call (`.notNull()`, `.references(…)`, …) to a column. */
function applyColumnMethod(col, meth) {
  switch (meth.name) {
    case 'primaryKey':
      col.pk = true;
      col.notNull = true;
      break;
    case 'notNull':
      col.notNull = true;
      break;
    case 'unique':
      col.unique = true;
      break;
    case 'array':
      col.array = true;
      break;
    case 'default':
      col.default = meth.args.trim();
      break;
    case 'defaultNow':
      col.default = 'now()';
      break;
    case 'defaultRandom':
      col.default = 'random()';
      break;
    case '$defaultFn':
    case '$default':
      col.default = 'fn()';
      break;
    case 'references': {
      const refM = meth.args.match(/=>\s*([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)/);
      if (!refM) break;
      const onDelete = meth.args.match(/onDelete\s*:\s*['"`]([^'"`]+)['"`]/);
      col.references = {
        tableVar: refM[1],
        column: refM[2],
        onDelete: onDelete ? onDelete[1] : null,
      };
      break;
    }
  }
}

function parseColumns(objSrc, ctx) {
  const columns = [];
  for (const entry of splitTopLevel(objSrc)) {
    const idx = entry.indexOf(':');
    if (idx === -1) continue;
    const key = entry
      .slice(0, idx)
      .trim()
      .replace(/^['"`]|['"`]$/g, '');
    if (!(key && /^[A-Za-z_$][\w$]*$/.test(key))) continue;
    const chain = parseChain(entry.slice(idx + 1).trim());
    if (!chain.type) continue;

    const col = baseColumn(key, chain, ctx);
    for (const meth of chain.methods) applyColumnMethod(col, meth);
    columns.push(col);
  }
  return columns;
}

// Parse table-level extras (3rd arg callback): composite PKs, indexes, explicit FKs.
// Handles both object form `(t) => ({ … })` and array form `(t) => [ index(…), … ]`.
function parseTableExtras(extrasSrc, table) {
  if (!extrasSrc) return;
  const body = extrasSrc;

  // Composite / named primaryKey({ columns: [t.a, t.b] })
  for (const m of body.matchAll(/\bprimaryKey\s*\(([\s\S]*?)\)/g)) {
    const names = [...m[1].matchAll(/\.([A-Za-z_$][\w$]*)/g)].map((x) => x[1]);
    for (const c of table.columns) if (names.includes(c.key)) c.pk = true;
  }

  // index('name').on(t.a, t.b) / uniqueIndex(...)
  // Bound the forward search at the next index() so a missing .on() cannot steal columns.
  const indexRe = /\b(uniqueIndex|index)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  for (const im of body.matchAll(indexRe)) {
    const unique = im[1] === 'uniqueIndex';
    const name = im[2];
    const after = body.slice(im.index + im[0].length);
    const nextIdx = after.search(/\b(uniqueIndex|index)\s*\(/);
    const window = nextIdx >= 0 ? after.slice(0, nextIdx) : after.slice(0, 500);
    const onM = window.match(/\.on\s*\(([\s\S]*?)\)/);
    const onCols = onM ? [...onM[1].matchAll(/\.([A-Za-z_$][\w$]*)/g)].map((y) => y[1]) : [];
    table.indexes.push({ name, unique, columns: onCols });
  }

  // Explicit foreignKey({ columns, foreignColumns })
  for (const m of body.matchAll(/\bforeignKey\s*\(([\s\S]*?)\)/g)) {
    const val = m[1];
    const cols = val.match(/columns\s*:\s*\[([\s\S]*?)\]/);
    const foreign = val.match(/foreignColumns\s*:\s*\[([\s\S]*?)\]/);
    if (cols && foreign) {
      const localCols = [...cols[1].matchAll(/\.([A-Za-z_$][\w$]*)/g)].map((x) => x[1]);
      const refTable = foreign[1].match(/([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)/);
      localCols.forEach((lc) => {
        const c = table.columns.find((x) => x.key === lc);
        if (c && refTable && !c.references)
          c.references = { tableVar: refTable[1], column: refTable[2], onDelete: null };
      });
    }
  }
}

// Map `const authSchema = pgSchema('auth')` → { authSchema: 'auth' }.
function parsePgSchemas(src) {
  const map = {};
  const re =
    /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*pgSchema\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  for (const m of src.matchAll(re)) map[m[1]] = m[2];
  return map;
}

function parseTables(src, ctx) {
  const tables = [];
  const tableVarToName = {};
  const pgSchemas = ctx.pgSchemas || {};
  // Supports both:
  //   const users = pgTable('users', { … })
  //   const users = authSchema.table('users', { … })   (incl. multiline before .table)
  const re = new RegExp(
    `(?:export\\s+)?const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:(${TABLE_FNS.join('|')})|([A-Za-z_$][\\w$]*)\\s*\\.\\s*table)\\s*\\(`,
    'g',
  );
  for (const m of src.matchAll(re)) {
    const varName = m[1];
    const fn = m[2] || null;
    const schemaVar = m[3] || null;
    const openIdx = src.indexOf('(', m.index + m[0].length - 1);
    const close = matchBracket(src, openIdx);
    const argsSrc = src.slice(openIdx + 1, close);
    const args = splitTopLevel(argsSrc);
    const dbName = firstStringLiteral(args[0] || '') || varName;

    // Second arg is the columns object.
    const colsObj = args[1] || '';
    const braceStart = colsObj.indexOf('{');
    let columns = [];
    if (braceStart !== -1) {
      const rel = matchBracket(colsObj, braceStart);
      const inner = colsObj.slice(braceStart + 1, rel);
      columns = parseColumns(inner, ctx);
    }

    const dialect = fn ? fn.replace('Table', '') : 'pg';
    const table = {
      var: varName,
      name: dbName,
      schema: schemaVar ? pgSchemas[schemaVar] || schemaVar : null,
      dialect,
      columns,
      indexes: [],
    };
    // Third arg: table extras callback.
    if (args[2]) parseTableExtras(args.slice(2).join(','), table);

    tables.push(table);
    tableVarToName[varName] = dbName;
  }

  // Resolve reference table vars → db names.
  for (const t of tables) {
    for (const c of t.columns) {
      if (c.references) {
        c.references.table = tableVarToName[c.references.tableVar] || c.references.tableVar;
      }
    }
  }
  return tables;
}

// ---- public API -----------------------------------------------------------

function parseSchema(rawSrc) {
  const src = stripComments(rawSrc);
  let dialect = 'postgres';
  if (/mysqlTable|mysqlEnum/.test(src)) dialect = 'mysql';
  else if (/sqliteTable/.test(src)) dialect = 'sqlite';
  else if (/pgSchema\s*\(|\.table\s*\(/.test(src)) dialect = 'postgres';

  const { enums, enumVarByName } = parseEnums(src);
  const pgSchemas = parsePgSchemas(src);
  const ctx = { enumVarByName, pgSchemas };
  const tables = parseTables(src, ctx);

  // Relationship edges derived from references.
  const relations = [];
  for (const t of tables) {
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

  return { dialect, enums, tables, relations };
}

export { parseSchema, stripComments, matchBracket, splitTopLevel };
