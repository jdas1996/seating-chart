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
let tableMap = {};         // physical positions of tables on the room map {id:{x,y}}
let mapMode = false;
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

  db.ref('activity').limitToLast(30).on('value', snap=>{
    const val = snap.val() || {};
    const items = Object.values(val).sort((a,b)=> (b.ts||0) - (a.ts||0));
    renderActivity(items);
  });

  wireToolbar();
  wirePoolDrop();
  wireImportModal();
  wireRsvpUpload();
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

function tableNumber(id){
  return tableIdsSorted().indexOf(id) + 1;
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
  const search = document.getElementById('search').value.trim().toLowerCase();

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
  wrap.classList.toggle('hidden', mapMode);
  mapView.classList.toggle('hidden', !mapMode);
  if(mapMode){
    renderMap(search);
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
  numBadge.textContent = tableNumber(id);
  head.appendChild(numBadge);

  const titleInput = document.createElement('input');
  titleInput.className='table-title';
  titleInput.value = table.title || 'Table';
  titleInput.addEventListener('change', ()=>{
    const newTitle = titleInput.value.trim() || table.title;
    db.ref('seatingChart/tables/' + id + '/title').set(newTitle);
    logActivity('<b>' + myName + '</b> renamed a table to "' + newTitle + '"');
  });

  const countBadge = document.createElement('div');
  countBadge.className='table-count';
  const cap = state.seatSize;
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
function renderMap(search){
  const canvas = document.getElementById('map-canvas');
  canvas.innerHTML = '';
  const ids = tableIdsSorted();
  ids.forEach((id, i)=>{
    const table = state.tables[id];
    const pos = tableMap[id] || { x: 0.08 + (i % 5) * 0.19, y: 0.08 + Math.floor(i / 5) * 0.24 };
    const el = document.createElement('div');
    el.className = 'map-table';
    el.style.left = (pos.x * 100) + '%';
    el.style.top  = (pos.y * 100) + '%';

    const count = (table.seats || []).length;
    const cap = state.seatSize;
    if(count === cap) el.classList.add('full');
    if(count > cap) el.classList.add('over');
    if(search && (table.seats || []).some(n=>n.toLowerCase().includes(search))) el.classList.add('search-hit');

    const num = document.createElement('div');
    num.className = 'map-table-num';
    num.textContent = tableNumber(id);
    const title = document.createElement('div');
    title.className = 'map-table-title';
    title.textContent = table.title || 'Table';
    const cnt = document.createElement('div');
    cnt.className = 'map-table-count';
    cnt.textContent = count + '/' + cap;
    el.appendChild(num);
    el.appendChild(title);
    el.appendChild(cnt);

    // reposition by dragging the circle (pointer events, works on touch too)
    el.addEventListener('pointerdown', e=>{
      if(dragGuestName) return;            // a guest card drag is in progress
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const rect = canvas.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      const origX = pos.x, origY = pos.y;
      let moved = false;
      const onMove = ev=>{
        const nx = Math.min(0.92, Math.max(0, origX + (ev.clientX - startX) / rect.width));
        const ny = Math.min(0.88, Math.max(0, origY + (ev.clientY - startY) / rect.height));
        if(Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 4) moved = true;
        el.style.left = (nx * 100) + '%';
        el.style.top  = (ny * 100) + '%';
        el._nx = nx; el._ny = ny;
      };
      const onUp = ()=>{
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        if(moved) db.ref('tableMap/' + id).set({ x: el._nx, y: el._ny });
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
    });

    // seat a guest by dropping their card on a map table
    el.addEventListener('dragover', e=>{ e.preventDefault(); el.classList.add('dragover'); });
    el.addEventListener('dragleave', ()=>el.classList.remove('dragover'));
    el.addEventListener('drop', e=>{
      e.preventDefault();
      el.classList.remove('dragover');
      if(!dragGuestName) return;
      moveGuestToTable(dragGuestName, id, table.title);
      dragGuestName = null;
    });

    canvas.appendChild(el);
  });
}

document.getElementById('map-toggle').addEventListener('click', ()=>{
  mapMode = !mapMode;
  document.getElementById('map-toggle').textContent = mapMode ? 'List view' : 'Map view';
  render();
});

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
      while(current.length < cap && pool.length>0){
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
    const label = /head/i.test(t.title||'') ? 'Head Table' : tableNumber(id);
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
