// db-diagram canvas engine — vanilla JS, no build step.
'use strict';

const $ = (s) => document.querySelector(s);
const SVGNS = 'http://www.w3.org/2000/svg';

// Per-boot session token from the URL the CLI opened — required on /api/* and /events.
// Kept in the address bar (never stripped) so reloads keep working.
const SESSION_TOKEN = new URLSearchParams(location.search).get('token') || '';
const withToken = (url) =>
  `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(SESSION_TOKEN)}`;
const ROW_H = 30,
  HEAD_H = 44,
  CARD_W = 268;

/** Distinct palette for module/schema header colors (auth, billing, …). */
const MODULE_PALETTE = [
  '#47c1d6',
  '#3ecf7c',
  '#eaa63c',
  '#a78bfa',
  '#f0616b',
  '#5b8def',
  '#e07a5f',
  '#81b29a',
  '#c77dff',
  '#4ecdc4',
];

/** Memoized module list for the current diff — avoids O(T²) rebuilds per paint. */
let _moduleListCache = { diff: null, mods: [] };
function moduleList(diff) {
  if (_moduleListCache.diff === diff) return _moduleListCache.mods;
  const mods = [
    ...new Set(
      (diff?.tables || [])
        .map((t) => t.schema)
        .filter(Boolean)
        .map((s) => String(s).toLowerCase()),
    ),
  ].sort();
  _moduleListCache = { diff, mods };
  return mods;
}

/** Color for a Postgres/Drizzle schema module — same module → same color. */
function moduleColor(schema) {
  if (!schema) return null;
  const key = String(schema).toLowerCase();
  const mods = moduleList(currentDiff());
  let idx = mods.indexOf(key);
  if (idx < 0) {
    // fallback if render runs before tables are known
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    idx = (h >>> 0) % MODULE_PALETTE.length;
  }
  return MODULE_PALETTE[idx % MODULE_PALETTE.length];
}
/** Header color for a table — same schema/module → same color. */
function tableColor(t) {
  return moduleColor(t && t.schema);
}

const state = {
  payload: null, // full server payload
  view: { x: 60, y: 60, k: 1 },
  pos: {}, // tableName -> {x,y}
  diffMode: false,
  changesOnly: false,
  search: '',
  selected: null,
  hover: null,
  base: null, // version id baseline for compare
  target: null, // version id being viewed
  liveTarget: true, // follow latest
  versionsOpen: true, // versions list expanded (collapsed → Latest only)
  migOpen: false, // migration file panel open
  key: 'default', // localStorage namespace (per target file)
};

// ---------------- persistence ----------------
function saveLayout() {
  try {
    localStorage.setItem('dbd:' + state.key, JSON.stringify(state.pos));
  } catch {}
}
function loadLayout() {
  try {
    return JSON.parse(localStorage.getItem('dbd:' + state.key) || '{}');
  } catch {
    return {};
  }
}
function saveUIPrefs() {
  try {
    localStorage.setItem(
      'dbd:ui',
      JSON.stringify({
        diff: state.diffMode,
        sidebar: document.body.classList.contains('sidebar-collapsed'),
        versionsOpen: state.versionsOpen,
      }),
    );
  } catch {}
}
function loadUIPrefs() {
  try {
    return JSON.parse(localStorage.getItem('dbd:ui') || '{}');
  } catch {
    return {};
  }
}

// ---------------- layout ----------------
function cardHeight(t) {
  return HEAD_H + t.columns.length * ROW_H;
}

// Layered layout: tables with no outgoing FKs on the left, dependents flow right.
function autoLayout(diff) {
  const tables = diff.tables;
  const byName = new Map(tables.map((t) => [t.name, t]));
  const refsOut = new Map(tables.map((t) => [t.name, new Set()]));
  for (const r of diff.relations || []) {
    if (byName.has(r.from) && byName.has(r.to) && r.from !== r.to) refsOut.get(r.from).add(r.to);
  }
  // longest-path layering from roots (tables that nothing points to become deepest)
  const depth = new Map();
  const visiting = new Set();
  function d(name) {
    if (depth.has(name)) return depth.get(name);
    if (visiting.has(name)) return 0;
    visiting.add(name);
    let m = 0;
    for (const to of refsOut.get(name)) m = Math.max(m, d(to) + 1);
    visiting.delete(name);
    depth.set(name, m);
    return m;
  }
  tables.forEach((t) => d(t.name));

  // adjacency in both directions for crossing-reduction
  const refsIn = new Map(tables.map((t) => [t.name, new Set()]));
  for (const [name, outs] of refsOut) for (const to of outs) refsIn.get(to)?.add(name);

  const cols = {};
  tables.forEach((t) => {
    const dp = depth.get(t.name) || 0;
    (cols[dp] ||= []).push(t);
  });
  const layerKeys = Object.keys(cols)
    .map(Number)
    .sort((a, b) => a - b);
  // initial order: alphabetical, for determinism
  layerKeys.forEach((k) => cols[k].sort((a, b) => a.name.localeCompare(b.name)));

  // Barycenter sweeps: order each layer by the average index of the nodes it
  // connects to in the neighbouring layers, so related tables line up and
  // traces cross as little as possible.
  const orderIndex = () => {
    const idx = new Map();
    layerKeys.forEach((k) => cols[k].forEach((t, i) => idx.set(t.name, i)));
    return idx;
  };
  for (let sweep = 0; sweep < 6; sweep++) {
    const forward = sweep % 2 === 0;
    const keys = forward ? layerKeys : [...layerKeys].reverse();
    const idx = orderIndex();
    for (const k of keys) {
      cols[k] = cols[k]
        .map((t) => {
          const nb = [...refsOut.get(t.name), ...refsIn.get(t.name)].filter((n) => idx.has(n));
          const bary = nb.length
            ? nb.reduce((s, n) => s + idx.get(n), 0) / nb.length
            : idx.get(t.name);
          return { t, bary };
        })
        .sort((a, b) => a.bary - b.bary || a.t.name.localeCompare(b.t.name))
        .map((o) => o.t);
    }
  }

  const GAP_X = 340,
    GAP_Y = 40;
  const pos = {};
  layerKeys.forEach((layer, ci) => {
    let y = 40;
    for (const t of cols[layer]) {
      pos[t.name] = { x: 40 + ci * GAP_X, y };
      y += cardHeight(t) + GAP_Y;
    }
  });
  return pos;
}

function rectOf(name, diff) {
  const t = diff.tables.find((x) => x.name === name);
  const p = state.pos[name];
  if (!t || !p) return null;
  return { x: p.x, y: p.y, w: CARD_W, h: cardHeight(t) };
}
function overlaps(a, b, m = 28) {
  return a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
}

function ensurePositions(diff) {
  const missing = diff.tables.filter((t) => !state.pos[t.name]);
  if (!missing.length) return;
  // First ever layout: place everything with the layered algorithm.
  if (Object.keys(state.pos).length === 0) {
    state.pos = autoLayout(diff);
    return;
  }
  // Incremental: a table was added. Place it near its auto slot but nudge it
  // down until it no longer collides with any already-placed card.
  const auto = autoLayout(diff);
  for (const t of missing) {
    const cand = { ...(auto[t.name] || { x: 40, y: 40 }) };
    const h = cardHeight(t);
    let guard = 0;
    while (guard++ < 300) {
      const box = { x: cand.x, y: cand.y, w: CARD_W, h };
      let hit = false;
      for (const other of diff.tables) {
        if (other.name === t.name || !state.pos[other.name]) continue;
        const r = rectOf(other.name, diff);
        if (r && overlaps(box, r)) {
          cand.y = r.y + r.h + 40;
          hit = true;
          break;
        }
      }
      if (!hit) break;
    }
    state.pos[t.name] = cand;
  }
}

// ---------------- rendering ----------------
const world = $('#world');
const edgesSvg = $('#edges');
const nodeEls = new Map();

function typeLabel(c) {
  let t = c.isEnum ? c.enumName || c.type : c.type;
  if (c.length) t += `(${c.length})`;
  if (c.array) t += '[]';
  return t;
}

// ---------------- focus mode (table + N-hop neighborhood) ----------------
function focusSet() {
  if (!state.focus) return null;
  const { table, depth } = state.focus;
  const rels = currentDiff().relations || [];
  const set = new Set([table]);
  for (let d = 0; d < depth; d++) {
    const frozen = new Set(set); // expand against this hop's frontier only
    for (const r of rels) {
      if (frozen.has(r.from)) set.add(r.to);
      if (frozen.has(r.to)) set.add(r.from);
    }
  }
  return set;
}
function updateFocusChip() {
  const chip = $('#focus-chip');
  if (!state.focus) {
    chip.hidden = true;
    return;
  }
  chip.hidden = false;
  chip.textContent = `⊙ ${state.focus.table} + ${state.focus.depth} hop${state.focus.depth > 1 ? 's' : ''} · press . to cycle · Esc to exit`;
}
// press . : focus selected table → widen to 2 hops → off
function cycleFocus() {
  const name = state.selected || (state.focus && state.focus.table);
  if (!name) {
    flash('select a table first, then press . to focus on it');
    return;
  }
  if (!state.focus || state.focus.table !== name) state.focus = { table: name, depth: 1 };
  else if (state.focus.depth === 1) state.focus.depth = 2;
  else state.focus = null;
  updateFocusChip();
  render();
  fitView();
}

function render() {
  const diff = currentDiff();
  const emptyEl = $('#empty-stage');
  if (emptyEl) emptyEl.hidden = !!(diff && diff.tables.length);
  if (!diff) return;
  ensurePositions(diff);

  const changedNames = new Set(
    diff.tables.filter((t) => t.status && t.status !== 'unchanged').map((t) => t.name),
  );
  const showDiff = state.diffMode;
  const onlyChanges = state.diffMode && state.changesOnly;
  const fset = focusSet();

  // --- nodes ---
  const seen = new Set();
  for (const t of diff.tables) {
    if (onlyChanges && !changedNames.has(t.name)) continue;
    if (fset && !fset.has(t.name)) continue;
    seen.add(t.name);
    let el = nodeEls.get(t.name);
    if (!el) {
      el = document.createElement('div');
      el.className = 'node';
      world.appendChild(el);
      nodeEls.set(t.name, el);
      attachDrag(el, t.name);
    }
    const p = state.pos[t.name] || { x: 0, y: 0 };
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    el.dataset.table = t.name;
    // in diff mode, fade unchanged tables so the delta pops (hover/select restores them)
    const diffDim =
      showDiff && !onlyChanges && changedNames.size > 0 && (!t.status || t.status === 'unchanged');
    const tag = tableColor(t);
    el.className =
      'node' +
      (showDiff && t.status ? ' st-' + t.status : '') +
      (diffDim ? ' diff-dim' : '') +
      (tag ? ' tagged' : '');
    if (tag) el.style.setProperty('--tagc', tag);
    else el.style.removeProperty('--tagc');
    if (state.multi && state.multi.has(t.name)) el.classList.add('msel');

    const matchesSearch = state.search && t.name.toLowerCase().includes(state.search);
    el.innerHTML = nodeHTML(t, showDiff);
    if (matchesSearch) el.classList.add('sel');
  }
  // remove stale nodes
  for (const [name, el] of nodeEls)
    if (!seen.has(name)) {
      el.remove();
      nodeEls.delete(name);
    }

  drawEdges(diff, onlyChanges, changedNames);
  applyTransform();
  renderMinimap(diff);
  applyHighlight();
  updateInspector();
}

const TABLE_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2" width="13" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 6h13M1.5 10h13M6 6v8" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;

function nodeHTML(t, showDiff) {
  const badge =
    showDiff && t.status && t.status !== 'unchanged'
      ? `<span class="badge ${t.status}">${t.status}</span>`
      : '';
  const rows = t.columns
    .map((c) => {
      const cls = ['row'];
      if (c.pk) cls.push('pk');
      if (c.references) cls.push('fk');
      if (c.isEnum) cls.push('enum');
      if (showDiff && c.status && c.status !== 'unchanged') cls.push('d-' + c.status);
      const keys = [];
      if (c.pk) keys.push(['pk', 'PK']);
      if (c.references && !c.pk) keys.push(['fk', 'FK']);
      if (c.notNull && !c.pk) keys.push(['nn', 'NN']);
      if (c.unique && !c.pk) keys.push(['u', 'U']);
      const keysHtml = keys.length
        ? `<span class="ckeys">${keys.map(([k, lab]) => `<span class="ck ck-${k}">${lab}</span>`).join('')}</span>`
        : `<span class="ckeys"></span>`;
      const delta =
        showDiff && c.status === 'modified' && c.changes
          ? `<span class="delta">↳ ${escapeHtml(c.changes.join(' · '))}</span>`
          : '';
      return `<div class="${cls.join(' ')}" data-col="${escapeHtml(c.key)}">
      <span class="pin"></span>
      <span class="cname">${escapeHtml(c.name)}</span>
      ${keysHtml}
      <span class="ctype">${escapeHtml(typeLabel(c))}</span>
      ${delta}
    </div>`;
    })
    .join('');
  const schema = t.schema ? `<span class="tschema">${escapeHtml(t.schema)}</span>` : '';
  return `<div class="head" data-drag="1">
      <span class="ticon">${TABLE_ICON}</span>
      <span class="tmeta">${schema}<span class="tname">${escapeHtml(t.name)}</span></span>
      <span class="thead-right">${badge}<span class="count">${t.columns.length}</span></span>
    </div><div class="rows">${rows}</div>`;
}

// ---------------- edges (traces) ----------------
function colIndex(t, key) {
  return t.columns.findIndex((c) => c.key === key);
}

function anchorFor(name, colKey, side) {
  const t = currentDiff().tables.find((x) => x.name === name);
  const p = state.pos[name];
  if (!t || !p) return null;
  const idx = Math.max(0, colIndex(t, colKey));
  const y = p.y + HEAD_H + idx * ROW_H + ROW_H / 2;
  const x = side === 'right' ? p.x + CARD_W : p.x;
  return { x, y };
}

function drawEdges(diff, onlyChanges, changedNames) {
  edgesSvg.innerHTML = '';
  const visible = new Set([...nodeEls.keys()]);
  for (const r of diff.relations || []) {
    if (!visible.has(r.from) || !visible.has(r.to)) continue;
    const pf = state.pos[r.from],
      pt = state.pos[r.to];
    if (!pf || !pt) continue;
    const fromRight = pf.x + CARD_W / 2 <= pt.x + CARD_W / 2;
    const a = anchorFor(r.from, r.fromKey, fromRight ? 'right' : 'left');
    const b = anchorFor(r.to, r.toColumn, fromRight ? 'left' : 'right');
    if (!a || !b) continue;

    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    const c1x = a.x + (fromRight ? dx : -dx);
    const c2x = b.x + (fromRight ? -dx : dx);
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', `M ${a.x} ${a.y} C ${c1x} ${a.y}, ${c2x} ${b.y}, ${b.x} ${b.y}`);
    path.setAttribute('class', 'edge');
    path.dataset.from = r.from;
    path.dataset.to = r.to;
    edgesSvg.appendChild(path);

    // invisible wide twin for hover — shows the relation tooltip
    const hit = document.createElementNS(SVGNS, 'path');
    hit.setAttribute('d', path.getAttribute('d'));
    hit.setAttribute('class', 'edge-hit');
    hit.dataset.from = r.from;
    hit.dataset.to = r.to;
    hit.dataset.fromkey = r.fromKey;
    const toTable = diff.tables.find((x) => x.name === r.to);
    const toCol = toTable && toTable.columns.find((c) => c.name === r.toColumn);
    hit.dataset.tokey = toCol ? toCol.key : '';
    hit.dataset.label = `${r.from}.${r.fromColumn} → ${r.to}.${r.toColumn}${r.onDelete ? '  ·  on delete ' + r.onDelete : ''}`;
    edgesSvg.appendChild(hit);

    // cardinality: the FK holder is the "many" side (unless the FK is unique → 1:1),
    // the referenced PK is the "one" side. A nullable FK makes the many side optional.
    const srcTable = diff.tables.find((x) => x.name === r.from);
    const fk = srcTable && srcTable.columns.find((c) => c.key === r.fromKey);
    const manySide = fk && fk.unique ? 'one' : 'many';
    const optional = fk && !fk.notNull && !fk.pk;
    drawMarker(a.x, a.y, fromRight ? 1 : -1, manySide, optional, r.from, r.to);
    drawMarker(b.x, b.y, fromRight ? -1 : 1, 'one', false, r.from, r.to);
  }

  // in diff mode, fade wires that don't touch a changed table
  if (state.diffMode && !state.changesOnly) {
    const changed = new Set(
      diff.tables.filter((t) => t.status && t.status !== 'unchanged').map((t) => t.name),
    );
    if (changed.size) {
      edgesSvg.querySelectorAll('.edge, .edge-cap, .marker').forEach((e) => {
        if (!changed.has(e.dataset.from) && !changed.has(e.dataset.to))
          e.classList.add('diff-faded');
      });
    }
  }
}

// Draw a crow's-foot / bar marker at a card edge. dir = +1 if the wire leaves
// to the right of the point, -1 if to the left.
function drawMarker(x, y, dir, kind, optional, from, to) {
  const add = (d, cls) => {
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', 'marker' + (cls ? ' ' + cls : ''));
    p.dataset.from = from;
    p.dataset.to = to;
    edgesSvg.appendChild(p);
  };
  if (kind === 'many') {
    const apex = x + dir * 13;
    add(`M ${apex} ${y} L ${x} ${y - 7} M ${apex} ${y} L ${x} ${y} M ${apex} ${y} L ${x} ${y + 7}`);
  } else {
    // one — a single perpendicular bar
    const bx = x + dir * 9;
    add(`M ${bx} ${y - 6} L ${bx} ${y + 6}`);
  }
  if (optional) {
    const cx = x + dir * 20;
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('cx', cx);
    c.setAttribute('cy', y);
    c.setAttribute('r', 3.5);
    c.setAttribute('class', 'marker dot');
    c.dataset.from = from;
    c.dataset.to = to;
    edgesSvg.appendChild(c);
  }
}

// ---------------- highlight ----------------
function applyHighlight() {
  const path = state.path;
  if (path) {
    for (const [name, el] of nodeEls) {
      el.classList.remove('dim', 'hi', 'sel');
      if (path.names.includes(name))
        el.classList.add(
          name === path.names[0] || name === path.names[path.names.length - 1] ? 'sel' : 'hi',
        );
      else el.classList.add('dim');
    }
    edgesSvg.querySelectorAll('.edge, .edge-cap, .marker').forEach((e) => {
      e.classList.remove('hl', 'flow', 'faded');
      if (path.pairs.has(e.dataset.from + '→' + e.dataset.to)) {
        e.classList.add('hl');
        if (e.classList.contains('edge')) e.classList.add('flow');
      } else e.classList.add('faded');
    });
    return;
  }
  const focus = state.hover || state.selected;
  const neighbors = new Set();
  if (focus) {
    neighbors.add(focus);
    for (const r of currentDiff().relations || []) {
      if (r.from === focus) neighbors.add(r.to);
      if (r.to === focus) neighbors.add(r.from);
    }
  }
  for (const [name, el] of nodeEls) {
    el.classList.remove('dim', 'hi', 'sel');
    if (focus) {
      if (name === focus) el.classList.add('sel');
      else if (neighbors.has(name)) el.classList.add('hi');
      else el.classList.add('dim');
    } else if (state.search && name.toLowerCase().includes(state.search)) {
      el.classList.add('hi');
    }
  }
  edgesSvg.querySelectorAll('.edge, .edge-cap, .marker').forEach((e) => {
    e.classList.remove('hl', 'flow', 'faded');
    if (!focus) return;
    if (e.dataset.from === focus || e.dataset.to === focus) {
      e.classList.add('hl');
      if (e.classList.contains('edge')) e.classList.add('flow');
    } else e.classList.add('faded');
  });
}

function setSelected(name) {
  clearPath(true);
  state.selected = name === state.selected ? null : name;
  applyHighlight();
  updateInspector();
}

// ---------------- join path finder (shift-click two tables) ----------------
function findPath(a, b) {
  const rels = currentDiff().relations || [];
  const adj = {};
  for (const r of rels) {
    (adj[r.from] ||= []).push(r.to);
    (adj[r.to] ||= []).push(r.from);
  }
  const prev = { [a]: null };
  const queue = [a];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === b) break;
    for (const n of adj[cur] || [])
      if (!(n in prev)) {
        prev[n] = cur;
        queue.push(n);
      }
  }
  if (!(b in prev)) return null;
  const names = [];
  for (let n = b; n != null; n = prev[n]) names.unshift(n);
  return names;
}

function pathSQL(names) {
  const rels = currentDiff().relations || [];
  let sql = 'SELECT *\nFROM ' + names[0];
  for (let i = 1; i < names.length; i++) {
    const a = names[i - 1],
      b = names[i];
    const r = rels.find((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
    if (!r) continue;
    const on =
      r.from === b
        ? `${b}.${r.fromColumn} = ${a}.${r.toColumn}`
        : `${a}.${r.fromColumn} = ${b}.${r.toColumn}`;
    sql += `\nJOIN ${b} ON ${on}`;
  }
  return sql + ';';
}

function setPath(a, b) {
  const names = findPath(a, b);
  if (!names) {
    flash(`no relationship path between ${a} and ${b}`);
    return;
  }
  const pairs = new Set();
  for (let i = 1; i < names.length; i++) {
    pairs.add(names[i - 1] + '→' + names[i]);
    pairs.add(names[i] + '→' + names[i - 1]);
  }
  state.path = { names, pairs, sql: pathSQL(names) };
  $('#pb-chain').innerHTML = names
    .map((n) => `<b>${escapeHtml(n)}</b>`)
    .join('<span class="pb-arr"> → </span>');
  $('#pb-sql').textContent = state.path.sql;
  $('#pathbar').classList.add('on');
  applyHighlight();
}
function clearPath(silent) {
  if (!state.path) return;
  state.path = null;
  $('#pathbar').classList.remove('on');
  if (!silent) applyHighlight();
}
// hover a wire → tooltip with the relation detail (delegated, survives redraws)
function setupEdgeTips() {
  const tip = $('#edge-tip');
  const setHl = (from, to, on) => {
    edgesSvg.querySelectorAll('.edge, .marker, .edge-cap').forEach((el) => {
      if (el.dataset.from === from && el.dataset.to === to) {
        el.classList.toggle('hl', on);
        if (el.classList.contains('edge')) el.classList.toggle('flow', on);
      }
    });
  };
  const glowRows = (h, on) => {
    const q = (t, k) =>
      k &&
      document.querySelector(
        `.node[data-table="${CSS.escape(t)}"] .row[data-col="${CSS.escape(k)}"]`,
      );
    for (const row of [q(h.dataset.from, h.dataset.fromkey), q(h.dataset.to, h.dataset.tokey)]) {
      if (row) row.classList.toggle('row-glow', on);
    }
  };
  edgesSvg.addEventListener('pointerover', (e) => {
    const h = e.target.closest('.edge-hit');
    if (!h) return;
    tip.textContent = h.dataset.label;
    tip.classList.add('on');
    setHl(h.dataset.from, h.dataset.to, true);
    glowRows(h, true);
  });
  edgesSvg.addEventListener('pointermove', (e) => {
    if (!tip.classList.contains('on')) return;
    const r = $('#stage').getBoundingClientRect();
    tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 260) + 'px';
    tip.style.top = e.clientY - r.top + 12 + 'px';
  });
  edgesSvg.addEventListener('pointerout', (e) => {
    const h = e.target.closest('.edge-hit');
    if (!h) return;
    tip.classList.remove('on');
    setHl(h.dataset.from, h.dataset.to, false);
    glowRows(h, false);
  });
}

function setupPathBar() {
  $('#pb-close').addEventListener('click', () => clearPath());
  $('#pb-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.path ? state.path.sql : '');
      flash('JOIN SQL copied');
    } catch {}
  });
}

// ---------------- inspector ----------------
function updateInspector() {
  const el = $('#inspector');
  const diff = currentDiff();
  const close = () => {
    el.classList.remove('on');
    $('#minimap').classList.remove('mm-hide');
  };
  if (!state.selected || !diff) {
    close();
    return;
  }
  const t = diff.tables.find((x) => x.name === state.selected);
  if (!t) {
    close();
    return;
  }

  const rels = diff.relations || [];
  const out = rels.filter((r) => r.from === t.name);
  const inc = rels.filter((r) => r.to === t.name);
  const statusBadge =
    state.diffMode && t.status && t.status !== 'unchanged'
      ? `<span class="ins-badge ${t.status}">${t.status}</span>`
      : '';

  const colHTML = t.columns
    .map((c) => {
      const cls = ['ins-col'];
      if (c.pk) cls.push('pk');
      if (c.references) cls.push('fk');
      const flags = [];
      if (c.pk) flags.push('PK');
      if (c.references && !c.pk) flags.push('FK');
      if (c.notNull && !c.pk) flags.push('not null');
      if (c.unique && !c.pk) flags.push('unique');
      if (c.default != null) flags.push('default ' + c.default);
      const enumLine =
        c.isEnum && c.enumValues
          ? `<div class="ins-enum">enum <span class="ev">${c.enumValues.map(escapeHtml).join(' · ')}</span></div>`
          : '';
      return `<div class="${cls.join(' ')}">
      <div class="ins-col-main"><span class="dotp"></span><span class="cn">${escapeHtml(c.name)}</span><span class="ct">${escapeHtml(typeLabel(c))}</span></div>
      ${flags.length ? `<div class="cf">${escapeHtml(flags.join(' · '))}</div>` : ''}${enumLine}
    </div>`;
    })
    .join('');

  const tableLabelOf = (name) => {
    const tbl = diff.tables.find((x) => x.name === name);
    return tbl?.schema ? `${tbl.schema}.${tbl.name}` : name;
  };
  const outHTML = out.length
    ? out
        .map((r) => {
          const target = `${tableLabelOf(r.to)}.${r.toColumn}`;
          const meta = r.onDelete ? `on delete ${r.onDelete}` : '';
          return `<div class="ins-rel" data-goto="${escapeHtml(r.to)}" title="${escapeHtml(r.fromColumn)} → ${escapeHtml(target)}">
      <div class="ins-rel-line"><span class="cn">${escapeHtml(r.fromColumn)}</span><span class="arw">→</span><span class="ins-rel-target"><b>${escapeHtml(tableLabelOf(r.to))}</b>.${escapeHtml(r.toColumn)}</span></div>
      ${meta ? `<div class="ins-rel-meta">${escapeHtml(meta)}</div>` : ''}
    </div>`;
        })
        .join('')
    : '<div class="ins-empty">none</div>';

  const incHTML = inc.length
    ? inc
        .map((r) => {
          const source = `${tableLabelOf(r.from)}.${r.fromColumn}`;
          const meta = r.onDelete ? `on delete ${r.onDelete}` : '';
          return `<div class="ins-rel" data-goto="${escapeHtml(r.from)}" title="${escapeHtml(source)} → ${escapeHtml(r.toColumn)}">
      <div class="ins-rel-line"><span class="ins-rel-target"><b>${escapeHtml(tableLabelOf(r.from))}</b>.${escapeHtml(r.fromColumn)}</span><span class="arw">→</span><span class="cn">${escapeHtml(r.toColumn)}</span></div>
      ${meta ? `<div class="ins-rel-meta">${escapeHtml(meta)}</div>` : ''}
    </div>`;
        })
        .join('')
    : '<div class="ins-empty">none</div>';

  const idxHTML =
    t.indexes && t.indexes.length
      ? t.indexes
          .map((i) => {
            const cols = (i.columns || []).join(', ');
            const meta = [i.unique ? 'unique' : '', cols].filter(Boolean).join(' · ');
            return `<div class="ins-idx" title="${escapeHtml(i.name)}">
        <span class="ins-idx-name">${escapeHtml(i.name)}</span>
        ${meta ? `<span class="ins-idx-meta">${escapeHtml(meta)}</span>` : ''}
      </div>`;
          })
          .join('')
      : '';

  const modColor = moduleColor(t.schema);
  const tableLabel = t.schema ? `${t.schema}.${t.name}` : t.name;
  const moduleChip = t.schema
    ? `<div class="mod-chip"><span class="mod-sw" style="--c:${modColor}"></span><span>Module <b>${escapeHtml(t.schema)}</b> — shared header color</span></div>`
    : `<p class="tag-hint">No schema/module on this table.</p>`;
  el.innerHTML = `
    <div class="ins-head">
      <div class="ins-title-wrap">
        <span class="ins-title" title="${escapeHtml(tableLabel)}">${escapeHtml(tableLabel)}</span>
        ${statusBadge}
      </div>
      <div class="ins-head-right">
        <span class="ins-sub">${t.dialect || diff.dialect} · ${t.columns.length} cols</span>
        <button class="ins-close" title="Close (Esc)" type="button">✕</button>
      </div>
    </div>
    <div class="ins-body">
      <div class="ins-sec ins-sec-tags">
        <h5>Module</h5>
        ${moduleChip}
      </div>
      <div class="ins-sec"><h5>Columns <span class="n">${t.columns.length}</span></h5>${colHTML}</div>
      <div class="ins-sec"><h5>References <span class="n">${out.length}</span></h5>${outHTML}</div>
      <div class="ins-sec"><h5>Referenced by <span class="n">${inc.length}</span></h5>${incHTML}</div>
      ${idxHTML ? `<div class="ins-sec"><h5>Indexes <span class="n">${t.indexes.length}</span></h5>${idxHTML}</div>` : ''}
    </div>`;
  el.classList.add('on');
  $('#minimap').classList.add('mm-hide');
  el.querySelector('.ins-close').addEventListener('click', () => setSelected(null));
  el.querySelectorAll('[data-goto]').forEach((r) =>
    r.addEventListener('click', () => {
      const name = r.dataset.goto;
      if (!state.pos[name]) return;
      state.selected = name;
      applyHighlight();
      updateInspector();
      centerOn(name);
    }),
  );
}

// ---------------- transform / pan / zoom ----------------
let _mmRaf = null;
function scheduleMinimap(diff) {
  if (_mmRaf) return;
  _mmRaf = requestAnimationFrame(() => {
    _mmRaf = null;
    if (diff) renderMinimap(diff);
  });
}

function applyTransform() {
  const { x, y, k } = state.view;
  world.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  const stage = $('#stage');
  stage.style.setProperty('--gs', 26 * k + 'px');
  stage.style.setProperty('--gx', x + 'px');
  stage.style.setProperty('--gy', y + 'px');
  $('#zoom-label').textContent = Math.round(k * 100) + '%';
  updateViewport();
}

function zoomAt(cx, cy, factor) {
  cancelViewAnim();
  const k0 = state.view.k;
  const k = Math.min(2.4, Math.max(0.2, k0 * factor));
  const r = k / k0;
  state.view.x = cx - (cx - state.view.x) * r;
  state.view.y = cy - (cy - state.view.y) * r;
  state.view.k = k;
  applyTransform();
}

function setupCanvas() {
  const stage = $('#stage');
  const rubber = $('#rubber');
  let mode = null,
    sx = 0,
    sy = 0,
    ox = 0,
    oy = 0; // 'pan' | 'rubber'

  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.node') || e.target.closest('.dock')) return;
    cancelViewAnim();
    const r = stage.getBoundingClientRect();
    sx = e.clientX;
    sy = e.clientY;
    ox = state.view.x;
    oy = state.view.y;
    if (e.shiftKey) {
      mode = 'rubber';
      rubber.hidden = false;
      rubber.style.left = sx - r.left + 'px';
      rubber.style.top = sy - r.top + 'px';
      rubber.style.width = '0px';
      rubber.style.height = '0px';
    } else {
      mode = 'pan';
      stage.classList.add('panning');
      clearMulti();
      if (state.selected) setSelected(null);
    }
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (mode === 'pan') {
      state.view.x = ox + (e.clientX - sx);
      state.view.y = oy + (e.clientY - sy);
      applyTransform();
    } else if (mode === 'rubber') {
      const r = stage.getBoundingClientRect();
      rubber.style.left = Math.min(sx, e.clientX) - r.left + 'px';
      rubber.style.top = Math.min(sy, e.clientY) - r.top + 'px';
      rubber.style.width = Math.abs(e.clientX - sx) + 'px';
      rubber.style.height = Math.abs(e.clientY - sy) + 'px';
    }
  });
  const endPan = (e) => {
    if (mode === 'rubber') {
      rubber.hidden = true;
      // rubber rect → world coords, select intersecting tables
      const r = stage.getBoundingClientRect();
      const { x, y, k } = state.view;
      const wx1 = (Math.min(sx, e.clientX) - r.left - x) / k,
        wy1 = (Math.min(sy, e.clientY) - r.top - y) / k;
      const wx2 = (Math.max(sx, e.clientX) - r.left - x) / k,
        wy2 = (Math.max(sy, e.clientY) - r.top - y) / k;
      const diff = currentDiff();
      const hits = new Set();
      if (diff)
        for (const t of diff.tables) {
          const p = state.pos[t.name];
          if (!p || !nodeEls.has(t.name)) continue;
          const h = cardHeight(t);
          if (p.x < wx2 && p.x + CARD_W > wx1 && p.y < wy2 && p.y + h > wy1) hits.add(t.name);
        }
      state.multi = hits.size ? hits : null;
      applyMulti();
      if (hits.size)
        flash(
          `${hits.size} table${hits.size > 1 ? 's' : ''} selected — drag any one to move the group`,
        );
    }
    mode = null;
    stage.classList.remove('panning');
  };
  stage.addEventListener('pointerup', endPan);
  stage.addEventListener('pointercancel', endPan);

  stage.addEventListener(
    'wheel',
    (e) => {
      // Let docked panels (inspector, etc.) scroll natively — don't steal the wheel for zoom
      if (e.target.closest('.dock')) return;
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const cx = e.clientX - rect.left,
        cy = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 0) {
        const factor = Math.pow(1.0015, -e.deltaY);
        zoomAt(cx, cy, factor);
      }
    },
    { passive: false },
  );

  // double-click empty canvas: zoom in (⇧ = zoom out)
  stage.addEventListener('dblclick', (e) => {
    if (e.target.closest('.node') || e.target.closest('.dock')) return;
    const rect = stage.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.shiftKey ? 1 / 1.4 : 1.4);
  });
}

// ---------------- layout undo (⌘Z) ----------------
const layoutHistory = [];
function pushLayout() {
  layoutHistory.push(JSON.stringify(state.pos));
  if (layoutHistory.length > 30) layoutHistory.shift();
}
function undoLayout() {
  const prev = layoutHistory.pop();
  if (!prev) {
    flash('nothing to undo');
    return;
  }
  state.pos = JSON.parse(prev);
  saveLayout();
  render();
  flash('layout restored');
}

// ---------------- multi-select (⇧-drag a rubber band) ----------------
function applyMulti() {
  for (const [n, el] of nodeEls) el.classList.toggle('msel', !!(state.multi && state.multi.has(n)));
}
function clearMulti() {
  if (!state.multi) return;
  state.multi = null;
  applyMulti();
}

// drag a card by its header — moves the whole multi-selection if this card is in it
function attachDrag(el, name) {
  el.addEventListener('pointerdown', (e) => {
    const head = e.target.closest('[data-drag]');
    if (!head) return;
    e.stopPropagation();
    cancelViewAnim();
    if (state.multi && !state.multi.has(name)) clearMulti();
    pushLayout();
    const group = state.multi && state.multi.has(name) ? [...state.multi] : [name];
    const startX = e.clientX,
      startY = e.clientY;
    const p0s = {};
    for (const n of group) p0s[n] = { ...(state.pos[n] || { x: 0, y: 0 }) };
    el.setPointerCapture(e.pointerId);
    let raf = null;
    const move = (ev) => {
      const k = state.view.k;
      const dx = (ev.clientX - startX) / k,
        dy = (ev.clientY - startY) / k;
      for (const n of group) {
        state.pos[n] = { x: p0s[n].x + dx, y: p0s[n].y + dy };
        const nel = nodeEls.get(n);
        if (nel) {
          nel.style.left = state.pos[n].x + 'px';
          nel.style.top = state.pos[n].y + 'px';
        }
      }
      // coalesce the costly edge rebuild to one per frame
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = null;
          drawEdges(currentDiff(), state.diffMode && state.changesOnly, null);
          applyHighlight();
        });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('lostpointercapture', up);
      if (raf) cancelAnimationFrame(raf);
      drawEdges(currentDiff(), state.diffMode && state.changesOnly, null);
      saveLayout();
      scheduleMinimap(currentDiff());
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  });

  // hover + select
  el.addEventListener('pointerenter', () => {
    state.hover = name;
    applyHighlight();
  });
  el.addEventListener('pointerleave', () => {
    if (state.hover === name) state.hover = null;
    applyHighlight();
  });
  el.addEventListener('click', (e) => {
    if (e.shiftKey && state.selected && state.selected !== name) {
      setPath(state.selected, name);
      return;
    }
    if (e.target.closest('[data-drag]')) setSelected(name);
  });
  el.addEventListener('dblclick', () => el.classList.toggle('show-delta'));
}

// ---------------- camera (smooth animated pan/zoom) ----------------
let viewAnim = null;
function cancelViewAnim() {
  if (viewAnim) {
    cancelAnimationFrame(viewAnim);
    viewAnim = null;
  }
}
const prefersReduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
function animateView(tx, ty, tk, dur = 420) {
  cancelViewAnim();
  if (prefersReduce) {
    state.view.x = tx;
    state.view.y = ty;
    state.view.k = tk;
    applyTransform();
    return;
  }
  const s = { ...state.view },
    t0 = performance.now();
  const ease = (p) => 1 - Math.pow(1 - p, 3); // easeOutCubic
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur),
      e = ease(p);
    state.view.x = s.x + (tx - s.x) * e;
    state.view.y = s.y + (ty - s.y) * e;
    state.view.k = s.k + (tk - s.k) * e;
    applyTransform();
    viewAnim = p < 1 ? requestAnimationFrame(step) : null;
  };
  viewAnim = requestAnimationFrame(step);
}

// ---------------- fit ----------------
// Wait for the stage to have real dimensions before fitting (avoids the
// zoom floor when the layout hasn't settled yet, e.g. inside an iframe).
function fitWhenReady(tries = 30) {
  const r = $('#stage').getBoundingClientRect();
  if (r.width > 200 && r.height > 160 && nodeEls.size) {
    fitView(false);
    return;
  }
  if (tries > 0) requestAnimationFrame(() => fitWhenReady(tries - 1));
}

function fitView(animate = true) {
  const diff = currentDiff();
  if (!diff) return;
  const names = [...nodeEls.keys()];
  if (!names.length) return;
  fitToNames(names, diff, animate);
}

/** Zoom the camera to the bounding box of the given table names. */
function fitToNames(names, diff, animate = true) {
  if (!names.length) return;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let count = 0;
  for (const name of names) {
    const t = diff.tables.find((x) => x.name === name);
    const p = state.pos[name];
    if (!t || !p) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + CARD_W);
    maxY = Math.max(maxY, p.y + cardHeight(t));
    count++;
  }
  if (!count || !Number.isFinite(minX)) return;

  // Single changed table → same feel as click-to-focus
  if (count === 1) {
    const only = names.find((n) => state.pos[n] && diff.tables.some((t) => t.name === n));
    if (only) {
      centerOn(only);
      return;
    }
  }

  const stage = $('#stage');
  const rect = stage.getBoundingClientRect();
  const pad = 72;
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  // Closer ceiling for small change clusters so migration diffs feel "zoomed in"
  const kMax = count <= 3 ? 1.35 : count <= 8 ? 1.15 : 1.0;
  const k = Math.max(
    0.28,
    Math.min(kMax, Math.min((rect.width - pad * 2) / bw, (rect.height - pad * 2) / bh)),
  );
  const rightPad = $('#inspector').classList.contains('on') ? 316 : 0;
  const usableW = rect.width - rightPad;
  const tx = pad - minX * k + (usableW - pad * 2 - bw * k) / 2;
  const ty = pad - minY * k + (rect.height - pad * 2 - bh * k) / 2;
  if (animate) animateView(tx, ty, k, 480);
  else {
    state.view.x = tx;
    state.view.y = ty;
    state.view.k = k;
    applyTransform();
  }
}

/** Zoom to tables touched by the current diff (added / modified / removed). */
function fitToChanges(diff, animate = true) {
  if (!diff) {
    fitView(animate);
    return;
  }
  const changed = (diff.tables || []).filter((t) => t.status && t.status !== 'unchanged');
  const names = changed.map((t) => t.name).filter((n) => nodeEls.has(n) && state.pos[n]);
  if (!names.length) {
    fitView(animate);
    return;
  }
  fitToNames(names, diff, animate);
}

// ---------------- minimap ----------------
function updateViewport() {
  const diff = currentDiff();
  if (diff) scheduleMinimap(diff);
}
// world → minimap transform (shared by rendering and click-navigation)
function minimapTransform(diff) {
  const names = [...nodeEls.keys()];
  let minX = 0,
    minY = 0,
    maxX = 1000,
    maxY = 700;
  if (names.length) {
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    for (const name of names) {
      const t = diff.tables.find((x) => x.name === name);
      const p = state.pos[name];
      if (!t || !p) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + CARD_W);
      maxY = Math.max(maxY, p.y + cardHeight(t));
    }
  }
  const W = 172,
    H = 116,
    pad = 8;
  const s = Math.min((W - pad * 2) / (maxX - minX || 1), (H - pad * 2) / (maxY - minY || 1));
  return { s, tx: pad - minX * s, ty: pad - minY * s };
}
// click or drag the minimap to move the viewport there
function setupMinimapNav() {
  const mm = $('#minimap');
  let navigating = false;
  const jump = (e) => {
    const diff = currentDiff();
    if (!diff) return;
    const { s, tx, ty } = minimapTransform(diff);
    const r = mm.getBoundingClientRect();
    const wx = (e.clientX - r.left - tx) / s;
    const wy = (e.clientY - r.top - ty) / s;
    const stage = $('#stage').getBoundingClientRect();
    cancelViewAnim();
    state.view.x = stage.width / 2 - wx * state.view.k;
    state.view.y = stage.height / 2 - wy * state.view.k;
    applyTransform();
  };
  mm.addEventListener('pointerdown', (e) => {
    navigating = true;
    jump(e);
    try {
      mm.setPointerCapture(e.pointerId);
    } catch {}
  });
  mm.addEventListener('pointermove', (e) => {
    if (navigating) jump(e);
  });
  const end = () => {
    navigating = false;
  };
  mm.addEventListener('pointerup', end);
  mm.addEventListener('pointercancel', end);
}

function renderMinimap(diff) {
  const mm = $('#mm');
  if (!diff) return;
  const names = [...nodeEls.keys()];
  const byName = new Map((diff.tables || []).map((t) => [t.name, t]));
  const { s, tx, ty } = minimapTransform(diff);
  let svg = '';
  for (const name of names) {
    const t = byName.get(name);
    const p = state.pos[name];
    if (!t || !p) continue;
    const cls = state.diffMode && t.status && t.status !== 'unchanged' ? ' ' + t.status[0] : '';
    const mc = !cls ? tableColor(t) : null;
    const tagFill = mc ? ` style="fill:${mc}"` : '';
    svg += `<rect class="mm-node${cls}"${tagFill} x="${p.x * s + tx}" y="${p.y * s + ty}" width="${CARD_W * s}" height="${cardHeight(t) * s}" rx="1.5"/>`;
  }
  // viewport rect
  const stage = $('#stage').getBoundingClientRect();
  const vx = (-state.view.x / state.view.k) * s + tx;
  const vy = (-state.view.y / state.view.k) * s + ty;
  const vw = (stage.width / state.view.k) * s;
  const vh = (stage.height / state.view.k) * s;
  svg += `<rect class="mm-view" x="${vx}" y="${vy}" width="${vw}" height="${vh}" rx="2"/>`;
  mm.innerHTML = svg;
}

// ---------------- versions / diff data ----------------
function currentDiff() {
  return state._diff || (state.payload && state.payload.diff);
}

function renderRail() {
  const p = state.payload;
  if (!p) return;
  const sec = $('#versions-sec');
  if (sec) {
    sec.classList.toggle('collapsed', !state.versionsOpen);
    const countEl = $('#versions-count');
    if (countEl) countEl.textContent = String(p.versions.length);
  }

  // versions — newest first at the top (no scroll needed to find Latest)
  const vwrap = $('#versions');
  vwrap.innerHTML = '';
  let toShow;
  if (state.versionsOpen) {
    toShow = [...p.versions].reverse(); // tip / Latest first
  } else {
    // Collapsed: strictly the tip only (Latest)
    const tip =
      p.versions.find((v) => v.kind === 'latest') ||
      p.versions.find((v) => v.id === p.current) ||
      p.versions[p.versions.length - 1];
    toShow = tip ? [tip] : [];
  }

  for (const v of toShow) {
    const item = document.createElement('button');
    item.className = 'vitem';
    if (v.id === state.target) item.classList.add('target');
    if (v.id === state.base) item.classList.add('base');
    if (v.kind === 'latest' || v.id === p.current) item.classList.add('latest');
    if (v.kind === 'migration' && v.structural === false) item.classList.add('nonstruc');

    let badge = '';
    if (v.kind === 'latest' || (v.id === p.current && v.kind !== 'migration'))
      badge = '<span class="vbadge l">Latest</span>';
    else if (v.id === state.target) badge = '<span class="vbadge t">viewing</span>';
    else if (v.id === state.base) badge = '<span class="vbadge b">baseline</span>';
    else if (v.kind === 'migration' && v.structural === false)
      badge = '<span class="vbadge n">no schema</span>';

    const when = p.migrationMode
      ? v.kind === 'latest'
        ? `live · ${v.tables} tables`
        : `${formatMigDate(v.at)} · ${v.tables} tables`
      : `${new Date(v.at).toLocaleTimeString()} · ${v.tables} tables`;
    const isLatest = v.kind === 'latest' || v.id === p.current;
    const label = isLatest
      ? v.kind === 'latest' || p.migrationMode
        ? 'Latest'
        : v.reason || 'Latest'
      : v.reason || `v${v.id}`;
    const dot = isLatest ? '★' : p.migrationMode ? String(v.id) : `v${v.id}`;

    item.innerHTML = `<span class="vdot">${escapeHtml(dot)}</span>
      <span class="vinfo"><span class="vr">${escapeHtml(label)}</span><span class="vt">${escapeHtml(when)}</span></span>
      ${badge}`;
    item.title = v.file
      ? `${v.file}\nClick to view · ⌘/Ctrl-click to set as baseline`
      : 'Click to view · ⌘/Ctrl-click to set as baseline';
    item.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey) {
        state.base = state.base === v.id ? null : v.id;
        loadComparison();
      } else {
        state.target = v.id;
        state.liveTarget = v.id === p.current;
        if (state.base === v.id) state.base = null;
        loadComparison({ focusChanges: true });
      }
    });
    vwrap.appendChild(item);
  }

  // Sticky footer control (outside the scroll list) — always visible to collapse
  const migCount = p.versions.filter((v) => v.kind === 'migration').length;
  const moreN = Math.max(0, p.versions.length - 1);
  const more = $('#versions-more');
  if (more) {
    more.setAttribute('aria-expanded', state.versionsOpen ? 'true' : 'false');
    more.title = state.versionsOpen ? 'Show Latest only' : 'View all migrations';
    const label = more.querySelector('.vm-label');
    if (label) {
      label.textContent = state.versionsOpen
        ? 'Show Latest only'
        : p.migrationMode
          ? 'View all migrations'
          : 'View all versions';
    }
    const nEl = $('#versions-more-n') || more.querySelector('.versions-count');
    if (nEl) {
      if (state.versionsOpen) {
        nEl.hidden = true;
        nEl.textContent = '';
      } else {
        nEl.hidden = false;
        nEl.textContent = String(migCount || moreN);
      }
    }
  }

  // Always pin the scroll to the top so Latest stays in view when expanded
  vwrap.scrollTop = 0;
  if (state.migOpen) refreshMigrationPanel();

  // changelog + summary + suggestions
  const diff = currentDiff();
  renderChangelog(diff);
  renderSuggestions(diff);
  const cl = $('#cmp-label');
  if (state.base && state.target) {
    const fromV = p.versions.find((x) => x.id === state.base);
    const toV = p.versions.find((x) => x.id === state.target);
    const fromL = versionShort(fromV);
    const toL = versionShort(toV);
    cl.innerHTML = `${escapeHtml(fromL)} → ${escapeHtml(toL)} <button class="cmp-clear" title="Clear baseline — back to latest-change view">✕</button>`;
    cl.querySelector('.cmp-clear').addEventListener('click', () => {
      state.base = null;
      loadComparison();
    });
  } else {
    const toV = p.versions.find((x) => x.id === state.target);
    const fromV = p.versions.find((x) => x.id === state.target - 1);
    if (p.migrationMode && toV) {
      cl.textContent = fromV ? `${versionShort(fromV)} → ${versionShort(toV)}` : versionShort(toV);
    } else {
      cl.textContent =
        state.target && state.target > 1 ? `v${state.target - 1} → v${state.target}` : 'baseline';
    }
  }
}

function formatMigDate(at) {
  try {
    const d = new Date(at);
    if (Number.isNaN(d.getTime()) || d.getUTCFullYear() <= 1970) return 'init';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
  } catch {
    return '';
  }
}

function versionShort(v) {
  if (!v) return '?';
  if (v.kind === 'latest') return 'Latest';
  if (v.reason && v.reason.length <= 28) return v.reason;
  if (v.reason) return v.reason.slice(0, 26) + '…';
  return `v${v.id}`;
}

function renderChangelog(diff) {
  const sum = $('#summary');
  const log = $('#changelog');
  const setN = (n) => {
    $('#tab-changes-n').textContent = n ? n : '';
  };
  if (!diff || !diff.changelog) {
    setN(0);
    sum.innerHTML = '';
    log.innerHTML = '<div class="empty">No prior version to compare.</div>';
    return;
  }
  setN(diff.changelog.length);
  const c = diff.counts || {};
  const pills = [];
  if (c.tablesAdded)
    pills.push(
      `<span class="pill p-add">+${c.tablesAdded} table${c.tablesAdded > 1 ? 's' : ''}</span>`,
    );
  if (c.tablesRemoved)
    pills.push(
      `<span class="pill p-rem">−${c.tablesRemoved} table${c.tablesRemoved > 1 ? 's' : ''}</span>`,
    );
  if (c.columnsAdded)
    pills.push(
      `<span class="pill p-add">+${c.columnsAdded} column${c.columnsAdded > 1 ? 's' : ''}</span>`,
    );
  if (c.columnsModified)
    pills.push(`<span class="pill p-mod">~${c.columnsModified} changed</span>`);
  if (c.columnsRemoved)
    pills.push(
      `<span class="pill p-rem">−${c.columnsRemoved} column${c.columnsRemoved > 1 ? 's' : ''}</span>`,
    );
  if (c.enumsChanged)
    pills.push(
      `<span class="pill p-mod">~${c.enumsChanged} enum${c.enumsChanged > 1 ? 's' : ''}</span>`,
    );
  sum.innerHTML = pills.join('') || '<span class="pill">no changes</span>';

  if (!diff.changelog.length) {
    log.innerHTML = diff.note
      ? `<div class="empty">${escapeHtml(diff.note)}</div>`
      : '<div class="empty">Identical to the previous version.</div>';
    return;
  }
  const tagOf = (k) => (k.includes('added') ? 'add' : k.includes('removed') ? 'rem' : 'mod');
  const verb = (k) =>
    escapeHtml(
      {
        'table-added': 'new table',
        'table-removed': 'dropped table',
        'column-added': 'added',
        'column-removed': 'removed',
        'column-modified': 'changed',
        'enum-added': 'new enum',
        'enum-removed': 'dropped enum',
        'enum-modified': 'enum changed',
      }[k] || k,
    );
  log.innerHTML = diff.changelog
    .map((e) => {
      const loc = e.enum
        ? `<b>${escapeHtml(e.enum)}</b> <span class="cl-kind">enum</span>`
        : e.column
          ? `<b>${escapeHtml(e.table)}</b>.${escapeHtml(e.column)}`
          : `<b>${escapeHtml(e.table)}</b>`;
      const detail = e.detail ? `<div class="cl-detail">${escapeHtml(e.detail)}</div>` : '';
      return `<div class="cl-item" data-table="${escapeHtml(e.table || '')}">
      <div class="cl-main">
        <span class="cl-tag ${tagOf(e.kind)}">${verb(e.kind)}</span>
        <span class="cl-loc">${loc}</span>
      </div>
      ${detail}
    </div>`;
    })
    .join('');
  log.querySelectorAll('.cl-item').forEach((it) =>
    it.addEventListener('click', () => {
      const name = it.dataset.table;
      if (!state.pos[name]) return;
      state.selected = name;
      if (!state.diffMode) toggleDiff(true);
      applyHighlight();
      updateInspector();
      centerOn(name);
    }),
  );
}

function selectAndFocus(name) {
  if (!state.pos[name]) return;
  state.selected = name;
  applyHighlight();
  updateInspector();
  centerOn(name);
}
// Move selection to the nearest table in a direction (arrow keys).
function navigateTable(dir) {
  const diff = currentDiff();
  if (!diff) return;
  const centers = {};
  for (const t of diff.tables) {
    const p = state.pos[t.name];
    if (p) centers[t.name] = { x: p.x + CARD_W / 2, y: p.y + cardHeight(t) / 2 };
  }
  const names = Object.keys(centers);
  if (!names.length) return;
  const cur = state.selected && centers[state.selected] ? state.selected : null;
  if (!cur) {
    // nothing selected → start from the top-left table
    selectAndFocus(
      names.sort((a, b) => centers[a].y - centers[b].y || centers[a].x - centers[b].x)[0],
    );
    return;
  }
  const c = centers[cur];
  let best = null,
    bestScore = Infinity;
  for (const n of names) {
    if (n === cur) continue;
    const dx = centers[n].x - c.x,
      dy = centers[n].y - c.y;
    let ok, primary, secondary;
    if (dir === 'right') {
      ok = dx > 1;
      primary = dx;
      secondary = Math.abs(dy);
    } else if (dir === 'left') {
      ok = dx < -1;
      primary = -dx;
      secondary = Math.abs(dy);
    } else if (dir === 'down') {
      ok = dy > 1;
      primary = dy;
      secondary = Math.abs(dx);
    } else {
      ok = dy < -1;
      primary = -dy;
      secondary = Math.abs(dx);
    }
    if (!ok) continue;
    const score = primary + secondary * 2.2; // prefer close & well-aligned
    if (score < bestScore) {
      bestScore = score;
      best = n;
    }
  }
  if (best) selectAndFocus(best);
}

function centerOn(name) {
  const diff = currentDiff();
  const t = diff.tables.find((x) => x.name === name);
  const p = state.pos[name];
  if (!t || !p) return;
  const stage = $('#stage').getBoundingClientRect();
  const k = Math.max(state.view.k, 0.75); // ensure the focused table is legible
  // keep the table clear of the inspector panel when it's open
  const rightPad = $('#inspector').classList.contains('on') ? 316 : 0;
  const cx = (stage.width - rightPad) / 2;
  const tx = cx - (p.x + CARD_W / 2) * k;
  const ty = stage.height / 2 - (p.y + cardHeight(t) / 2) * k;
  animateView(tx, ty, k, 460);
}

async function loadComparison(opts = {}) {
  // Close table inspector when switching versions / comparison
  if (state.selected != null) {
    clearPath(true);
    state.selected = null;
    applyHighlight();
    updateInspector();
  }
  const p = state.payload;
  const reqToken = (state._diffReq = (state._diffReq || 0) + 1);
  if (state._diffAbort) state._diffAbort.abort();
  if (state.liveTarget || (!state.base && state.target === p.current)) {
    state._diff = p.diff;
  } else {
    const from = state.base != null ? state.base : state.target - 1;
    const ac = new AbortController();
    state._diffAbort = ac;
    try {
      const res = await fetch(withToken(`/api/diff?from=${from}&to=${state.target}`), {
        signal: ac.signal,
      });
      const j = await res.json();
      if (reqToken !== state._diffReq) return; // stale response
      state._diff = j.diff;
    } catch (e) {
      if (e?.name === 'AbortError') return;
      if (reqToken !== state._diffReq) return;
      state._diff = p.diff;
    }
  }
  if (reqToken !== state._diffReq) return;
  const diff = state._diff;
  if (diff) {
    const nTables = diff.tables.filter((t) => t.status !== 'removed').length;
    const nRels = (diff.relations || []).length;
    const nEnums = (diff.enums || []).length;
    const skipped = p.skippedStatements ? ` · ${p.skippedStatements} skipped` : '';
    $('#stats').textContent =
      `${nTables} tables · ${nRels} FK${nRels === 1 ? '' : 's'}${nEnums ? ` · ${nEnums} enum${nEnums === 1 ? '' : 's'}` : ''} · ${diff.dialect || 'postgres'}${skipped}`;
  }
  render();
  renderRail();

  if (opts.focusChanges && diff) {
    const isLatest = state.liveTarget || state.target === p.current;
    // Latest → full schema overview
    if (isLatest) {
      state.changesOnly = false;
      $('#btn-only')?.classList.remove('on');
      render();
      setTimeout(() => fitView(), 40);
      return;
    }
    const changedTables = (diff.tables || []).filter((t) => t.status && t.status !== 'unchanged');
    const hasChanges = (diff.changelog && diff.changelog.length) || changedTables.length;
    if (hasChanges) {
      // Diff colors + dim unchanged tables (keep them visible at low opacity) + zoom to changes
      state.diffMode = true;
      state.changesOnly = false;
      saveUIPrefs();
      $('#btn-diff').classList.add('on', 'diff');
      $('#btn-only').disabled = false;
      $('#btn-only').classList.remove('on');
      $('#legend').classList.add('on');
      ensurePositionsFor(changedTables.map((t) => t.name));
      render();
      setTimeout(() => fitToChanges(currentDiff() || diff), 40);
    } else {
      state.changesOnly = false;
      $('#btn-only')?.classList.remove('on');
      render();
      setTimeout(() => fitView(), 40);
    }
  }
}

/** Place any missing tables so zoom-to-change can find them. */
function ensurePositionsFor(names) {
  const diff = currentDiff();
  if (!diff) return;
  let placed = false;
  for (const name of names) {
    if (state.pos[name]) continue;
    const t = diff.tables.find((x) => x.name === name);
    if (!t) continue;
    // Drop near the centroid of existing cards, or origin
    const keys = Object.keys(state.pos);
    if (!keys.length) {
      state.pos[name] = { x: 40, y: 40 };
      placed = true;
      continue;
    }
    let sx = 0,
      sy = 0;
    for (const k of keys) {
      sx += state.pos[k].x;
      sy += state.pos[k].y;
    }
    state.pos[name] = { x: sx / keys.length + 40, y: sy / keys.length + cardHeight(t) + 40 };
    placed = true;
  }
  if (placed) saveLayout();
}

// ---------------- toolbar ----------------
function toggleDiff(force) {
  state.diffMode = force != null ? force : !state.diffMode;
  saveUIPrefs();
  $('#btn-diff').classList.toggle('on', state.diffMode);
  $('#btn-diff').classList.toggle('diff', state.diffMode);
  $('#btn-only').disabled = !state.diffMode;
  if (!state.diffMode) {
    state.changesOnly = false;
    $('#btn-only').classList.remove('on');
  }
  $('#legend').classList.toggle('on', state.diffMode);
  render();
}
function toggleOnly() {
  if (!state.diffMode) return;
  state.changesOnly = !state.changesOnly;
  $('#btn-only').classList.toggle('on', state.changesOnly);
  render();
  fitView();
}

function setMigrationOpen(on) {
  state.migOpen = !!on;
  const panel = $('#mig-panel');
  const btn = $('#btn-mig');
  if (panel) panel.hidden = !state.migOpen;
  if (btn) btn.classList.toggle('on', state.migOpen);
  if (state.migOpen) refreshMigrationPanel();
}

async function refreshMigrationPanel() {
  const panel = $('#mig-panel');
  if (!panel || panel.hidden) return;
  const title = $('#mig-title');
  const sub = $('#mig-sub');
  const code = $('#mig-code');
  const p = state.payload;
  const v = p?.versions?.find((x) => x.id === state.target);
  if (!v) {
    title.textContent = 'Migration file';
    sub.textContent = '';
    code.textContent = 'No version selected.';
    return;
  }
  if (v.kind === 'latest' || !v.file) {
    title.textContent = v.kind === 'latest' ? 'Latest' : v.reason || `v${v.id}`;
    sub.textContent =
      v.kind === 'latest'
        ? 'Live Drizzle schema — no migration SQL file'
        : 'No migration file for this version';
    code.textContent =
      v.kind === 'latest'
        ? '// Latest tracks your current Drizzle .schema.ts files.\n// Select a migration version to view its SQL.'
        : '// This version has no associated .sql file.';
    return;
  }
  title.textContent = v.file;
  sub.textContent = `${v.reason || `v${v.id}`} · ${formatMigDate(v.at)} · ${v.tables} tables`;
  code.textContent = 'Loading…';
  const reqToken = (state._migReq = (state._migReq || 0) + 1);
  if (state._migAbort) state._migAbort.abort();
  const ac = new AbortController();
  state._migAbort = ac;
  try {
    const res = await fetch(withToken(`/api/migration?id=${encodeURIComponent(v.id)}`), {
      signal: ac.signal,
    });
    const j = await res.json();
    if (reqToken !== state._migReq) return;
    if (!res.ok) {
      code.textContent = j.error || 'Failed to load migration file.';
      return;
    }
    title.textContent = j.file || v.file;
    sub.textContent = `${j.reason || v.reason || `v${v.id}`} · ${formatMigDate(j.at || v.at)} · ${v.tables} tables`;
    code.textContent = j.content || '';
  } catch (e) {
    if (e?.name === 'AbortError' || reqToken !== state._migReq) return;
    code.textContent = String(e.message || e);
  }
}

function setupMigrationPanel() {
  $('#btn-mig')?.addEventListener('click', () => setMigrationOpen(!state.migOpen));
  $('#mig-close')?.addEventListener('click', () => setMigrationOpen(false));
}

function setupToolbar() {
  $('#btn-diff').addEventListener('click', () => toggleDiff());
  $('#btn-only').addEventListener('click', () => toggleOnly());
  $('#zoom-in').addEventListener('click', () => {
    const r = $('#stage').getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, 1.2);
  });
  $('#zoom-out').addEventListener('click', () => {
    const r = $('#stage').getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, 1 / 1.2);
  });
  $('#fit').addEventListener('click', fitView);
  $('#relayout').addEventListener('click', () => {
    pushLayout();
    state.pos = autoLayout(currentDiff());
    saveLayout();
    render();
    fitView();
  });
  $('#snap').addEventListener('click', exportDiagramPNG);
  $('#zoom-label').addEventListener('click', () => {
    const r = $('#stage').getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, 1 / state.view.k); // reset to 100%
  });

  $('#search-launch').addEventListener('click', openPalette);

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      openPalette();
      return;
    }
    const ae = document.activeElement;
    const typing =
      ae === $('#palette-q') ||
      (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable));
    if (e.key === 'Escape') {
      // Dismiss palette / inputs first — do not clear selection while typing.
      if (typing && ae === $('#palette-q')) {
        ae.blur();
        return;
      }
      const modal = document.querySelector('.modal.on');
      if (modal) {
        modal.classList.remove('on');
        return;
      }
      if (state.migOpen) {
        setMigrationOpen(false);
        return;
      }
      if (typing) return;
      if (state.path) {
        clearPath();
        return;
      }
      if (state.multi) {
        clearMulti();
        return;
      }
      if (state.focus) {
        state.focus = null;
        updateFocusChip();
        render();
        fitView();
        return;
      }
      state.selected = null;
      updateInspector();
      applyHighlight();
      return;
    }
    if (typing) return;
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      undoLayout();
      return;
    }
    if (e.key === '.') {
      e.preventDefault();
      cycleFocus();
    } else if (e.key === '/') {
      e.preventDefault();
      openPalette();
    } else if (e.key === ' ' && tm.on) {
      e.preventDefault();
      tmPlay();
    } else if (e.key === '?') {
      e.preventDefault();
      $('#help').classList.toggle('on');
    } else if (e.key === 'f' || e.key === 'F') fitView();
    else if (e.key === 'd' || e.key === 'D') toggleDiff();
    else if (e.key === '+' || e.key === '=') {
      const r = $('#stage').getBoundingClientRect();
      zoomAt(r.width / 2, r.height / 2, 1.2);
    } else if (e.key === '-' || e.key === '_') {
      const r = $('#stage').getBoundingClientRect();
      zoomAt(r.width / 2, r.height / 2, 1 / 1.2);
    } else {
      const arrow = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[
        e.key
      ];
      if (arrow) {
        e.preventDefault();
        navigateTable(arrow);
      }
    }
  });
}

// ---------------- live connection ----------------
function connect() {
  const es = new EventSource(withToken('/events'));
  es.addEventListener('open', () => setConn(true));
  es.addEventListener('error', () => setConn(false));
  es.addEventListener('version', (ev) => {
    const data = JSON.parse(ev.data);
    const prevCurrent = state.payload && state.payload.current;
    state.payload = data;
    state.key = data.target || 'default';
    if (Object.keys(state.pos).length === 0) state.pos = loadLayout();
    const pathLabel = data.projectName
      ? data.migrationsDir
        ? `${data.projectName} · ${data.migrationsDir}`
        : data.projectName
      : data.target || '';
    $('#path').textContent = pathLabel;
    $('#path').title = pathLabel;

    const isNew = prevCurrent != null && data.current !== prevCurrent;
    // follow the latest version but keep any pinned baseline — combined changes stay visible
    if (state.liveTarget || state.target == null) state.target = data.current;
    // First connection in migration mode: collapse versions unless user already chose
    if (prevCurrent == null) {
      const prefs = loadUIPrefs();
      if (typeof prefs.versionsOpen === 'boolean') state.versionsOpen = prefs.versionsOpen;
      else if (data.migrationMode) state.versionsOpen = false;
    }
    setConn(true);
    const file = (data.target || 'schema').split('/').pop();
    const nTables = data.diff ? data.diff.tables.filter((t) => t.status !== 'removed').length : 0;
    document.title = `${file} · ${nTables} table${nTables === 1 ? '' : 's'} — DB Viewer`;
    if (data.diff) {
      const nRels = (data.diff.relations || []).length,
        nEnums = (data.diff.enums || []).length;
      $('#stats').textContent =
        `${nTables} tables · ${nRels} FK${nRels === 1 ? '' : 's'}${nEnums ? ` · ${nEnums} enum${nEnums === 1 ? '' : 's'}` : ''} · ${data.diff.dialect}`;
    }
    loadComparison();
    if (isNew) {
      flash(`v${data.current} · schema updated`);
      if (!state.diffMode) toggleDiff(true); // reveal the change automatically
    } else if (prevCurrent == null) {
      // first load — fit once the stage has real dimensions, restore diff pref
      fitWhenReady();
      if (loadUIPrefs().diff && !state.diffMode) toggleDiff(true);
      setTimeout(maybeStartTour, 900);
    }
  });
  // schema file saved but couldn't be parsed — keep showing the last good version
  es.addEventListener('parse-error', (ev) => {
    let msg = 'schema parse error';
    try {
      msg = JSON.parse(ev.data).message || msg;
    } catch {}
    flash(`parse error — showing last good version (${msg})`, true);
    $('#conn-dot').className = 'dot warn';
    $('#conn-text').textContent = 'parse error';
  });
}
function setConn(ok) {
  $('#conn-dot').className = 'dot ' + (ok ? 'live' : 'off');
  $('#conn-text').textContent = ok ? 'live' : 'reconnecting…';
}

let toastTimer;
function flash(msg, isError) {
  $('#toast-text').textContent = msg;
  const t = $('#toast');
  t.classList.toggle('err', !!isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 5000 : 2600);
}

// ---------------- export (SQL / DBML) ----------------
const SQL_TYPES = {
  uuid: 'uuid',
  varchar: 'varchar',
  text: 'text',
  char: 'char',
  integer: 'integer',
  int: 'integer',
  smallint: 'smallint',
  bigint: 'bigint',
  serial: 'serial',
  bigserial: 'bigserial',
  boolean: 'boolean',
  real: 'real',
  doublePrecision: 'double precision',
  numeric: 'numeric',
  decimal: 'numeric',
  timestamp: 'timestamp',
  date: 'date',
  time: 'time',
  jsonb: 'jsonb',
  json: 'json',
};
function sqlType(c) {
  let base = c.isEnum ? c.enumName || c.type : SQL_TYPES[c.type] || c.type;
  if ((base === 'timestamp' || base === 'time') && c.withTimezone) base += 'tz';
  if (c.length && (base === 'varchar' || base === 'char')) base = `${base}(${c.length})`;
  if (c.array) base += '[]';
  return base;
}
function sqlDefault(c) {
  if (c.default == null) return null;
  if (c.default === 'now()') return 'now()';
  if (c.default === 'random()') return 'gen_random_uuid()';
  if (c.default === 'fn()') return null; // application-side default
  return c.default; // raw literal, already quoted where needed
}

// column definition fragment shared by CREATE TABLE and ADD COLUMN
function columnDefSQL(c, { withPk = true } = {}) {
  let s = `${c.name} ${sqlType(c)}`;
  if (c.pk && withPk) s += ' PRIMARY KEY';
  if (c.notNull && !c.pk) s += ' NOT NULL';
  if (c.unique && !c.pk) s += ' UNIQUE';
  const def = sqlDefault(c);
  if (def) s += ` DEFAULT ${def}`;
  if (c.references)
    s += ` REFERENCES ${c.references.table}(${c.references.column})${c.references.onDelete ? ' ON DELETE ' + c.references.onDelete.toUpperCase() : ''}`;
  return s;
}
function createTableSQL(t) {
  const L = [`CREATE TABLE ${t.name} (`];
  const lines = t.columns.filter((c) => c.status !== 'removed').map((c) => '  ' + columnDefSQL(c));
  L.push(lines.join(',\n'));
  L.push(');');
  for (const i of t.indexes || [])
    L.push(
      `CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX ${i.name} ON ${t.name} (${(i.columns || []).join(', ')});`,
    );
  return L.join('\n');
}

function toSQL(diff) {
  const L = [];
  L.push(`-- generated by DB Viewer · ${diff.dialect}`);
  for (const e of diff.enums || [])
    L.push(`CREATE TYPE ${e.name} AS ENUM (${e.values.map((v) => `'${v}'`).join(', ')});`);
  if ((diff.enums || []).length) L.push('');
  for (const t of diff.tables) {
    if (t.status === 'removed') continue;
    L.push(createTableSQL(t));
    L.push('');
  }
  return L.join('\n').trim() + '\n';
}

// Emit ALTER statements for the currently-viewed diff (base → target).
function toMigration(diff) {
  const cl = diff.changelog || [];
  if (!cl.length) return `-- no schema changes in this comparison\n`;
  const enumByName = new Map((diff.enums || []).map((e) => [e.name, e]));
  const tableByName = new Map((diff.tables || []).map((t) => [t.name, t]));
  const up = [];
  const label =
    state.base && state.target
      ? `v${state.base} → v${state.target}`
      : state.target > 1
        ? `v${state.target - 1} → v${state.target}`
        : 'initial';
  up.push(`-- migration · ${label} · ${diff.dialect}`, '');

  // 1) enums first (types must exist before columns use them)
  for (const e of cl) {
    if (e.kind === 'enum-added')
      up.push(
        `CREATE TYPE ${e.enum} AS ENUM (${(e.values || []).map((v) => `'${v}'`).join(', ')});`,
      );
    if (e.kind === 'enum-modified') {
      for (const v of e.added || [])
        up.push(
          `ALTER TYPE ${e.enum} ADD VALUE '${v}';   -- note: cannot run inside a transaction block`,
        );
      for (const v of e.removed || [])
        up.push(
          `-- Postgres can't drop enum value '${v}' from ${e.enum} directly; recreate the type if needed.`,
        );
    }
    if (e.kind === 'enum-removed') up.push(`DROP TYPE ${e.enum};`);
  }

  // 2) new tables
  for (const t of diff.tables) if (t.status === 'added') up.push('', createTableSQL(t));

  // 3) altered tables
  for (const t of diff.tables) {
    if (t.status !== 'modified') continue;
    const stmts = [];
    for (const c of t.columns) {
      if (c.status === 'added')
        stmts.push(`ALTER TABLE ${t.name} ADD COLUMN ${columnDefSQL(c, { withPk: false })};`);
      else if (c.status === 'removed') stmts.push(`ALTER TABLE ${t.name} DROP COLUMN ${c.name};`);
      else if (c.status === 'modified' && c.delta) {
        const d = c.delta;
        if (d.type) stmts.push(`ALTER TABLE ${t.name} ALTER COLUMN ${c.name} TYPE ${sqlType(c)};`);
        if ('notNull' in d)
          stmts.push(
            `ALTER TABLE ${t.name} ALTER COLUMN ${c.name} ${d.notNull ? 'SET NOT NULL' : 'DROP NOT NULL'};`,
          );
        if ('default' in d) {
          const def = sqlDefault(c);
          stmts.push(
            `ALTER TABLE ${t.name} ALTER COLUMN ${c.name} ${def ? 'SET DEFAULT ' + def : 'DROP DEFAULT'};`,
          );
        }
        if ('unique' in d)
          stmts.push(
            d.unique
              ? `CREATE UNIQUE INDEX ${t.name}_${c.name}_key ON ${t.name} (${c.name});`
              : `-- drop the unique constraint/index on ${t.name}.${c.name}`,
          );
        if ('references' in d)
          stmts.push(
            d.references
              ? `ALTER TABLE ${t.name} ADD CONSTRAINT ${t.name}_${c.name}_fkey FOREIGN KEY (${c.name}) REFERENCES ${d.references.table}(${d.references.column})${d.references.onDelete ? ' ON DELETE ' + d.references.onDelete.toUpperCase() : ''};`
              : `-- drop the foreign key on ${t.name}.${c.name}`,
          );
      }
    }
    if (stmts.length) up.push('', ...stmts);
  }

  // 4) dropped tables last
  for (const t of diff.tables) if (t.status === 'removed') up.push('', `DROP TABLE ${t.name};`);

  return up.join('\n').trim() + '\n';
}

function toDBML(diff) {
  const L = [];
  for (const e of diff.enums || []) {
    L.push(`Enum ${e.name} {`);
    for (const v of e.values) L.push(`  ${v}`);
    L.push('}\n');
  }
  const refs = [];
  for (const t of diff.tables) {
    if (t.status === 'removed') continue;
    L.push(`Table ${t.name} {`);
    for (const c of t.columns) {
      if (c.status === 'removed') continue;
      const attrs = [];
      if (c.pk) attrs.push('pk');
      if (c.notNull && !c.pk) attrs.push('not null');
      if (c.unique && !c.pk) attrs.push('unique');
      const def = sqlDefault(c);
      if (def) attrs.push(`default: \`${def}\``);
      L.push(`  ${c.name} ${sqlType(c)}${attrs.length ? ' [' + attrs.join(', ') + ']' : ''}`);
      if (c.references)
        refs.push(`Ref: ${t.name}.${c.name} > ${c.references.table}.${c.references.column}`);
    }
    L.push('}\n');
  }
  if (refs.length) L.push(refs.join('\n'));
  return L.join('\n').trim() + '\n';
}

let exportTab = 'sql';
function openExport() {
  const diff = currentDiff();
  if (!diff) return;
  const modal = $('#export');
  modal.classList.add('on');
  renderExport();
}
// lightweight syntax highlighting: comments, strings, keywords (escaped first — safe)
const SQL_KEYWORDS =
  /\b(CREATE|TABLE|TYPE|AS|ENUM|PRIMARY KEY|NOT NULL|UNIQUE|DEFAULT|REFERENCES|ON DELETE|CASCADE|SET NULL|ALTER|ADD|DROP|COLUMN|CONSTRAINT|FOREIGN KEY|INDEX|ON|SET|VALUE|Table|Enum|Ref)\b/g;
function highlightCode(src) {
  return escapeHtml(src)
    .replace(/(--[^\n]*|\/\/[^\n]*)/g, '<i class="hl-c">$1</i>')
    .replace(/(&#39;[^&]*?&#39;)/g, '<i class="hl-s">$1</i>')
    .replace(SQL_KEYWORDS, '<i class="hl-k">$1</i>');
}
function renderExport() {
  const diff = currentDiff();
  if (!diff) return;
  const code =
    exportTab === 'migration'
      ? toMigration(diff)
      : exportTab === 'dbml'
        ? toDBML(diff)
        : toSQL(diff);
  const el = $('#export-code');
  el.innerHTML = highlightCode(code);
  el.dataset.raw = code; // copy/download read the raw text
  document
    .querySelectorAll('#export .tab')
    .forEach((b) => b.classList.toggle('on', b.dataset.tab === exportTab));
  $('#export-sub').textContent =
    exportTab === 'migration'
      ? "ALTER statements for the diff you're viewing"
      : "full schema of the version you're viewing";
}
function setupExport() {
  $('#btn-export').addEventListener('click', openExport);
  $('#export-close').addEventListener('click', () => $('#export').classList.remove('on'));
  $('#export').addEventListener('click', (e) => {
    if (e.target.id === 'export') $('#export').classList.remove('on');
  });
  document.querySelectorAll('#export .tab').forEach((b) =>
    b.addEventListener('click', () => {
      exportTab = b.dataset.tab;
      renderExport();
    }),
  );
  $('#export-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#export-code').textContent);
      flash('copied to clipboard');
    } catch {}
  });
  $('#export-download').addEventListener('click', () => {
    const name =
      exportTab === 'dbml'
        ? 'schema.dbml'
        : exportTab === 'migration'
          ? 'migration.sql'
          : 'schema.sql';
    const blob = new Blob([$('#export-code').textContent], { type: 'text/plain' });
    const a = document.createElement('a');
    const href = URL.createObjectURL(blob);
    a.href = href;
    a.download = name;
    a.click();
    // Firefox needs a tick before revoke or the download is 0 bytes.
    setTimeout(() => URL.revokeObjectURL(href), 1500);
  });
}

// ---------------- SQL advisor ----------------
// Encodes common SQL / schema-design best practices as heuristics and reports
// findings a reviewer would raise. Runs client-side over the viewed version.
function analyzeSchema(diff) {
  const out = [];
  const add = (sev, table, column, msg, fix) => out.push({ sev, table, column, msg, fix });
  for (const t of diff.tables || []) {
    if (t.status === 'removed') continue;
    const cols = t.columns.filter((c) => c.status !== 'removed');
    const pk = cols.filter((c) => c.pk);
    const names = new Set(cols.map((c) => c.name));
    // effectively-indexed = pk, unique, or first column of an index
    const indexed = new Set();
    pk.forEach((c) => indexed.add(c.key));
    cols.filter((c) => c.unique).forEach((c) => indexed.add(c.key));
    (t.indexes || []).forEach((i) => {
      if (i.columns && i.columns[0]) indexed.add(i.columns[0]);
    });

    if (!pk.length)
      add('error', t.name, null, 'No primary key.', `Add a primary key to "${t.name}".`);

    for (const c of cols) {
      if (c.references && !c.pk && !indexed.has(c.key))
        add(
          'warn',
          t.name,
          c.name,
          'Foreign key without an index — joins & cascade deletes do full scans.',
          `Add an index on ${t.name}.${c.name}.`,
        );
      if (
        /(price|amount|total|cost|balance|fee|salary|revenue|discount)/i.test(c.name) &&
        /^(real|double|doublePrecision|float)$/i.test(c.type)
      )
        add(
          'warn',
          t.name,
          c.name,
          'Monetary value stored as floating point — rounding errors.',
          `Store ${t.name}.${c.name} as integer (cents) or numeric.`,
        );
      if (/^varchar$/i.test(c.type) && !c.length)
        add(
          'info',
          t.name,
          c.name,
          'varchar with no length.',
          `Set a length on ${t.name}.${c.name}, or use text.`,
        );
      if (/^(email|slug|username|sku|handle|phone_e164)$/i.test(c.name) && !c.unique && !c.pk)
        add(
          'warn',
          t.name,
          c.name,
          `"${c.name}" looks like a natural key but isn't unique.`,
          `Add a unique constraint on ${t.name}.${c.name}.`,
        );
      if (/^boolean$/i.test(c.type) && !c.notNull)
        add(
          'info',
          t.name,
          c.name,
          'Nullable boolean (three-valued logic).',
          `Make ${t.name}.${c.name} NOT NULL with a default.`,
        );
      if (c.isEnum && !c.notNull && c.default == null)
        add(
          'info',
          t.name,
          c.name,
          'Enum column is nullable with no default.',
          `Give ${t.name}.${c.name} a default or make it NOT NULL.`,
        );
      if (/^timestamp$/i.test(c.type) && !c.withTimezone)
        add(
          'info',
          t.name,
          c.name,
          'timestamp without time zone.',
          `Use { withTimezone: true } (timestamptz) on ${t.name}.${c.name}.`,
        );
      if (/[A-Z]/.test(c.name))
        add(
          'info',
          t.name,
          c.name,
          "Column name isn't snake_case.",
          `Rename ${t.name}.${c.name} to snake_case.`,
        );
    }
    if (names.has('created_at') && !names.has('updated_at'))
      add(
        'info',
        t.name,
        null,
        'Has created_at but no updated_at.',
        `Add an updated_at column to "${t.name}".`,
      );
    if (![...names].some((n) => /(created_at|updated_at|inserted_at)/.test(n)))
      add(
        'info',
        t.name,
        null,
        'No audit timestamps.',
        `Consider created_at / updated_at on "${t.name}".`,
      );
  }
  const rank = { error: 0, warn: 1, info: 2 };
  out.sort((a, b) => rank[a.sev] - rank[b.sev] || a.table.localeCompare(b.table));
  return out;
}

function renderSuggestions(diff) {
  const list = $('#suggest-list');
  const findings = diff ? analyzeSchema(diff) : [];
  state._suggestions = findings;
  $('#tab-suggest-n').textContent = findings.length ? findings.length : '';
  if (!findings.length) {
    list.innerHTML = '<div class="empty">No suggestions — schema looks clean. ✓</div>';
    return;
  }
  const label = { error: 'must fix', warn: 'review', info: 'nit' };
  list.innerHTML = findings
    .map(
      (f) => `
    <div class="sg" data-table="${escapeHtml(f.table)}">
      <span class="sg-sev ${f.sev}">${label[f.sev]}</span>
      <div class="sg-body">
        <div class="sg-loc"><b>${escapeHtml(f.table)}</b>${f.column ? '.' + escapeHtml(f.column) : ''}</div>
        <div class="sg-msg">${escapeHtml(f.msg)}</div>
      </div>
    </div>`,
    )
    .join('');
  list.querySelectorAll('.sg').forEach((el) =>
    el.addEventListener('click', () => {
      const name = el.dataset.table;
      if (state.pos[name]) {
        state.selected = name;
        applyHighlight();
        updateInspector();
        centerOn(name);
      }
    }),
  );
}

function setupPanels() {
  document
    .querySelectorAll('.stab')
    .forEach((b) => b.addEventListener('click', () => switchPanel(b.dataset.panel)));
}
function switchPanel(name) {
  document
    .querySelectorAll('.stab')
    .forEach((b) => b.classList.toggle('on', b.dataset.panel === name));
  document
    .querySelectorAll('.panel')
    .forEach((p) => p.classList.toggle('hidden', p.id !== 'panel-' + name));
}

// Tiny markdown → HTML. MUST escape first — never add link/image rules that
// re-introduce raw URLs after escape, or Claude output becomes an XSS sink.
function mdToHtml(md) {
  const esc = escapeHtml(md);
  return esc
    .replace(/^######?\s*(.+)$/gm, '<h6>$1</h6>')
    .replace(/^###\s*(.+)$/gm, '<h5>$1</h5>')
    .replace(/^##\s*(.+)$/gm, '<h4>$1</h4>')
    .replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n{2,}/g, '<br><br>');
}

function setupDeepReview() {
  const btn = $('#deep-review');
  const out = $('#review-output');
  btn.addEventListener('click', async () => {
    const diff = currentDiff();
    if (!diff) return;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Reviewing…';
    out.classList.add('on');
    out.innerHTML = '<div class="rv-loading">Asking Claude to review your schema…</div>';
    try {
      const res = await fetch(withToken('/api/review'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql: toSQL(diff) }),
      });
      const j = await res.json();
      if (j.unavailable) {
        out.innerHTML = `<div class="rv-note">Couldn't find the <code>claude</code> CLI on the server's PATH. Install Claude Code (<code>npm i -g @anthropic-ai/claude-code</code>) or start DB Viewer from a shell where <code>claude</code> is available. I've copied a review prompt to your clipboard in the meantime.</div>`;
        try {
          await navigator.clipboard.writeText(
            `Please review this Postgres/Drizzle schema as a senior DB engineer — correctness, indexing, integrity, naming, footguns:\n\n\`\`\`sql\n${toSQL(diff)}\n\`\`\``,
          );
          flash('review prompt copied');
        } catch {}
      } else if (j.review) {
        out.innerHTML = `<div class="rv-body">${mdToHtml(j.review)}</div>`;
      } else {
        out.innerHTML = `<div class="rv-note">${escapeHtml(j.error || 'No review returned.')}</div>`;
      }
    } catch (e) {
      out.innerHTML = `<div class="rv-note">Request failed: ${escapeHtml(String(e.message || e))}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}

// ---------------- util ----------------
function escapeHtml(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

// ---------------- boot ----------------
// ---------------- theme (dark / light / system) ----------------
const THEME_ORDER = ['system', 'light', 'dark'];
const THEME_ICON = { system: '◐', light: '☀', dark: '☾' };
function resolveTheme(pref) {
  if (pref === 'system')
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return pref;
}
function applyThemePref(pref) {
  state.themePref = pref;
  try {
    localStorage.setItem('dbd:theme', pref);
  } catch {}
  document.documentElement.dataset.theme = resolveTheme(pref);
  $('#theme-ico').textContent = THEME_ICON[pref];
  $('#btn-theme').title = `Theme: ${pref[0].toUpperCase() + pref.slice(1)} — click to change`;
}
function setupTheme() {
  let pref = 'system';
  try {
    pref = localStorage.getItem('dbd:theme') || 'system';
  } catch {}
  applyThemePref(pref);
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (state.themePref === 'system') applyThemePref('system');
  });
  $('#btn-theme').addEventListener('click', () => {
    const i = THEME_ORDER.indexOf(state.themePref);
    applyThemePref(THEME_ORDER[(i + 1) % THEME_ORDER.length]);
  });
}

// ---------------- PNG snapshot of the diagram ----------------
function buildDiagramSVG() {
  const diff = currentDiff();
  if (!diff || !nodeEls.size) return null;
  const css = getComputedStyle(document.documentElement);
  const C = (v) => css.getPropertyValue(v).trim();
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const items = [];
  for (const name of nodeEls.keys()) {
    const t = diff.tables.find((x) => x.name === name);
    const p = state.pos[name];
    if (!t || !p) continue;
    items.push({ t, p });
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + CARD_W);
    maxY = Math.max(maxY, p.y + cardHeight(t));
  }
  if (!items.length) return null;
  const PAD = 48,
    W = Math.ceil(maxX - minX + PAD * 2),
    H = Math.ceil(maxY - minY + PAD * 2);
  const ox = PAD - minX,
    oy = PAD - minY;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace,Menlo,monospace">`;
  s += `<rect width="${W}" height="${H}" fill="${C('--board')}"/>`;
  s += `<g transform="translate(${ox},${oy})">`;
  // wires — reuse the live geometry
  edgesSvg.querySelectorAll('.edge').forEach((p) => {
    s += `<path d="${p.getAttribute('d')}" stroke="${C('--trace')}" stroke-width="1.6" opacity="0.55" fill="none"/>`;
  });
  edgesSvg.querySelectorAll('.marker').forEach((m) => {
    if (m.tagName === 'path')
      s += `<path d="${m.getAttribute('d')}" stroke="${C('--trace')}" stroke-width="1.6" opacity="0.55" fill="none"/>`;
    else
      s += `<circle cx="${m.getAttribute('cx')}" cy="${m.getAttribute('cy')}" r="${m.getAttribute('r')}" stroke="${C('--trace')}" fill="${C('--board')}" opacity="0.8"/>`;
  });
  edgesSvg.querySelectorAll('.edge-cap').forEach((c) => {
    s += `<circle cx="${c.getAttribute('cx')}" cy="${c.getAttribute('cy')}" r="3" fill="${C('--trace')}" opacity="0.7"/>`;
  });
  // cards — diff coloring included when diff mode is on
  const showDiff = state.diffMode;
  const stC = { added: C('--add'), removed: C('--rem'), modified: C('--mod') };
  const bgC = { added: C('--add-bg'), removed: C('--rem-bg'), modified: C('--mod-bg') };
  for (const { t, p } of items) {
    const h = cardHeight(t);
    s += `<g transform="translate(${p.x},${p.y})">`;
    s += `<rect width="${CARD_W}" height="${h}" rx="10" fill="${C('--surface')}" stroke="${C('--hair')}"/>`;
    if (showDiff && t.status && t.status !== 'unchanged')
      s += `<rect width="3.5" height="${h}" rx="1.5" fill="${stC[t.status]}"/>`;
    s += `<line x1="0" y1="${HEAD_H}" x2="${CARD_W}" y2="${HEAD_H}" stroke="${C('--hair')}"/>`;
    const iconFill = tableColor(t) || (showDiff && stC[t.status]) || C('--trace');
    s += `<rect x="8" y="${HEAD_H / 2 - 11}" width="22" height="22" rx="6" fill="${iconFill}" opacity="0.18"/>`;
    s += `<rect x="8" y="${HEAD_H / 2 - 11}" width="22" height="22" rx="6" fill="none" stroke="${iconFill}" opacity="0.45"/>`;
    s += `<rect x="12" y="${HEAD_H / 2 - 6}" width="14" height="12" rx="1.5" fill="none" stroke="${iconFill}" stroke-width="1.2"/>`;
    s += `<path d="M12 ${HEAD_H / 2 - 2}h14M12 ${HEAD_H / 2 + 2}h14M17 ${HEAD_H / 2 - 2}v8" fill="none" stroke="${iconFill}" stroke-width="1.2"/>`;
    const nameY = t.schema ? HEAD_H / 2 + 6 : HEAD_H / 2 + 4.5;
    if (t.schema)
      s += `<text x="36" y="${HEAD_H / 2 - 5}" font-size="9" fill="${C('--ink-faint')}">${escapeHtml(t.schema)}</text>`;
    s += `<text x="36" y="${nameY}" font-size="12.5" font-weight="650" fill="${C('--ink')}">${escapeHtml(t.name)}</text>`;
    s += `<text x="${CARD_W - 12}" y="${HEAD_H / 2 + 4}" font-size="10" font-weight="600" text-anchor="end" fill="${C('--ink-faint')}">${t.columns.length}</text>`;
    if (showDiff && t.status && t.status !== 'unchanged')
      s += `<text x="${CARD_W - 28}" y="${HEAD_H / 2 + 4}" font-size="9" font-weight="700" text-anchor="end" fill="${stC[t.status]}">${t.status.toUpperCase()}</text>`;
    t.columns.forEach((c, i) => {
      const rowY = HEAD_H + i * ROW_H;
      const y = rowY + ROW_H / 2;
      if (showDiff && c.status && c.status !== 'unchanged')
        s += `<rect x="1" y="${rowY}" width="${CARD_W - 2}" height="${ROW_H}" fill="${bgC[c.status]}"/>`;
      if (i > 0)
        s += `<line x1="0" y1="${rowY}" x2="${CARD_W}" y2="${rowY}" stroke="${C('--hair-soft')}"/>`;
      const pin = c.pk ? C('--gold') : c.references ? C('--trace') : C('--hair');
      s += `<circle cx="15.5" cy="${y}" r="3.5" fill="${pin}"/>`;
      const nameFill =
        showDiff && c.status && c.status !== 'unchanged'
          ? stC[c.status]
          : c.pk
            ? C('--gold')
            : C('--ink');
      const strike = showDiff && c.status === 'removed' ? ' text-decoration="line-through"' : '';
      s += `<text x="26" y="${y + 4}" font-size="12" fill="${nameFill}"${strike}>${escapeHtml(c.name)}</text>`;
      s += `<text x="${CARD_W - 12}" y="${y + 4}" font-size="11" text-anchor="end" fill="${c.isEnum ? C('--violet') : C('--ink-faint')}">${escapeHtml(typeLabel(c))}</text>`;
    });
    s += `</g>`;
  }
  s += '</g></svg>';
  return { svg: s, W, H };
}

async function exportDiagramPNG() {
  const built = buildDiagramSVG();
  if (!built) {
    flash('nothing to export');
    return;
  }
  const url = URL.createObjectURL(new Blob([built.svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });
    const scale = 2,
      cv = document.createElement('canvas');
    cv.width = built.W * scale;
    cv.height = built.H * scale;
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    cv.toBlob((b) => {
      if (!b) {
        flash('PNG export failed: empty canvas');
        return;
      }
      const a = document.createElement('a');
      const href = URL.createObjectURL(b);
      a.href = href;
      a.download = 'schema.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1500);
      flash('schema.png downloaded');
    }, 'image/png');
  } catch (e) {
    flash('PNG export failed: ' + (e.message || e));
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

// ---------------- time machine (replay schema history) ----------------
const tm = { on: false, playing: false, timer: null };

function tmVersions() {
  return (state.payload && state.payload.versions) || [];
}

function tmGo(idx) {
  const vs = tmVersions();
  if (!vs.length) return;
  idx = Math.max(0, Math.min(vs.length - 1, idx));
  const v = vs[idx];
  $('#tm-slider').value = idx;
  $('#tm-v').textContent = 'v' + v.id;
  $('#tm-reason').textContent = `${v.reason} · ${new Date(v.at).toLocaleTimeString()}`;
  state.target = v.id;
  state.base = null;
  state.liveTarget = v.id === state.payload.current;
  if (!state.diffMode) toggleDiff(true);
  loadComparison();
}
function tmIndex() {
  return Number($('#tm-slider').value);
}

function tmStop() {
  tm.playing = false;
  clearInterval(tm.timer);
  tm.timer = null;
  $('#tm-play').textContent = '▶';
}
function tmPlay() {
  const vs = tmVersions();
  if (vs.length < 2) return;
  if (tm.playing) {
    tmStop();
    return;
  }
  tm.playing = true;
  $('#tm-play').textContent = '⏸';
  if (tmIndex() >= vs.length - 1) tmGo(0); // restart from the beginning
  tm.timer = setInterval(() => {
    const i = tmIndex();
    if (i >= tmVersions().length - 1) {
      tmStop();
      return;
    }
    tmGo(i + 1);
  }, 1700);
}

function openTimeMachine() {
  const vs = tmVersions();
  if (vs.length < 2) {
    flash('only one version yet — edit the schema to build history');
    return;
  }
  tm.on = true;
  const slider = $('#tm-slider');
  slider.min = 0;
  slider.max = vs.length - 1;
  $('#tm-ticks').innerHTML = vs
    .map((_, i) => `<i style="left:${vs.length > 1 ? (i / (vs.length - 1)) * 100 : 0}%"></i>`)
    .join('');
  $('#timemachine').classList.add('on');
  tmGo(0);
  tmPlay();
}
function closeTimeMachine() {
  tmStop();
  tm.on = false;
  $('#timemachine').classList.remove('on');
  // return to the latest version, keep following live updates
  const vs = tmVersions();
  if (vs.length) {
    state.target = state.payload.current;
    state.base = null;
    state.liveTarget = true;
    loadComparison();
  }
}
function setupTimeMachine() {
  $('#btn-tm').addEventListener('click', () => (tm.on ? closeTimeMachine() : openTimeMachine()));
  $('#tm-play').addEventListener('click', tmPlay);
  $('#tm-prev').addEventListener('click', () => {
    tmStop();
    tmGo(tmIndex() - 1);
  });
  $('#tm-next').addEventListener('click', () => {
    tmStop();
    tmGo(tmIndex() + 1);
  });
  $('#tm-close').addEventListener('click', closeTimeMachine);
  $('#tm-slider').addEventListener('input', () => {
    tmStop();
    tmGo(tmIndex());
  });
}

// ---------------- command palette (⌘K) ----------------
const palette = { items: [], filtered: [], sel: 0 };

function paletteCommands() {
  const diff = currentDiff();
  const c = [];
  c.push({ group: 'Actions', ico: '◧', label: 'Toggle diff', hint: 'D', run: () => toggleDiff() });
  c.push({
    group: 'Actions',
    ico: '⧉',
    label: 'Show only changes',
    run: () => {
      if (!state.diffMode) toggleDiff(true);
      if (!state.changesOnly) toggleOnly();
    },
  });
  c.push({ group: 'Actions', ico: '⤢', label: 'Fit to screen', hint: 'F', run: () => fitView() });
  c.push({
    group: 'Actions',
    ico: '✦',
    label: 'Auto-arrange tables',
    run: () => {
      state.pos = autoLayout(currentDiff());
      saveLayout();
      render();
      fitView();
    },
  });
  c.push({
    group: 'Actions',
    ico: '↧',
    label: 'Export SQL',
    run: () => {
      exportTab = 'sql';
      openExport();
    },
  });
  c.push({
    group: 'Actions',
    ico: '↧',
    label: 'Export DBML',
    run: () => {
      exportTab = 'dbml';
      openExport();
    },
  });
  c.push({
    group: 'Actions',
    ico: '↧',
    label: 'Export migration (ALTER)',
    run: () => {
      exportTab = 'migration';
      openExport();
    },
  });
  c.push({
    group: 'Actions',
    ico: '✨',
    label: 'Deep review with Claude',
    run: () => {
      switchPanel('suggest');
      $('#deep-review').click();
    },
  });
  c.push({
    group: 'Actions',
    ico: '⏱',
    label: 'Replay schema history (time machine)',
    run: () => openTimeMachine(),
  });
  c.push({
    group: 'Actions',
    ico: '⬇',
    label: 'Export diagram as PNG',
    run: () => exportDiagramPNG(),
  });
  c.push({
    group: 'Actions',
    ico: '⊙',
    label: 'Focus on selected table (cycle hops)',
    hint: '.',
    run: () => cycleFocus(),
  });
  c.push({
    group: 'Actions',
    ico: '↩',
    label: 'Undo layout change',
    hint: '⌘Z',
    run: () => undoLayout(),
  });
  c.push({
    group: 'Actions',
    ico: '?',
    label: 'Help & shortcuts',
    hint: '?',
    run: () => $('#help').classList.add('on'),
  });
  c.push({
    group: 'Appearance',
    ico: '◐',
    label: 'Theme: System',
    run: () => applyThemePref('system'),
  });
  c.push({
    group: 'Appearance',
    ico: '☀',
    label: 'Theme: Light',
    run: () => applyThemePref('light'),
  });
  c.push({
    group: 'Appearance',
    ico: '☾',
    label: 'Theme: Dark',
    run: () => applyThemePref('dark'),
  });
  if (diff)
    for (const t of diff.tables)
      c.push({
        group: 'Tables',
        ico: '▤',
        label: t.name,
        hint: t.columns.length + ' cols',
        run: () => {
          if (!state.pos[t.name]) return;
          state.selected = t.name;
          applyHighlight();
          updateInspector();
          centerOn(t.name);
        },
      });
  // columns — only surfaced once you start typing (would flood the initial list)
  if (diff)
    for (const t of diff.tables)
      for (const col of t.columns)
        c.push({
          group: 'Columns',
          ico: '·',
          deep: true,
          label: `${t.name}.${col.name}`,
          hint: typeLabel(col),
          run: () => {
            selectAndFocus(t.name);
            setTimeout(() => {
              const row = document.querySelector(
                `.node[data-table="${CSS.escape(t.name)}"] .row[data-col="${CSS.escape(col.key)}"]`,
              );
              if (row) {
                row.classList.add('row-flash');
                setTimeout(() => row.classList.remove('row-flash'), 1800);
              }
            }, 380);
          },
        });
  if (state.payload)
    for (const v of [...state.payload.versions].reverse())
      c.push({
        group: 'Versions',
        ico: 'v',
        label: `View v${v.id} — ${v.reason}`,
        hint: new Date(v.at).toLocaleTimeString(),
        run: () => {
          state.target = v.id;
          if (state.base === v.id) state.base = null;
          state.liveTarget = v.id === state.payload.current;
          if (!state.versionsOpen) {
            state.versionsOpen = true;
            saveUIPrefs();
          }
          loadComparison({ focusChanges: true });
        },
      });
  return c;
}

// subsequence fuzzy match → {score, ranges} or null
function fuzzyMatch(q, text) {
  if (!q) return { score: 0, ranges: [] };
  const t = text.toLowerCase();
  q = q.toLowerCase();
  let qi = 0,
    score = 0,
    last = -2;
  const ranges = [];
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += (i === last + 1 ? 3 : 1) + (i === 0 ? 4 : 0);
      ranges.push(i);
      last = i;
      qi++;
    }
  }
  return qi === q.length ? { score, ranges } : null;
}
function hlLabel(label, ranges) {
  if (!ranges || !ranges.length) return escapeHtml(label);
  let out = '',
    set = new Set(ranges);
  for (let i = 0; i < label.length; i++)
    out += set.has(i) ? `<b>${escapeHtml(label[i])}</b>` : escapeHtml(label[i]);
  return out;
}

function renderPalette() {
  const q = $('#palette-q').value.trim();
  const scored = [];
  for (const it of palette.items) {
    if (it.deep && q.length < 2) continue; // columns only appear once you type
    const m = fuzzyMatch(q, it.label);
    if (m) scored.push({ it, score: m.score + (it.group === 'Tables' ? 1 : 0), ranges: m.ranges });
  }
  scored.sort((a, b) => b.score - a.score);
  palette.filtered = scored;
  if (palette.sel >= scored.length) palette.sel = Math.max(0, scored.length - 1);
  const list = $('#palette-list');
  if (!scored.length) {
    list.innerHTML = '<div class="pl-empty">No matches</div>';
    return;
  }
  let html = '',
    lastGroup = null;
  scored.forEach((s, i) => {
    const g = q ? 'Results' : s.it.group;
    if (g !== lastGroup) {
      html += `<div class="pl-group">${g}</div>`;
      lastGroup = g;
    }
    html += `<div class="pl-item${i === palette.sel ? ' sel' : ''}" data-i="${i}">
      <span class="pl-ico">${escapeHtml(s.it.ico || '›')}</span>
      <span class="pl-label">${hlLabel(s.it.label, s.ranges)}</span>
      ${s.it.hint ? `<span class="pl-hint">${escapeHtml(s.it.hint)}</span>` : ''}
    </div>`;
  });
  list.innerHTML = html;
  list.querySelectorAll('.pl-item').forEach((el) => {
    el.addEventListener('mousemove', () => {
      palette.sel = Number(el.dataset.i);
      markSel();
    });
    el.addEventListener('click', () => runPalette(Number(el.dataset.i)));
  });
}
function markSel() {
  $('#palette-list')
    .querySelectorAll('.pl-item')
    .forEach((el, i) => el.classList.toggle('sel', i === palette.sel));
  const cur = $('#palette-list').querySelector('.pl-item.sel');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}
function runPalette(i) {
  const s = palette.filtered[i];
  if (!s) return;
  closePalette();
  s.it.run();
}
function openPalette() {
  palette.items = paletteCommands();
  palette.sel = 0;
  $('#palette').classList.add('on');
  const q = $('#palette-q');
  q.value = '';
  renderPalette();
  q.focus();
}
function closePalette() {
  $('#palette').classList.remove('on');
}
function setupPalette() {
  const q = $('#palette-q');
  q.addEventListener('input', () => {
    palette.sel = 0;
    renderPalette();
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      palette.sel = Math.min(palette.filtered.length - 1, palette.sel + 1);
      markSel();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      palette.sel = Math.max(0, palette.sel - 1);
      markSel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runPalette(palette.sel);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    }
  });
  $('#palette').addEventListener('click', (e) => {
    if (e.target.id === 'palette') closePalette();
  });
}

// ---------------- first-run tour (3 coach marks, shown once) ----------------
const TOUR_STEPS = [
  {
    sel: '#stage',
    text: 'This is your schema, live. Drag the background to pan, scroll to zoom, drag tables to arrange. Save the schema file and the diagram refreshes instantly.',
  },
  {
    sel: '#versions',
    text: 'Each migration is a version (or each save, in demo mode). Latest follows your Drizzle schema. Click a version to zoom into what changed. Collapse ▾ to show Latest only.',
  },
  {
    sel: '#search-launch',
    text: '⌘K is command central: fuzzy-search tables, columns, and every action. Press ? anytime for the full cheatsheet.',
  },
];
let tourIdx = 0;
function tourShow(i) {
  const step = TOUR_STEPS[i];
  if (!step) return tourEnd();
  tourIdx = i;
  const target = document.querySelector(step.sel);
  const wrap = $('#tour');
  const card = $('#tour-card');
  const ring = $('#tour-ring');
  wrap.hidden = false;
  const r = target.getBoundingClientRect();
  ring.style.cssText = `left:${r.left - 6}px; top:${r.top - 6}px; width:${r.width + 12}px; height:${r.height + 12}px;`;
  $('#tour-step').textContent = `${i + 1} / ${TOUR_STEPS.length}`;
  $('#tour-text').textContent = step.text;
  $('#tour-next').textContent = i === TOUR_STEPS.length - 1 ? 'Done' : 'Next';
  // place the card near the target, clamped to the viewport
  const cw = 320,
    ch = 150;
  let cx = Math.min(Math.max(r.left + 20, 16), innerWidth - cw - 16);
  let cy = r.top + r.height / 2 - ch / 2;
  if (step.sel === '#stage') {
    cx = r.left + r.width / 2 - cw / 2;
    cy = r.top + 90;
  }
  cy = Math.min(Math.max(cy, 70), innerHeight - ch - 16);
  card.style.left = cx + 'px';
  card.style.top = cy + 'px';
}
function tourEnd() {
  $('#tour').hidden = true;
  try {
    localStorage.setItem('dbd:toured', '1');
  } catch {}
}
function maybeStartTour() {
  try {
    if (localStorage.getItem('dbd:toured')) return;
  } catch {}
  if (!nodeEls.size) return; // wait for a schema
  setTimeout(() => tourShow(0), 700);
}
function setupTour() {
  $('#tour-next').addEventListener('click', () =>
    tourIdx >= TOUR_STEPS.length - 1 ? tourEnd() : tourShow(tourIdx + 1),
  );
  $('#tour-skip').addEventListener('click', tourEnd);
}

function setupHelp() {
  const modal = $('#help');
  const open = () => modal.classList.add('on');
  const close = () => modal.classList.remove('on');
  $('#btn-help').addEventListener('click', open);
  $('#help-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target.id === 'help') close();
  });
}

function setupSidebar() {
  const toggle = (collapsed) => {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    saveUIPrefs();
    // stage width changed — resync transform-dependent overlays
    requestAnimationFrame(() => updateViewport());
  };
  if (loadUIPrefs().sidebar) document.body.classList.add('sidebar-collapsed');
  $('#sidebar-collapse').addEventListener('click', () => toggle(true));
  $('#sidebar-show').addEventListener('click', () => toggle(false));

  const prefs = loadUIPrefs();
  if (typeof prefs.versionsOpen === 'boolean') state.versionsOpen = prefs.versionsOpen;
  $('#versions-sec')?.addEventListener('click', (e) => {
    const btn = e.target.closest('#versions-more');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    state.versionsOpen = !state.versionsOpen;
    saveUIPrefs();
    renderRail();
  });
}

setupTheme();
setupHelp();
setupTour();
setupPalette();
setupTimeMachine();
setupPathBar();
setupEdgeTips();
setupMinimapNav();
setupCanvas();
setupToolbar();
setupExport();
setupSidebar();
setupPanels();
setupMigrationPanel();
setupDeepReview();
applyTransform();
connect();
window.addEventListener('resize', () => updateViewport());
