// Shared normalization so SQL-replay and Drizzle-parse snapshots compare cleanly.

function tableKey(t) {
  const schema = t?.schema || 'public';
  const name = typeof t === 'string' ? t : t?.name;
  return `${schema}.${name}`;
}

function normalizeOnDelete(v) {
  if (v == null || v === '') return null;
  const s = String(v).toLowerCase().replace(/\s+/g, ' ').trim();
  if (s === 'no action' || s === 'noaction') return null;
  return s;
}

function normalizeType(t) {
  if (t == null) return t;
  const s = String(t).toLowerCase();
  if (s === 'decimal') return 'numeric';
  if (s === 'int') return 'integer';
  if (s === 'bool') return 'boolean';
  return s;
}

/** Strip wrapping quotes / normalize JSON-ish defaults for comparison. */
function normalizeDefault(d) {
  if (d == null) return null;
  let s = String(d).trim();
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    s = s.slice(1, -1).replace(/''/g, "'");
  }
  // drizzle often emits JS-ish arrays/objects; SQL emits JSON text
  const asJson = s.replace(/'/g, '"');
  try {
    return JSON.stringify(JSON.parse(asJson));
  } catch {
    return s;
  }
}

function normalizeReferences(ref) {
  if (!ref) return null;
  return {
    table: ref.table || ref.tableVar || null,
    column: ref.column || null,
    onDelete: normalizeOnDelete(ref.onDelete),
  };
}

function normalizeColumn(c) {
  if (!c) return c;
  return {
    ...c,
    type: normalizeType(c.type),
    default: normalizeDefault(c.default),
    references: normalizeReferences(c.references),
  };
}

function normalizeSchema(schema) {
  if (!schema) return { dialect: 'postgres', enums: [], tables: [], relations: [] };
  return {
    ...schema,
    tables: (schema.tables || []).map((t) => ({
      ...t,
      schema: t.schema || 'public',
      columns: (t.columns || []).map(normalizeColumn),
    })),
    relations: (schema.relations || []).map((r) => ({
      ...r,
      onDelete: normalizeOnDelete(r.onDelete),
    })),
    enums: schema.enums || [],
  };
}

export {
  tableKey,
  normalizeOnDelete,
  normalizeType,
  normalizeDefault,
  normalizeReferences,
  normalizeColumn,
  normalizeSchema,
};
