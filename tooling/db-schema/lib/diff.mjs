// Structural diff between two parsed schema snapshots.
// Produces per-table and per-column status: added | removed | modified | unchanged
// plus a flat changelog ("was X → now Y") for the change feed.

function colSignature(c) {
  return JSON.stringify({
    type: c.type,
    pk: c.pk,
    notNull: c.notNull,
    unique: c.unique,
    default: c.default,
    isEnum: c.isEnum,
    array: c.array,
    references: c.references
      ? { table: c.references.table, column: c.references.column, onDelete: c.references.onDelete }
      : null,
    length: c.length ?? null,
  });
}

function describeColumn(c) {
  const bits = [c.type];
  if (c.length) bits[0] = `${c.type}(${c.length})`;
  if (c.pk) bits.push('PK');
  if (c.notNull) bits.push('NOT NULL');
  if (c.unique) bits.push('UNIQUE');
  if (c.references) bits.push(`→ ${c.references.table}.${c.references.column}`);
  if (c.default != null) bits.push(`default ${c.default}`);
  return bits.join(' ');
}

function diffColumns(oldCols = [], newCols = [], changelog, tableName) {
  const byKeyOld = new Map(oldCols.map((c) => [c.key, c]));
  const byKeyNew = new Map(newCols.map((c) => [c.key, c]));
  const result = [];

  for (const c of newCols) {
    const prev = byKeyOld.get(c.key);
    if (!prev) {
      result.push({ ...c, status: 'added' });
      changelog.push({
        kind: 'column-added',
        table: tableName,
        column: c.name,
        detail: describeColumn(c),
      });
    } else if (colSignature(prev) !== colSignature(c)) {
      const changes = [];
      if (prev.type !== c.type) changes.push(`type ${prev.type} → ${c.type}`);
      if ((prev.length ?? null) !== (c.length ?? null))
        changes.push(`length ${prev.length ?? '∅'} → ${c.length ?? '∅'}`);
      if (prev.notNull !== c.notNull) changes.push(c.notNull ? 'now NOT NULL' : 'now nullable');
      if (prev.pk !== c.pk) changes.push(c.pk ? 'now PK' : 'no longer PK');
      if (prev.unique !== c.unique) changes.push(c.unique ? 'now UNIQUE' : 'no longer UNIQUE');
      if (prev.default !== c.default)
        changes.push(`default ${prev.default ?? '∅'} → ${c.default ?? '∅'}`);
      const pr = prev.references ? `${prev.references.table}.${prev.references.column}` : '∅';
      const nr = c.references ? `${c.references.table}.${c.references.column}` : '∅';
      if (pr !== nr) changes.push(`ref ${pr} → ${nr}`);
      // structured delta (old→new) so a migration generator can emit precise ALTERs
      const delta = {};
      if (
        prev.type !== c.type ||
        (prev.length ?? null) !== (c.length ?? null) ||
        !!prev.array !== !!c.array
      )
        delta.type = true;
      if (prev.notNull !== c.notNull) delta.notNull = c.notNull;
      if (prev.unique !== c.unique) delta.unique = c.unique;
      if (prev.default !== c.default) delta.default = c.default;
      if (pr !== nr) delta.references = c.references || null;
      result.push({ ...c, status: 'modified', changes, delta });
      changelog.push({
        kind: 'column-modified',
        table: tableName,
        column: c.name,
        detail: changes.join(', '),
      });
    } else {
      result.push({ ...c, status: 'unchanged' });
    }
  }
  for (const c of oldCols) {
    if (!byKeyNew.has(c.key)) {
      result.push({ ...c, status: 'removed' });
      changelog.push({
        kind: 'column-removed',
        table: tableName,
        column: c.name,
        detail: describeColumn(c),
      });
    }
  }
  return result;
}

function diffSchemas(oldSchema, newSchema) {
  const changelog = [];
  const oldTables = new Map((oldSchema?.tables || []).map((t) => [t.name, t]));
  const newTables = new Map((newSchema?.tables || []).map((t) => [t.name, t]));
  const tables = [];

  for (const t of newSchema.tables) {
    const prev = oldTables.get(t.name);
    if (!prev) {
      const cols = diffColumns([], t.columns, [], t.name).map((c) => ({ ...c, status: 'added' }));
      tables.push({ ...t, status: 'added', columns: cols });
      changelog.push({ kind: 'table-added', table: t.name, detail: `${t.columns.length} columns` });
    } else {
      const cols = diffColumns(prev.columns, t.columns, changelog, t.name);
      const changed = cols.some((c) => c.status !== 'unchanged');
      tables.push({ ...t, status: changed ? 'modified' : 'unchanged', columns: cols });
    }
  }
  for (const t of oldSchema?.tables || []) {
    if (!newTables.has(t.name)) {
      tables.push({
        ...t,
        status: 'removed',
        columns: t.columns.map((c) => ({ ...c, status: 'removed' })),
      });
      changelog.push({
        kind: 'table-removed',
        table: t.name,
        detail: `${t.columns.length} columns`,
      });
    }
  }

  // enums — added / removed / value changes
  const oldEnums = new Map((oldSchema?.enums || []).map((e) => [e.name, e]));
  const newEnums = new Map((newSchema.enums || []).map((e) => [e.name, e]));
  for (const e of newSchema.enums || []) {
    const prev = oldEnums.get(e.name);
    if (!prev) {
      changelog.push({
        kind: 'enum-added',
        enum: e.name,
        values: e.values,
        detail: e.values.join(', '),
      });
    } else {
      const added = e.values.filter((v) => !prev.values.includes(v));
      const removed = prev.values.filter((v) => !e.values.includes(v));
      if (added.length || removed.length) {
        const parts = [];
        if (added.length) parts.push(added.map((v) => `+${v}`).join('  '));
        if (removed.length) parts.push(removed.map((v) => `−${v}`).join('  '));
        changelog.push({
          kind: 'enum-modified',
          enum: e.name,
          added,
          removed,
          detail: parts.join('  '),
        });
      }
    }
  }
  for (const e of oldSchema?.enums || []) {
    if (!newEnums.has(e.name))
      changelog.push({ kind: 'enum-removed', enum: e.name, detail: `${e.values.length} values` });
  }

  const counts = {
    tablesAdded: changelog.filter((c) => c.kind === 'table-added').length,
    tablesRemoved: changelog.filter((c) => c.kind === 'table-removed').length,
    columnsAdded: changelog.filter((c) => c.kind === 'column-added').length,
    columnsRemoved: changelog.filter((c) => c.kind === 'column-removed').length,
    columnsModified: changelog.filter((c) => c.kind === 'column-modified').length,
    enumsChanged: changelog.filter((c) => c.kind?.startsWith('enum-')).length,
  };
  return {
    tables,
    relations: newSchema.relations,
    enums: newSchema.enums,
    dialect: newSchema.dialect,
    changelog,
    counts,
  };
}

export { diffSchemas, describeColumn };
