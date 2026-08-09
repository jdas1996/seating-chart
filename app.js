/* ===========================================================
   Reception Seating Chart — collaborative, realtime
   Backed by Firebase Realtime Database.
   =========================================================== */

const COLORS = ['#b8965a','#7a8c6c','#a05c5c','#5c7a9c','#9c6ca0','#c48a4a','#5c8c8a'];
const GROUP_COLORS = ['#5c7a9c','#7a8c6c','#a05c5c','#9c6ca0','#c48a4a','#5c8c8a','#b8965a','#8a7a5c'];
let activeGroups = new Set();   // multi-select group filter (local to this device)

// short labels for the small chips on guest cards
const GROUP_SHORT = {
  "Bridesmaid/Bridesmaid Family": "BM",
  "Groomsmen/Groomsmen Family": "GM",
  "CityLine": "CL",
  "I Don't Know": "?",
  "Joncy Family": "JY FAM",
  "Joncy Friends (old)": "OLD",
  "Joncy Friends (young)": "YOUNG",
  "Joncy's Parents Connect": "JY PARENTS",
  "MidOpt": "MidOpt",
  "Novena's Family": "NV FAM",
  "Novena's Friend": "NV FRIEND",
  "Novena's Mom Connect": "NV MOM",
  "Tamil Church": "TAMIL"
};
function shortGroup(group){ return GROUP_SHORT[group] || group; }

let db, presenceRef, connectedRef;
let clientId, myName, myColor;
let state = { seatSize: 10, tables: {} };
let groupOverrides = {};   // synced edits to guests' groups, keyed by encoded name
let guestExtras = {};      // guests added via RSVP uploads, synced in Firebase
let tableMap = {};         // legacy sketch-canvas positions, 0–1 fractions. Kept as backup.
let tablePos = {};         // floor-plan positions in SVG user units {id:{x,y}}
let furniPos = {};         // moved DJ/gifts/cake/etc positions {furnId:{x,y}}
let seededPos = false;     // only ever seed missing positions once per load
let viewMode = 'list';     // 'list' | 'map' | 'assign'
let mapSlots = [];         // frozen spot coordinates for the assign view
let binned = {};           // groups pulled off the map into the assign bin
let layoutLock = false;    // when true, positions and assignments are frozen
let dragTableId = null;    // bin card being dragged in the assign view
let expandedBins = new Set();   // bin cards showing their full guest list

/* The venue layout from the floor-plan app's JSON backup: every numbered spot
   at its exact position, numbers FIXED (they never re-derive from position).
   'SH' is the sweetheart spot. Note: the source layout carries "36" twice and
   no "30" — kept verbatim by request. */
const FIXED_SLOTS = [{"x": 804, "y": 340, "n": "20"}, {"x": 855, "y": 340, "n": "9"}, {"x": 907, "y": 340, "n": "1"}, {"x": 403, "y": 391, "n": "35"}, {"x": 727, "y": 391, "n": "21"}, {"x": 776, "y": 388, "n": "19"}, {"x": 827, "y": 388, "n": "10"}, {"x": 878, "y": 389, "n": "8"}, {"x": 930, "y": 424, "n": "2"}, {"x": 823, "y": 443, "n": "11"}, {"x": 882, "y": 451, "n": "7"}, {"x": 930, "y": 482, "n": "3"}, {"x": 822, "y": 496, "n": "12"}, {"x": 881, "y": 510, "n": "6"}, {"x": 930, "y": 538, "n": "4"}, {"x": 401, "y": 543, "n": "36"}, {"x": 454, "y": 543, "n": "34"}, {"x": 506, "y": 543, "n": "31"}, {"x": 557, "y": 543, "n": "29"}, {"x": 664, "y": 592, "n": "25"}, {"x": 706, "y": 548, "n": "22"}, {"x": 760, "y": 548, "n": "18"}, {"x": 811, "y": 548, "n": "13"}, {"x": 886, "y": 584, "n": "5"}, {"x": 401, "y": 587, "n": "37"}, {"x": 457, "y": 587, "n": "33"}, {"x": 506, "y": 587, "n": "32"}, {"x": 555, "y": 587, "n": "28"}, {"x": 606, "y": 587, "n": "27"}, {"x": 617, "y": 543, "n": "26"}, {"x": 719, "y": 592, "n": "23"}, {"x": 776, "y": 592, "n": "17"}, {"x": 834, "y": 592, "n": "14"}, {"x": 702, "y": 640, "n": "24"}, {"x": 756, "y": 640, "n": "36"}, {"x": 805, "y": 640, "n": "16"}, {"x": 850, "y": 641, "n": "15"}, {"x": 969.3, "y": 490.0, "n": "SH"}];
const FURNI_DEFAULT = {"cake":{"x":631.4,"y":433.4},"dj":{"x":459,"y":382.1},"gifts":{"x":386.8,"y":323.9}};
let slotsMigrated = false;

let presence = {};
let dragGuestName = null;
let localDragging = false;   // suppress re-renders while we drag, or the
let pendingRender = false;   // DOM rebuild destroys the card and kills the drag

/* ---------------- setup guard ---------------- */
if (!firebaseConfig || firebaseConfig.apiKey === 'PASTE_YOUR_API_KEY_HERE') {
  document.body.innerHTML =
    '<div style="max-width:520px;margin:80px auto;font-family:Georgia,serif;' +
    'padding:28px;border:1px solid #e5ddcd;border-radius:12px;background:#faf6ef;">' +
    '<h2>One setup step left</h2>' +
    '<p>Open <code>firebase-config.js</code> and paste in your Firebase project keys. ' +
    'Instructions are in <code>README.md</code>.</p></div>';
  throw new Error('Firebase not configured yet.');
}

firebase.initializeApp(firebaseConfig);
db = firebase.database();

/* ---------------- identity ---------------- */
function getClientId(){
  let id = sessionStorage.getItem('sc_client_id');
  if(!id){
    id = 'c-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem('sc_client_id', id);
  }
  return id;
}

function pickColor(name){
  let hash = 0;
  for(let i=0;i<name.length;i++) hash = (hash*31 + name.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

/* ---------------- name gate ---------------- */
const nameGate = document.getElementById('name-gate');
const nameInput = document.getElementById('name-input');
const nameSubmit = document.getElementById('name-submit');

function startSession(name){
  myName = name.trim().slice(0,20);
  myColor = pickColor(myName);
  localStorage.setItem('sc_name', myName);
  nameGate.classList.add('hidden');
  clientId = getClientId();
  initRealtime();
}

const savedName = localStorage.getItem('sc_name');
if(savedName){
  nameInput.value = savedName;
}
nameSubmit.addEventListener('click', ()=>{
  const v = nameInput.value.trim();
  if(!v){ nameInput.focus(); return; }
  startSession(v);
});
nameInput.addEventListener('keydown', e=>{ if(e.key==='Enter') nameSubmit.click(); });

/* ---------------- realtime wiring ---------------- */
// one-time fixes for misspelled names that are already seated: rename in
// place so seat assignments are preserved (idempotent, safe on both clients)
const NAME_FIXES = {
  'Mohan Daas': 'Mohan Doss',
  'Jemima Doss': 'Jemima Mohan',
  'Josiah Mathew': 'Josiah Varghese',
  'Rhea Mathew': 'Rhea John',
  'Jerry Jeevan': 'Jerill Jeevan'
};
function applyNameFixes(){
  Object.entries(state.tables).forEach(([id, t])=>{
    if((t.seats || []).some(n=>NAME_FIXES[n])){
      db.ref('seatingChart/tables/' + id + '/seats').transaction(seats=>{
        return (seats || []).map(n=>NAME_FIXES[n] || n);
      });
    }
  });
}

function initRealtime(){
  const chartRef = db.ref('seatingChart');
  chartRef.on('value', snap=>{
    const val = snap.val() || {};
    state.seatSize = val.seatSize || 10;
    state.tables = val.tables || {};
    document.getElementById('seat-size').value = state.seatSize;
    applyNameFixes();
    render();
  });

  presenceRef = db.ref('presence/' + clientId);
  presenceRef.set({ name: myName, color: myColor, draggingGuest: null, ts: firebase.database.ServerValue.TIMESTAMP });
  presenceRef.onDisconnect().remove();

  db.ref('presence').on('value', snap=>{
    presence = snap.val() || {};
    renderPresence();
    render(); // guest cards may need remote-drag highlight updates
  });

  connectedRef = db.ref('.info/connected');
  connectedRef.on('value', snap=>{
    const el = document.getElementById('connection-status');
    if(snap.val() === true){
      el.textContent = 'live';
      el.className = 'connection-status live';
    } else {
      el.textContent = 'reconnecting…';
      el.className = 'connection-status down';
    }
  });

  db.ref('groupOverrides').on('value', snap=>{
    groupOverrides = snap.val() || {};
    render();
  });

  db.ref('guestExtras').on('value', snap=>{
    guestExtras = snap.val() || {};
    render();
  });

  db.ref('tableMap').on('value', snap=>{
    tableMap = snap.val() || {};
    render();
  });

  /* Floor-plan positions live at their own path in SVG user units. The old
     `tableMap` (0–1 fractions of the sketch canvas) is left untouched as a
     backup — the two are not interchangeable, so nothing reads it any more. */
  db.ref('tablePos').on('value', snap=>{
    tablePos = snap.val() || {};
    render();
  });

  db.ref('furniPos').on('value', snap=>{
    furniPos = snap.val() || {};
    render();
  });

  db.ref('mapSlots').on('value', snap=>{
    mapSlots = snap.val() || [];
    /* one-shot upgrade: old slots had no fixed numbers — replace them with
       the venue layout from the floor-plan backup (idempotent on all clients) */
    if(!slotsMigrated && (!mapSlots.length || mapSlots[0].n === undefined)){
      slotsMigrated = true;
      db.ref('mapSlots').set(FIXED_SLOTS);
      db.ref('furniPos').update(FURNI_DEFAULT);
      return;
    }
    slotsMigrated = true;
    render();
  });

  db.ref('binned').on('value', snap=>{
    binned = snap.val() || {};
    render();
  });

  db.ref('layoutLock').on('value', snap=>{
    layoutLock = !!snap.val();
    const btn = document.getElementById('lock-btn');
    btn.textContent = layoutLock ? '🔒 Locked' : '🔓 Lock layout';
    btn.classList.toggle('locked', layoutLock);
    render();
  });

  db.ref('activity').limitToLast(30).on('value', snap=>{
    const val = snap.val() || {};
    const items = Object.values(val).sort((a,b)=> (b.ts||0) - (a.ts||0));
    renderActivity(items);
  });

  wireToolbar();
  wirePoolDrop();
  wireImportModal();
  wireRsvpUpload();
  wireRestoreSnapshot();
  wireEmptyMap();
}

function logActivity(text){
  db.ref('activity').push({ text, ts: firebase.database.ServerValue.TIMESTAMP });
}

/* ---------------- data helpers ---------------- */
function nameKey(name){
  return name.replace(/[.#$/\[\]]/g, '_');   // Firebase keys can't contain these
}

function normName(name){
  return name.replace(/^(Mr|Mrs|Ms|Dr|Rev|Pastor)\.\s+/, '').trim().toLowerCase();
}

// full guest roster: the built-in list plus any added via RSVP uploads
function rosterGuests(){
  const seen = new Set();
  const out = [];
  GUESTS.concat(Object.values(guestExtras)).forEach(g=>{
    const k = normName(g.name);
    if(!seen.has(k)){ seen.add(k); out.push(g); }
  });
  return out;
}

function guestByName(name){
  const g = rosterGuests().find(g=>g.name===name) || {name, meal:''};
  const override = groupOverrides[nameKey(name)];
  return override ? Object.assign({}, g, {group: override}) : g;
}

function tableIdsSorted(){
  return Object.keys(state.tables).sort((a,b)=>{
    const oa = state.tables[a].order || 0;
    const ob = state.tables[b].order || 0;
    return oa - ob;
  });
}

/* Table numbers follow the room rather than the order tables happened to be
   created in: FloorPlan.renumber() walks the plan top to bottom, left to right,
   so table 12 is always next to table 11 when you are standing in the room.
   Anything not yet placed keeps a stable number after the placed ones.
   Recomputed once per render — render() clears the cache. */
let numberCache = null;
function tableNumbers(){
  if(numberCache) return numberCache;
  const map = {};
  const nums = slotNumbers();
  Object.entries(slotOccupants()).forEach(([i, id])=>{ map[id] = nums[i]; });
  numberCache = map;
  return map;
}

function tableNumber(id){
  return tableNumbers()[id] || 0;
}

// per-table capacity (8–12); falls back to the global default for old tables
function tableCap(t){
  if(t && t.cap) return t.cap;
  if(t && /^sweetheart/i.test(t.title || '')) return 2;   // just Joncy & Novena
  return state.seatSize;
}

function findTableOf(name){
  for(const id of Object.keys(state.tables)){
    const seats = state.tables[id].seats || [];
    if(seats.includes(name)) return id;
  }
  return null;
}

function computeUnassigned(){
  const seated = new Set();
  Object.values(state.tables).forEach(t=>(t.seats||[]).forEach(n=>seated.add(n)));
  return rosterGuests().map(g=>g.name).filter(n=>!seated.has(n));
}

function allGroups(){
  const set = new Set();
  rosterGuests().forEach(g=>{ if(g.group) set.add(g.group); });
  Object.values(groupOverrides).forEach(g=>{ if(g) set.add(g); });
  return [...set].sort();
}

function groupColor(group){
  const groups = allGroups();
  return GROUP_COLORS[Math.max(0, groups.indexOf(group)) % GROUP_COLORS.length];
}

function remoteDraggersOf(name){
  return Object.entries(presence)
    .filter(([id, p]) => id !== clientId && p.draggingGuest === name)
    .map(([id, p]) => p);
}

/* ---------------- rendering ---------------- */
function render(){
  if(localDragging){ pendingRender = true; return; }
  numberCache = null;                 // positions or tables may have changed
  const search = (viewMode === 'list'
    ? document.getElementById('search').value
    : document.getElementById('bin-search').value).trim().toLowerCase();

  // pool
  const poolZone = document.getElementById('pool-zone');
  poolZone.innerHTML = '';
  renderGroupFilter();
  const unassigned = computeUnassigned();
  const poolNames = unassigned.filter(n=>{
    if(!n.toLowerCase().includes(search)) return false;
    if(activeGroups.size===0) return true;
    return activeGroups.has(guestByName(n).group);
  });
  if(poolNames.length===0){
    const hint = document.createElement('div');
    hint.className='empty-hint';
    hint.textContent = unassigned.length===0 ? 'Everyone is seated 🎉' : 'No matches';
    poolZone.appendChild(hint);
  }
  poolNames.forEach(name=>poolZone.appendChild(makeGuestEl(name)));
  document.getElementById('pool-count').textContent = unassigned.length + ' guest' + (unassigned.length===1?'':'s');

  // tables: while searching, tables with matches come first; the rest
  // (including empty ones) stay visible below as drop targets
  const wrap = document.getElementById('tables-wrap');
  const mapView = document.getElementById('map-view');
  wrap.classList.toggle('hidden', viewMode !== 'list');
  mapView.classList.toggle('hidden', viewMode === 'list');
  document.getElementById('pool-panel').classList.toggle('hidden', viewMode !== 'list');
  document.getElementById('bin-panel').classList.toggle('hidden', viewMode === 'list');
  document.body.classList.toggle('assign-mode', viewMode === 'assign');
  document.getElementById('add-slot-btn').classList.toggle('hidden', viewMode === 'list');
  if(viewMode === 'map'){
    document.getElementById('map-hint').textContent = layoutLock
      ? 'Layout is locked. Unlock to move tables.'
      : 'The real room. Unassigned table groups are on the left — drag one onto a dashed numbered spot to place it. Drag tables and furniture to arrange; click a table for its roster.';
    renderMap(search);
    renderBin();
  } else if(viewMode === 'assign'){
    document.getElementById('map-hint').textContent = layoutLock
      ? 'Layout is locked. Unlock to move groups.'
      : 'Drag a table group from the bin onto a numbered spot. Click a placed group to send it back to the bin.';
    renderAssign(search);
    renderBin();
  } else {
    wrap.innerHTML = '';
    let ids = tableIdsSorted();
    if(search){
      const hasMatch = id => (state.tables[id].seats || []).some(n=>n.toLowerCase().includes(search));
      ids = ids.filter(hasMatch).concat(ids.filter(id=>!hasMatch(id)));
    }
    ids.forEach(id=>{
      wrap.appendChild(makeTableEl(id, state.tables[id], search));
    });
  }

  renderTableDetail();   // keep the open table panel live

  // stats
  const seatedCount = rosterGuests().length - unassigned.length;
  document.getElementById('stat-seated').textContent = seatedCount;
  document.getElementById('stat-unseated').textContent = unassigned.length;
  document.getElementById('stat-tables').textContent = Object.keys(state.tables).length;
}

function makeGuestEl(name){
  const g = guestByName(name);
  const el = document.createElement('div');
  el.className='guest';
  el.draggable = true;
  el.dataset.name = name;

  const draggers = remoteDraggersOf(name);
  if(draggers.length){
    const who = draggers[0];
    el.classList.add('remote-drag');
    el.style.outlineColor = who.color;
    const badge = document.createElement('span');
    badge.className='remote-badge';
    badge.style.background = who.color;
    badge.textContent = who.name;
    el.appendChild(badge);
  }

  const nameSpan = document.createElement('span');
  nameSpan.textContent = name;
  el.appendChild(nameSpan);

  // group chips only appear while filtering, to keep the board clean
  if(g.group && activeGroups.size>0){
    const gtag = document.createElement('span');
    gtag.className='group-tag';
    gtag.style.background = groupColor(g.group);
    gtag.textContent = shortGroup(g.group);
    el.appendChild(gtag);
  }

  if(g.meal){
    const tag = document.createElement('span');
    tag.className='meal-tag';
    tag.textContent = g.meal;
    el.appendChild(tag);
  }

  const editBtn = document.createElement('button');
  editBtn.className='edit-group';
  editBtn.title='Edit group';
  editBtn.textContent='✎';
  editBtn.addEventListener('click', e=>{
    e.stopPropagation();
    openGroupEditor(name);
  });
  el.appendChild(editBtn);

  el.addEventListener('dragstart', e=>{
    dragGuestName = name;
    localDragging = true;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', name);
    db.ref('presence/' + clientId + '/draggingGuest').set(name);
  });
  el.addEventListener('dragend', ()=>{
    el.classList.remove('dragging');
    localDragging = false;
    db.ref('presence/' + clientId + '/draggingGuest').set(null);
    if(pendingRender){ pendingRender = false; render(); }
  });
  return el;
}

function makeTableEl(id, table, search){
  const card = document.createElement('div');
  card.className='table-card';

  const head = document.createElement('div');
  head.className='table-head';

  const numBadge = document.createElement('div');
  numBadge.className='table-num';
  numBadge.textContent = binned[id] ? '—' : tableNumber(id);
  head.appendChild(numBadge);

  const titleInput = document.createElement('input');
  titleInput.className='table-title';
  titleInput.value = table.title || 'Table';
  titleInput.addEventListener('change', ()=>{
    const newTitle = titleInput.value.trim() || table.title;
    db.ref('seatingChart/tables/' + id + '/title').set(newTitle);
    logActivity('<b>' + myName + '</b> renamed a table to "' + newTitle + '"');
  });

  const capInput = document.createElement('input');
  capInput.type='number'; capInput.min=8; capInput.max=12;
  capInput.className='table-cap';
  capInput.title='Seats at this table (8–12)';
  capInput.value = tableCap(table);
  capInput.addEventListener('change', ()=>{
    const v = Math.min(12, Math.max(8, parseInt(capInput.value,10) || tableCap(table)));
    capInput.value = v;
    db.ref('seatingChart/tables/' + id + '/cap').set(v);
    logActivity('<b>' + myName + '</b> set "' + (table.title||'a table') + '" to ' + v + ' seats');
  });

  const countBadge = document.createElement('div');
  countBadge.className='table-count';
  const cap = tableCap(table);
  const count = (table.seats || []).length;
  countBadge.textContent = count + '/' + cap;
  if(count === cap) countBadge.classList.add('full');
  if(count > cap) countBadge.classList.add('over');

  const delBtn = document.createElement('button');
  delBtn.className='del-table';
  delBtn.title='Delete table (unseats guests)';
  delBtn.textContent='✕';
  delBtn.addEventListener('click', ()=>{
    if(count>0 && !confirm('This table has '+count+' guest(s). Delete it and move them back to Unassigned?')) return;
    db.ref('seatingChart/tables/' + id).remove();
    logActivity('<b>' + myName + '</b> deleted "' + (table.title||'a table') + '"');
  });

  head.appendChild(titleInput);
  head.appendChild(capInput);
  head.appendChild(countBadge);
  head.appendChild(delBtn);
  card.appendChild(head);

  const zone = document.createElement('div');
  zone.className='drop-zone';
  zone.dataset.tableId = id;

  const seats = table.seats || [];
  if(seats.length===0){
    const hint = document.createElement('div');
    hint.className='empty-hint';
    hint.textContent='Drop guests here';
    zone.appendChild(hint);
  } else {
    seats.forEach(name=>{
      const el = makeGuestEl(name);
      if(search && name.toLowerCase().includes(search)) el.classList.add('search-hit');
      zone.appendChild(el);
    });
  }

  zone.addEventListener('dragover', e=>{ e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', ()=>zone.classList.remove('dragover'));
  zone.addEventListener('drop', e=>{
    e.preventDefault();
    zone.classList.remove('dragover');
    if(!dragGuestName) return;
    moveGuestToTable(dragGuestName, id, table.title);
    dragGuestName = null;
  });

  card.appendChild(zone);
  return card;
}

/* ---------------- mutations ---------------- */
function moveGuestToTable(name, tableId, tableTitle){
  const oldId = findTableOf(name);
  if(oldId === tableId) return;

  if(oldId){
    db.ref('seatingChart/tables/' + oldId + '/seats').transaction(seats=>{
      seats = seats || [];
      return seats.filter(n=>n!==name);
    });
  }
  db.ref('seatingChart/tables/' + tableId + '/seats').transaction(seats=>{
    seats = seats || [];
    if(!seats.includes(name)) seats.push(name);
    return seats;
  });
  logActivity('<b>' + myName + '</b> seated <b>' + name + '</b> at "' + (tableTitle||'a table') + '"');
}

function moveGuestToPool(name){
  const oldId = findTableOf(name);
  if(!oldId) return;
  db.ref('seatingChart/tables/' + oldId + '/seats').transaction(seats=>{
    seats = seats || [];
    return seats.filter(n=>n!==name);
  });
  logActivity('<b>' + myName + '</b> moved <b>' + name + '</b> back to Unassigned');
}

/* ---------------- group filter ---------------- */
function renderGroupFilter(){
  const bar = document.getElementById('group-filter');
  const groups = allGroups();
  bar.innerHTML = '';
  if(groups.length===0){ bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');

  groups.forEach(group=>{
    const chip = document.createElement('button');
    chip.className='group-chip' + (activeGroups.has(group) ? ' active' : '');
    chip.style.setProperty('--chip-color', groupColor(group));
    chip.textContent = group;
    chip.addEventListener('click', ()=>{
      if(activeGroups.has(group)) activeGroups.delete(group);
      else activeGroups.add(group);
      render();
    });
    bar.appendChild(chip);
  });

  if(activeGroups.size>0){
    const clear = document.createElement('button');
    clear.className='group-chip clear';
    clear.textContent='clear';
    clear.addEventListener('click', ()=>{ activeGroups.clear(); render(); });
    bar.appendChild(clear);
  }
}

/* ---------------- room map view ---------------- */
/* The venue floor plan, drawn by floorplan.js from the traced room geometry.
   This app owns the data; floorplan.js owns the drawing and knows nothing
   about Firebase. */

/* Give every table a spot the first time the plan is opened. Positions come
   from the venue diagram in creation order, so the initial plan matches the
   PDF the couple started from; after that everyone drags. Runs at most once
   per page load — the write comes back through the tablePos listener. */
function seedMissingPositions(ids){
  if(seededPos) return false;
  const missing = ids.filter(id=>!tablePos[id]);
  if(!missing.length) return false;
  seededPos = true;

  // don't drop a new table on top of one already sitting on a diagram slot
  const taken = [];
  FloorPlan.R_TABLES.forEach((p, i)=>{
    for(const id in tablePos){
      if(Math.abs(tablePos[id].x - p[0]) < 0.5 && Math.abs(tablePos[id].y - p[1]) < 0.5){
        taken.push(i);
        break;
      }
    }
  });

  const seeds = FloorPlan.seedPositions(
    missing.map(id=>({ id, title:(state.tables[id] || {}).title || '' })), taken);
  const updates = {};
  seeds.forEach(s=>{ updates['tablePos/' + s.id] = { x:s.x, y:s.y }; });
  db.ref().update(updates);
  return true;
}

function renderMap(search){
  const svg = document.getElementById('fp-svg');
  const ids = tableIdsSorted().filter(id=>!binned[id]);
  if(seedMissingPositions(ids)) return;   // listener will re-render once written

  const nums = tableNumbers();
  const searchHit = {};
  const tables = ids.map(id=>{
    const table = state.tables[id] || {};
    const seats = table.seats || [];
    const pos = tablePos[id] || { x:FloorPlan.SWEET_POS.x, y:FloorPlan.SWEET_POS.y };
    if(search && seats.some(n=>n.toLowerCase().includes(search))) searchHit[id] = true;
    return {
      id: id,
      title: '',   // names stay off the map — numbers only
      x: pos.x,
      y: pos.y,
      r: /^sweetheart/i.test(table.title || '') ? FloorPlan.SWEET_POS.r : 14,
      count: seats.length,
      cap: tableCap(table),
      label: String(nums[id] || '')
    };
  });

  /* empty numbered spots (from the frozen slot list) draw alongside the
     placed tables, so the map is also the assignment surface */
  const occ = mapSlots.length ? slotOccupants() : {};
  const slotNums2 = mapSlots.length ? slotNumbers() : {};
  const emptySlots = mapSlots
    .map((s,i)=>({ i, x:s.x, y:s.y, label:String(slotNums2[i]||'') }))
    .filter(s=>!(s.i in occ));

  const flags = FloorPlan.draw({
    svg: svg,
    tables: tables,
    searchHit: searchHit,
    locked: layoutLock,
    slots: emptySlots,
    furniturePos: furniPos,
    onMoveFurn: (fid, x, y)=>{
      if(layoutLock){ render(); return; }
      db.ref('furniPos/' + fid).set({ x, y });
    },
    guestDragActive: ()=>!!dragGuestName || !!dragTableId,
    onSelect: id=>openTableDetail(id),
    onMove: (id, x, y)=>{
      if(layoutLock){ render(); return; }
      db.ref('tablePos/' + id).set({ x:x, y:y });
    },
    onDropGroup: i=>{
      if(dragTableId){ assignGroupToSlot(dragTableId, i); dragTableId = null; }
    },
    onSlotClick: i=>{
      if(layoutLock) return;
      if(!confirm('Delete this empty table spot? Numbering shifts automatically.')) return;
      const next = mapSlots.slice();
      next.splice(i, 1);
      db.ref('mapSlots').set(next);
    },
    onDropGuest: id=>{
      if(!dragGuestName) return;
      moveGuestToTable(dragGuestName, id, (state.tables[id] || {}).title);
      dragGuestName = null;
    }
  });

  /* Only spacing is warned about here. Numbers are derived from position on
     every render rather than stored per table, so two tables cannot share one
     — the duplicate check in floorplan.js stays for the day a table carries a
     hand-typed number, but it has nothing to report today. */
  const clashEl = document.getElementById('fp-clash');
  clashEl.querySelector('b').textContent = flags.nClash;
  clashEl.classList.toggle('on', flags.nClash > 0);
}

function setView(mode){
  viewMode = viewMode === mode ? 'list' : mode;
  document.getElementById('map-toggle').textContent = viewMode === 'map' ? 'List view' : 'Map view';
  document.getElementById('assign-toggle').textContent = viewMode === 'assign' ? 'List view' : 'Assign tables';
  render();
}
document.getElementById('map-toggle').addEventListener('click', ()=>setView('map'));
document.getElementById('assign-toggle').addEventListener('click', ()=>setView('assign'));

document.getElementById('lock-btn').addEventListener('click', ()=>{
  const msg = layoutLock
    ? 'Unlock the layout so tables and assignments can move again?'
    : 'Lock the layout? Table positions and number assignments will be frozen for everyone until unlocked.';
  if(!confirm(msg)) return;
  db.ref('layoutLock').set(!layoutLock);
  logActivity('<b>' + myName + '</b> ' + (layoutLock ? 'unlocked' : 'locked') + ' the table layout');
});

/* ---------------- assign view: bin + numbered spots ---------------- */
/* The frozen spots come from a one-time snapshot of the arranged map.
   Numbers are derived from spot position with the same renumber() the map
   uses, so a spot's number here always matches the map and the exports. */
function seedSlotsIfNeeded(){
  if(mapSlots.length) return true;
  const placed = tableIdsSorted().filter(id=>tablePos[id] && !binned[id]);
  if(!placed.length){
    alert('Arrange your tables on the Map view first — those positions become the numbered spots.');
    return false;
  }
  db.ref('mapSlots').set(placed.map(id=>({ x:tablePos[id].x, y:tablePos[id].y })));
  return false;   // listener re-renders once written
}

function slotNumbers(){
  const map = {};
  FloorPlan.renumber(mapSlots.map((s,i)=>({ id:i, x:s.x, y:s.y })))
    .forEach(r=>{ map[r.id] = r.label; });
  mapSlots.forEach((s,i)=>{ if(s.n !== undefined) map[i] = String(s.n); });
  return map;
}

function slotOccupants(){
  const occ = {};   // slot index -> tableId
  tableIdsSorted().forEach(id=>{
    if(binned[id] || !tablePos[id]) return;
    mapSlots.forEach((s,i)=>{
      if(Math.abs(s.x - tablePos[id].x) < 3 && Math.abs(s.y - tablePos[id].y) < 3) occ[i] = id;
    });
  });
  return occ;
}

function assignGroupToSlot(tableId, slotIdx){
  if(layoutLock){ alert('The layout is locked. Unlock it first.'); return; }
  const occ = slotOccupants();
  if(occ[slotIdx] && occ[slotIdx] !== tableId){ alert('That spot is taken — clear it first.'); return; }
  const s = mapSlots[slotIdx];
  db.ref().update({
    ['tablePos/' + tableId]: { x:s.x, y:s.y },
    ['binned/' + tableId]: null
  });
  logActivity('<b>' + myName + '</b> assigned "' + ((state.tables[tableId]||{}).title||'a table') +
              '" to table #' + slotNumbers()[slotIdx]);
}

function sendGroupToBin(tableId){
  if(layoutLock){ alert('The layout is locked. Unlock it first.'); return; }
  const t = state.tables[tableId] || {};
  if(!confirm('Send "' + (t.title||'this table') + '" back to the bin?')) return;
  db.ref().update({
    ['tablePos/' + tableId]: null,
    ['binned/' + tableId]: true
  });
  logActivity('<b>' + myName + '</b> moved "' + (t.title||'a table') + '" back to the bin');
}

function mealSummary(seats){
  const c = {};
  (seats||[]).forEach(n=>{
    const m = guestByName(n).meal || '?';
    c[m] = (c[m]||0) + 1;
  });
  return Object.entries(c).map(([m,n])=>n + ' ' + m).join(' · ');
}

function renderAssign(search){
  const svg = document.getElementById('fp-svg');
  if(!seedSlotsIfNeeded()) return;

  const nums = slotNumbers();
  const occ = slotOccupants();
  const occupiedIds = new Set(Object.values(occ));
  const searchHit = {};

  // placed groups sit exactly on their spot and carry its number
  const tables = [];
  Object.entries(occ).forEach(([i, id])=>{
    const table = state.tables[id];
    if(!table) return;
    const seats = table.seats || [];
    if(search && seats.some(n=>n.toLowerCase().includes(search))) searchHit[id] = true;
    tables.push({
      id, title: '',
      x: mapSlots[i].x, y: mapSlots[i].y,
      r: /^sweetheart/i.test(table.title||'') ? FloorPlan.SWEET_POS.r : 14,
      count: seats.length, cap: tableCap(table), label: String(nums[i]||'')
    });
  });

  const emptySlots = mapSlots
    .map((s,i)=>({ i, x:s.x, y:s.y, label:String(nums[i]||'') }))
    .filter(s=>!(s.i in occ));

  FloorPlan.draw({
    svg, tables, searchHit,
    slots: emptySlots,
    locked: layoutLock,
    furniturePos: furniPos,
    onMoveFurn: (fid, x, y)=>{
      if(layoutLock){ render(); return; }
      db.ref('furniPos/' + fid).set({ x, y });
    },

    guestDragActive: ()=>!!dragGuestName || !!dragTableId,
    onSelect: id=>sendGroupToBin(id),
    onMove: (id, x, y)=>{
      if(layoutLock){ render(); return; }
      // snap to the nearest free spot; otherwise snap back where it was
      let best = null, bd = 1e9;
      emptySlots.forEach(s=>{
        const d = Math.hypot(s.x - x, s.y - y);
        if(d < bd){ bd = d; best = s; }
      });
      if(best && bd < 30) assignGroupToSlot(id, best.i);
      else render();
    },
    onDropGroup: i=>{
      if(dragTableId){ assignGroupToSlot(dragTableId, i); dragTableId = null; }
    },
    onSlotClick: i=>{
      if(layoutLock){ return; }
      if(!confirm('Delete this empty table spot? Numbering shifts automatically.')) return;
      const next = mapSlots.slice();
      next.splice(i, 1);
      db.ref('mapSlots').set(next);
      logActivity('<b>' + myName + '</b> deleted a table spot from the map');
    },
    onDropGuest: id=>{
      if(!dragGuestName) return;
      moveGuestToTable(dragGuestName, id, (state.tables[id] || {}).title);
      dragGuestName = null;
    }
  });

  const clashEl = document.getElementById('fp-clash');
  clashEl.querySelector('b').textContent = 0;
  clashEl.classList.remove('on');
}

function addSlot(){
  if(layoutLock){ alert('The layout is locked. Unlock it first.'); return; }
  if(!mapSlots.length){ alert('Open the Assign view once first so spots exist.'); return; }
  // first venue-diagram position not already close to an existing spot
  const free = FloorPlan.R_TABLES.find(p=>
    !mapSlots.some(s=>Math.hypot(s.x - p[0], s.y - p[1]) < 20));
  const pos = free ? { x:free[0], y:free[1] } : { x:500, y:466 };  // else dance floor
  const used = new Set(mapSlots.map(s=>String(s.n)));
  let n = 1; while(used.has(String(n))) n++;
  pos.n = String(n);
  db.ref('mapSlots').set(mapSlots.concat([pos]));
  logActivity('<b>' + myName + '</b> added a table spot to the map');
}

function renderBin(){
  const zone = document.getElementById('bin-zone');
  zone.innerHTML = '';
  const occupiedIds = new Set(Object.values(slotOccupants()));
  let binIds = tableIdsSorted().filter(id=>!occupiedIds.has(id));
  document.getElementById('bin-count').textContent =
    binIds.length ? binIds.length + ' group' + (binIds.length===1?'':'s') + ' to place' : 'All groups placed 🎉';

  /* a guest search floats their group to the top, highlighted */
  const q = document.getElementById('bin-search').value.trim().toLowerCase();
  const hits = {};
  if(q){
    binIds.forEach(id=>{
      const m = ((state.tables[id]||{}).seats||[]).find(n=>n.toLowerCase().includes(q));
      if(m) hits[id] = m;
    });
    binIds = binIds.filter(id=>hits[id]).concat(binIds.filter(id=>!hits[id]));
  }

  binIds.forEach(id=>{
    const t = state.tables[id] || {};
    const card = document.createElement('div');
    card.className = 'bin-card';
    card.draggable = !layoutLock;
    const title = document.createElement('div');
    title.className = 'bin-title';
    title.textContent = t.title || 'Table';
    const meta = document.createElement('div');
    meta.className = 'bin-meta';
    const seats = t.seats || [];
    meta.textContent = seats.length + ' guests' + (seats.length ? ' — ' + mealSummary(seats) : '');
    card.appendChild(title);
    card.appendChild(meta);
    if(hits[id]){
      card.classList.add('search-hit');
      const found = document.createElement('div');
      found.className = 'bin-meta bin-found';
      found.textContent = '→ ' + hits[id];
      card.appendChild(found);
    }

    /* expandable roster: see everyone in the group before placing it */
    const tog = document.createElement('button');
    tog.className = 'bin-toggle';
    tog.textContent = expandedBins.has(id) ? '▾ hide guests' : '▸ show guests';
    tog.addEventListener('click', e=>{
      e.stopPropagation();
      expandedBins.has(id) ? expandedBins.delete(id) : expandedBins.add(id);
      renderBin();
    });
    card.appendChild(tog);
    if(expandedBins.has(id)){
      const list = document.createElement('div');
      list.className = 'bin-roster';
      seats.slice().sort((a,b)=>normName(a).localeCompare(normName(b))).forEach(n=>{
        const row = document.createElement('div');
        row.className = 'bin-roster-row';
        const nm = document.createElement('span');
        nm.textContent = n;
        row.appendChild(nm);
        const g = guestByName(n);
        if(g.meal){
          const mt = document.createElement('i');
          mt.className = 'bin-roster-meal';
          mt.textContent = g.meal;
          row.appendChild(mt);
        }
        list.appendChild(row);
      });
      card.appendChild(list);
    }
    card.addEventListener('dragstart', e=>{
      dragTableId = id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', ()=>{ dragTableId = null; card.classList.remove('dragging'); });
    zone.appendChild(card);
  });
}

/* ---------------- table detail panel ---------------- */
let openTableId = null;

function openTableDetail(id){
  openTableId = id;
  renderTableDetail();
  document.getElementById('table-modal').classList.remove('hidden');
}

function closeTableDetail(){
  openTableId = null;
  document.getElementById('table-modal').classList.add('hidden');
}

function renderTableDetail(){
  if(!openTableId) return;
  const id = openTableId;
  const t = state.tables[id];
  if(!t){ closeTableDetail(); return; }
  const seats = t.seats || [];

  document.getElementById('td-number').textContent = binned[id] ? '—' : '#' + tableNumber(id);
  const titleInput = document.getElementById('td-title');
  titleInput.value = t.title || 'Table';
  titleInput.onchange = ()=>{
    const v = titleInput.value.trim() || t.title;
    db.ref('seatingChart/tables/' + id + '/title').set(v);
    logActivity('<b>' + myName + '</b> renamed a table to "' + v + '"');
  };
  const capInput = document.getElementById('td-cap');
  capInput.value = tableCap(t);
  capInput.onchange = ()=>{
    const v = Math.min(12, Math.max(8, parseInt(capInput.value,10) || tableCap(t)));
    capInput.value = v;
    db.ref('seatingChart/tables/' + id + '/cap').set(v);
  };

  const list = document.getElementById('td-guests');
  list.innerHTML = '';
  if(!seats.length){
    const d = document.createElement('div');
    d.className='empty-hint';
    d.textContent='Nobody seated yet.';
    list.appendChild(d);
  }
  seats.forEach(n=>{
    const g = guestByName(n);
    const row = document.createElement('div');
    row.className='td-guest';
    const nm = document.createElement('span');
    nm.textContent = n;
    row.appendChild(nm);
    if(g.meal){
      const tag = document.createElement('span');
      tag.className='meal-tag';
      tag.textContent = g.meal;
      row.appendChild(tag);
    }
    const rm = document.createElement('button');
    rm.className='td-unseat';
    rm.title='Move back to Unassigned';
    rm.textContent='✕';
    rm.onclick = ()=>moveGuestToPool(n);
    row.appendChild(rm);
    list.appendChild(row);
  });

  document.getElementById('td-meals').textContent =
    seats.length ? mealSummary(seats) + '  ·  ' + seats.length + '/' + tableCap(t) + ' seats' : '';

  const allergies = [];
  seats.forEach(n=>{
    const g = guestByName(n);
    if(g.diet && !allergies.includes(g.diet)) allergies.push(g.diet);
  });
  const alBox = document.getElementById('td-allergies');
  alBox.innerHTML = '';
  if(allergies.length){
    const h = document.createElement('div');
    h.className='td-allergy-head';
    h.textContent = '⚠ Dietary notes';
    alBox.appendChild(h);
    allergies.forEach(a=>{
      const d = document.createElement('div');
      d.className='td-allergy';
      d.textContent = a;
      alBox.appendChild(d);
    });
  }

  /* From the map, "deleting" only unplaces: the group card returns to the
     Assign-view bin with everyone still bound. A real delete (which unbinds
     the people) lives only on the List view's ✕. */
  const tdDel = document.getElementById('td-delete');
  tdDel.textContent = 'Remove from map (keeps group)';
  tdDel.onclick = ()=>{
    if(!confirm('Take "' + (t.title||'this table') + '" off the map? The group stays together in the Assign-view bin.')) return;
    db.ref().update({ ['tablePos/' + id]: null, ['binned/' + id]: true });
    logActivity('<b>' + myName + '</b> removed "' + (t.title||'a table') + '" from the map (group kept)');
    closeTableDetail();
  };
  document.getElementById('td-close').onclick = closeTableDetail;
}

/* ---------------- group editor ---------------- */
function openGroupEditor(name){
  const g = guestByName(name);
  const modal = document.getElementById('group-modal');
  const select = document.getElementById('group-select');
  const newInput = document.getElementById('group-new');
  document.getElementById('group-guest-name').textContent = name;

  select.innerHTML = '';
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '(no group)';
  select.appendChild(noneOpt);
  allGroups().forEach(group=>{
    const opt = document.createElement('option');
    opt.value = group;
    opt.textContent = group;
    if(group === g.group) opt.selected = true;
    select.appendChild(opt);
  });
  newInput.value = '';
  modal.classList.remove('hidden');

  document.getElementById('group-cancel').onclick = ()=> modal.classList.add('hidden');
  document.getElementById('group-save').onclick = ()=>{
    const chosen = newInput.value.trim() || select.value;
    modal.classList.add('hidden');
    if(chosen === (g.group || '')) return;
    db.ref('groupOverrides/' + nameKey(name)).set(chosen || null);
    logActivity('<b>' + myName + '</b> changed <b>' + name + "</b>'s group to \"" + (chosen || 'none') + '"');
  };
}

/* ---------------- presence + activity rendering ---------------- */
function renderPresence(){
  const list = document.getElementById('presence-list');
  list.innerHTML = '';
  const seen = new Set();
  Object.values(presence).forEach(p=>{
    if(!p || !p.name) return;
    const key = p.name;
    if(seen.has(key)) return; // collapse multiple tabs of the same person
    seen.add(key);
    const chip = document.createElement('div');
    chip.className='presence-chip';
    chip.style.background = p.color;
    const dot = document.createElement('span');
    dot.className='dot';
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(p.name));
    list.appendChild(chip);
  });
}

function renderActivity(items){
  const list = document.getElementById('activity-list');
  list.innerHTML = '';
  if(items.length===0){
    const empty = document.createElement('div');
    empty.className='activity-item';
    empty.textContent = 'Nothing yet — start dragging!';
    list.appendChild(empty);
    return;
  }
  items.forEach(item=>{
    const row = document.createElement('div');
    row.className='activity-item';
    row.innerHTML = item.text;
    list.appendChild(row);
  });
}

document.getElementById('activity-toggle').addEventListener('click', ()=>{
  const drawer = document.getElementById('activity-drawer');
  drawer.classList.toggle('collapsed');
  document.getElementById('activity-caret').textContent = drawer.classList.contains('collapsed') ? '▸' : '▾';
});

/* ---------------- toolbar ---------------- */
function wireToolbar(){
  document.getElementById('search').addEventListener('input', render);
  document.getElementById('bin-search').addEventListener('input', render);

  document.getElementById('add-table').addEventListener('click', ()=>{
    const n = Object.keys(state.tables).length + 1;
    const id = 'table-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
    const title = 'Table ' + n;
    db.ref('seatingChart/tables/' + id).set({ title, seats: [], order: Date.now() });
    logActivity('<b>' + myName + '</b> added "' + title + '"');
  });

  document.getElementById('seat-size').addEventListener('change', e=>{
    const v = parseInt(e.target.value, 10);
    if(v && v>0){
      db.ref('seatingChart/seatSize').set(v);
      logActivity('<b>' + myName + '</b> set seats-per-table to ' + v);
    }
  });

  document.getElementById('auto-fill').addEventListener('click', ()=>{
    const cap = state.seatSize;
    let pool = computeUnassigned().slice();
    const updates = {};
    const ids = tableIdsSorted();
    ids.forEach(id=>{
      const current = (state.tables[id].seats || []).slice();
      const tcap = tableCap(state.tables[id]);
      while(current.length < tcap && pool.length>0){
        current.push(pool.shift());
      }
      updates['seatingChart/tables/' + id + '/seats'] = current;
    });
    let n = ids.length;
    while(pool.length>0){
      n += 1;
      const id = 'table-' + Date.now() + '-' + Math.random().toString(36).slice(2,6) + n;
      updates['seatingChart/tables/' + id + '/title'] = 'Table ' + n;
      updates['seatingChart/tables/' + id + '/order'] = Date.now() + n;
      updates['seatingChart/tables/' + id + '/seats'] = pool.splice(0, cap);
    }
    db.ref().update(updates);
    logActivity('<b>' + myName + '</b> auto-filled empty seats');
  });

  document.getElementById('meal-count-btn').addEventListener('click', downloadMealCounts);
  document.getElementById('guest-list-btn').addEventListener('click', downloadGuestLists);
  document.getElementById('add-slot-btn').addEventListener('click', addSlot);

  document.getElementById('reset-btn').addEventListener('click', ()=>{
    if(!confirm("This clears every table's seats and moves everyone back to Unassigned. Table names stay. Continue?")) return;
    const updates = {};
    Object.keys(state.tables).forEach(id=>{
      updates['seatingChart/tables/' + id + '/seats'] = [];
    });
    db.ref().update(updates);
    logActivity('<b>' + myName + '</b> reset all tables to unassigned');
  });
}

function wirePoolDrop(){
  const poolZone = document.getElementById('pool-zone');
  poolZone.addEventListener('dragover', e=>{ e.preventDefault(); poolZone.classList.add('dragover'); });
  poolZone.addEventListener('dragleave', ()=>poolZone.classList.remove('dragover'));
  poolZone.addEventListener('drop', e=>{
    e.preventDefault();
    poolZone.classList.remove('dragover');
    if(dragGuestName){ moveGuestToPool(dragGuestName); dragGuestName=null; }
  });
}

/* ---------------- RSVP export upload (additive only) ---------------- */
/* ---------------- empty the map: all groups to the bin, spots to default ---- */
function wireEmptyMap(){
  document.getElementById('empty-map').addEventListener('click', ()=>{
    if(layoutLock){ alert('The layout is locked. Unlock it first.'); return; }
    const ids = tableIdsSorted();
    if(!confirm('Empty the map?\n\nAll ' + ids.length + ' table groups go to the bin (people stay ' +
      'grouped), and the numbered spots reset to the venue\'s default layout. ' +
      'Then assign groups by dragging them onto spots.')) return;
    const updates = {};
    ids.forEach(id=>{
      updates['tablePos/' + id] = null;
      updates['binned/' + id] = true;
    });
    updates['mapSlots'] = FIXED_SLOTS;
    db.ref().update(updates).then(()=>{
      logActivity('<b>' + myName + '</b> emptied the map — all groups to the bin, spots reset to the venue default');
    });
  });
}

/* ---------------- restore board from the baked-in snapshot ---------------- */
function wireRestoreSnapshot(){
  document.getElementById('restore-snap').addEventListener('click', ()=>{
    if(typeof SNAPSHOT === 'undefined' || !SNAPSHOT.length){ alert('No snapshot bundled.'); return; }
    const byTitle = {};
    Object.entries(state.tables).forEach(([id, t])=>{ byTitle[(t.title||'').trim()] = id; });
    let matched = 0, created = 0;
    const updates = {};
    SNAPSHOT.forEach((s, i)=>{
      const id = byTitle[s.title.trim()];
      if(id){ updates['seatingChart/tables/' + id + '/seats'] = s.seats; matched++; }
      else {
        const nid = 'table-restore-' + Date.now() + '-' + i;
        updates['seatingChart/tables/' + nid] = { title: s.title, seats: s.seats, order: Date.now() + i };
        created++;
      }
    });
    const extra = Object.values(state.tables)
      .filter(t=>!SNAPSHOT.some(s=>s.title.trim()===(t.title||'').trim())).length;
    if(!confirm('Restore the Aug 9 snapshot?\n\n' +
      matched + ' existing table(s) get their seat lists reset to the snapshot,\n' +
      created + ' deleted table(s) are re-created with their people,\n' +
      (extra ? extra + ' table(s) not in the snapshot are left alone.\n' : '') +
      '\nSeat changes made since the snapshot will be overwritten.')) return;
    db.ref().update(updates).then(()=>{
      logActivity('<b>' + myName + '</b> restored the board from the Aug 9 snapshot');
      alert('Restored. Every table now matches the exported Excel.');
    }).catch(e=>alert('Restore failed: ' + e.message));
  });
}

function wireRsvpUpload(){
  const input = document.getElementById('rsvp-file');
  document.getElementById('rsvp-upload-btn').addEventListener('click', ()=> input.click());

  input.addEventListener('change', ()=>{
    const file = input.files[0];
    input.value = '';
    if(!file) return;
    const reader = new FileReader();
    reader.onload = e=>{
      let rows;
      try{
        const wb = XLSX.read(e.target.result, {type:'array'});
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:''});
      }catch(err){
        alert('Could not read that file. Make sure it is the RSVP export (.xlsx or .csv).');
        return;
      }
      if(!rows.length || !('Reception' in rows[0]) || !('First Name' in rows[0])){
        alert('That file does not look like the RSVP export — expected columns like "First Name", "Reception", "Meal Choice".');
        return;
      }

      const attending = {};
      rows.forEach(r=>{
        if(String(r['Reception']).trim() !== 'Attending') return;
        const name = ['Title','First Name','Last Name','Suffix']
          .map(c=>String(r[c]||'').trim()).filter(Boolean).join(' ');
        if(!name) return;
        let meal = String(r['Meal Choice']||'').trim();
        if(meal === 'No Response') meal = '';
        attending[name] = meal;
      });

      const roster = rosterGuests();
      const have = new Set(roster.map(g=>normName(g.name)));
      const attNorm = new Set(Object.keys(attending).map(normName));
      const added = Object.keys(attending).filter(n=>!have.has(normName(n)));
      const noLonger = roster.map(g=>g.name).filter(n=>!attNorm.has(normName(n)));

      let msg = 'This update is additive only — nobody is removed and no seats change.\n\n';
      msg += added.length
        ? 'Will ADD ' + added.length + ' new attending guest(s):\n• ' + added.join('\n• ')
        : 'No new attending guests found.';
      if(noLonger.length){
        msg += '\n\nFYI — on the board but NOT attending in this file (left untouched; remove by hand if correct):\n• ' + noLonger.join('\n• ');
      }
      if(added.length===0){ alert(msg); return; }
      if(!confirm(msg + '\n\nAdd them?')) return;

      const updates = {};
      added.forEach(n=>{ updates['guestExtras/' + nameKey(n)] = { name: n, meal: attending[n] }; });
      db.ref().update(updates).then(()=>{
        logActivity('<b>' + myName + '</b> uploaded an RSVP export — added ' + added.length + ' guest(s)');
      });
    };
    reader.readAsArrayBuffer(file);
  });
}

/* ---------------- venue meal count export ---------------- */
const MEAL_TO_VENUE = { steak:'Beef', chicken:'Chicken', lamb:'Lamb', salmon:'Fish', veggie:'Veg', kids:'Kids' };
function downloadMealCounts(){
  const cols = ['Beef','Chicken','Lamb','Fish','Veg','Kids'];
  const rows = [['TABLE','#Beef','#Chicken','#Lamb','#Fish','#Veg','#Kids','Total','COMMENTS']];
  const totals = {Beef:0,Chicken:0,Lamb:0,Fish:0,Veg:0,Kids:0};
  let grand = 0;

  // head table (any table whose name contains "head") first, then board order
  let ids = tableIdsSorted();
  ids = ids.filter(id=>/head/i.test(state.tables[id].title||''))
       .concat(ids.filter(id=>!/head/i.test(state.tables[id].title||'')));

  ids.forEach(id=>{
    const t = state.tables[id];
    const counts = {Beef:0,Chicken:0,Lamb:0,Fish:0,Veg:0,Kids:0};
    const notes = [];
    (t.seats||[]).forEach(n=>{
      const g = guestByName(n);
      const col = MEAL_TO_VENUE[g.meal];
      if(col) counts[col]++;
      if(g.diet && !notes.includes(g.diet)) notes.push(g.diet);
    });
    const total = (t.seats||[]).length;
    grand += total;
    cols.forEach(c=>totals[c]+=counts[c]);
    const label = binned[id] ? 'UNPLACED' : (/head/i.test(t.title||'') ? 'Head Table' : tableNumber(id));
    const comment = [(t.title||''), notes.join(' | ')].filter(Boolean).join(' — ');
    rows.push([label, ...cols.map(c=>counts[c]||''), total, comment]);
  });

  // anyone not seated yet, so the venue sheet never silently under-counts
  const unassigned = computeUnassigned();
  if(unassigned.length){
    const counts = {Beef:0,Chicken:0,Lamb:0,Fish:0,Veg:0,Kids:0};
    unassigned.forEach(n=>{
      const col = MEAL_TO_VENUE[guestByName(n).meal];
      if(col) counts[col]++;
    });
    cols.forEach(c=>totals[c]+=counts[c]);
    grand += unassigned.length;
    rows.push(['NOT YET SEATED', ...cols.map(c=>counts[c]||''), unassigned.length, 'Assign before sending!']);
  }

  rows.push(['TOTALS', ...cols.map(c=>totals[c]), grand, '']);

  const wsx = XLSX.utils.aoa_to_sheet(rows);
  wsx['!cols'] = [{wch:22},{wch:7},{wch:9},{wch:7},{wch:7},{wch:6},{wch:6},{wch:7},{wch:60}];
  const wbx = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbx, wsx, 'Meal Counts');
  XLSX.writeFile(wbx, 'Christal_Yesudasan_Meal_Counts.xlsx');
}

/* ---------------- guest list exports ---------------- */
function downloadGuestLists(){
  // sheet 1: all guests alphabetically (by last name) with meal + table number
  const byName = rosterGuests().slice().sort((a,b)=>{
    const ka = normName(a.name).split(' ').slice(-1)[0] + ' ' + normName(a.name);
    const kb = normName(b.name).split(' ').slice(-1)[0] + ' ' + normName(b.name);
    return ka.localeCompare(kb);
  });
  const rows1 = [['Guest','Meal','Table #','Table Name']];
  byName.forEach(g=>{
    const tid = findTableOf(g.name);
    rows1.push([
      g.name,
      g.meal || '',
      tid ? (binned[tid] ? '—' : (/head/i.test(state.tables[tid].title||'') ? 'Head' : tableNumber(tid))) : '—',
      tid ? (state.tables[tid].title || '') : 'Unassigned'
    ]);
  });

  // sheet 2: by table number, each guest with meal
  const rows2 = [['Table #','Table Name','Guest','Meal']];
  tableIdsSorted().forEach(id=>{
    const t = state.tables[id];
    const num = /head/i.test(t.title||'') ? 'Head' : tableNumber(id);
    (t.seats||[]).slice().sort((a,b)=>normName(a).localeCompare(normName(b))).forEach(n=>{
      rows2.push([num, t.title || '', n, guestByName(n).meal || '']);
    });
    rows2.push(['','','','']);
  });
  const unassigned = computeUnassigned();
  unassigned.slice().sort((a,b)=>normName(a).localeCompare(normName(b))).forEach(n=>{
    rows2.push(['—','Unassigned', n, guestByName(n).meal || '']);
  });

  const wbx = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet(rows1);
  ws1['!cols'] = [{wch:30},{wch:10},{wch:8},{wch:22}];
  const ws2 = XLSX.utils.aoa_to_sheet(rows2);
  ws2['!cols'] = [{wch:8},{wch:22},{wch:30},{wch:10}];
  XLSX.utils.book_append_sheet(wbx, ws1, 'Guests A-Z');
  XLSX.utils.book_append_sheet(wbx, ws2, 'By Table');
  XLSX.writeFile(wbx, 'Seating_Guest_Lists.xlsx');
}

/* ---------------- import old single-device layout ---------------- */
function wireImportModal(){
  const modal = document.getElementById('import-modal');
  document.getElementById('import-btn').addEventListener('click', ()=>{
    modal.classList.remove('hidden');
  });
  document.getElementById('import-cancel').addEventListener('click', ()=>{
    modal.classList.add('hidden');
  });
  document.getElementById('import-confirm').addEventListener('click', ()=>{
    const raw = document.getElementById('import-text').value.trim();
    if(!raw) return;
    if(Object.keys(state.tables).length > 0){
      if(!confirm('The board already has tables on it. Importing will ADD these on top rather than replace anything. Continue?')) return;
    }
    let parsed;
    try{ parsed = JSON.parse(raw); }
    catch(e){ alert("That didn't look like valid JSON. Copy it exactly from the browser console."); return; }

    const updates = {};
    if(parsed.seatSize) updates['seatingChart/seatSize'] = parsed.seatSize;
    const oldTables = Array.isArray(parsed.tables) ? parsed.tables : [];
    oldTables.forEach((t, i)=>{
      const id = 'table-import-' + Date.now() + '-' + i;
      updates['seatingChart/tables/' + id] = {
        title: t.title || ('Table ' + (i+1)),
        seats: t.seats || [],
        order: Date.now() + i
      };
    });
    db.ref().update(updates).then(()=>{
      modal.classList.add('hidden');
      document.getElementById('import-text').value = '';
      logActivity('<b>' + myName + '</b> imported ' + oldTables.length + ' table(s) from an old layout');
    });
  });
}
