// Structural diff between two parsed schema snapshots.
// Produces per-table and per-column status: added | removed | modified | unchanged
// plus a flat changelog ("was X → now Y") for the change feed.

import { tableKey, normalizeColumn, normalizeOnDelete, normalizeSchema } from './normalize.mjs';

function colSignature(c) {
  const n = normalizeColumn(c);
  return JSON.stringify({
    type: n.type,
    pk: n.pk,
    notNull: n.notNull,
    unique: n.unique,
    default: n.default,
    isEnum: n.isEnum,
    array: n.array,
    references: n.references,
    length: n.length ?? null,
  });
}

function describeColumn(c) {
  const n = normalizeColumn(c);
  const bits = [n.type];
  if (n.length) bits[0] = `${n.type}(${n.length})`;
  if (n.pk) bits.push('PK');
  if (n.notNull) bits.push('NOT NULL');
  if (n.unique) bits.push('UNIQUE');
  if (n.references) bits.push(`→ ${n.references.table}.${n.references.column}`);
  if (n.default != null) bits.push(`default ${n.default}`);
  return bits.join(' ');
}

function refLabel(ref) {
  if (!ref) return '∅';
  const n = normalizeColumn({ references: ref }).references;
  const od = n.onDelete ? ` ON DELETE ${n.onDelete}` : '';
  return `${n.table}.${n.column}${od}`;
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
      const pn = normalizeColumn(prev);
      const cn = normalizeColumn(c);
      const changes = [];
      if (pn.type !== cn.type) changes.push(`type ${pn.type} → ${cn.type}`);
      if ((pn.length ?? null) !== (cn.length ?? null))
        changes.push(`length ${pn.length ?? '∅'} → ${cn.length ?? '∅'}`);
      if (pn.notNull !== cn.notNull) changes.push(cn.notNull ? 'now NOT NULL' : 'now nullable');
      if (pn.pk !== cn.pk) changes.push(cn.pk ? 'now PK' : 'no longer PK');
      if (pn.unique !== cn.unique) changes.push(cn.unique ? 'now UNIQUE' : 'no longer UNIQUE');
      if (pn.default !== cn.default)
        changes.push(`default ${pn.default ?? '∅'} → ${cn.default ?? '∅'}`);
      const pr = refLabel(prev.references);
      const nr = refLabel(c.references);
      if (pr !== nr) changes.push(`ref ${pr} → ${nr}`);
      else {
        const pod = normalizeOnDelete(prev.references?.onDelete);
        const nod = normalizeOnDelete(c.references?.onDelete);
        if (pod !== nod) changes.push(`onDelete ${pod ?? '∅'} → ${nod ?? '∅'}`);
      }
      const delta = {};
      if (
        pn.type !== cn.type ||
        (pn.length ?? null) !== (cn.length ?? null) ||
        !!pn.array !== !!cn.array
      )
        delta.type = true;
      if (pn.notNull !== cn.notNull) delta.notNull = cn.notNull;
      if (pn.unique !== cn.unique) delta.unique = cn.unique;
      if (pn.default !== cn.default) delta.default = cn.default;
      if (pr !== nr) delta.references = cn.references || null;
      result.push({ ...c, status: 'modified', changes, delta });
      changelog.push({
        kind: 'column-modified',
        table: tableName,
        column: c.name,
        detail: changes.join(', ') || 'normalized fields differ',
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
  const oldN = normalizeSchema(oldSchema);
  const newN = normalizeSchema(newSchema);
  const changelog = [];
  const oldTables = new Map((oldN.tables || []).map((t) => [tableKey(t), t]));
  const newTables = new Map((newN.tables || []).map((t) => [tableKey(t), t]));
  const tables = [];

  for (const t of newN.tables) {
    const key = tableKey(t);
    const prev = oldTables.get(key);
    // Changelog/UI still use bare table name (canvas keys on t.name); maps use schema.name.
    const label = t.name;
    if (!prev) {
      const cols = diffColumns([], t.columns, [], label).map((c) => ({ ...c, status: 'added' }));
      tables.push({ ...t, status: 'added', columns: cols });
      changelog.push({ kind: 'table-added', table: label, detail: `${t.columns.length} columns` });
    } else {
      const cols = diffColumns(prev.columns, t.columns, changelog, label);
      const changed = cols.some((c) => c.status !== 'unchanged');
      tables.push({ ...t, status: changed ? 'modified' : 'unchanged', columns: cols });
    }
  }
  for (const t of oldN.tables || []) {
    const key = tableKey(t);
    if (!newTables.has(key)) {
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

  const oldEnums = new Map((oldN.enums || []).map((e) => [e.name, e]));
  const newEnums = new Map((newN.enums || []).map((e) => [e.name, e]));
  for (const e of newN.enums || []) {
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
  for (const e of oldN.enums || []) {
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
    relations: newN.relations,
    enums: newN.enums,
    dialect: newN.dialect,
    changelog,
    counts,
  };
}

export { diffSchemas, describeColumn, colSignature };
