/* ===========================================================
   Reception Seating Chart — collaborative, realtime
   Backed by Firebase Realtime Database.
   =========================================================== */

const COLORS = ['#b8965a','#7a8c6c','#a05c5c','#5c7a9c','#9c6ca0','#c48a4a','#5c8c8a'];

let db, presenceRef, connectedRef;
let clientId, myName, myColor;
let state = { seatSize: 10, tables: {} };
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
function initRealtime(){
  const chartRef = db.ref('seatingChart');
  chartRef.on('value', snap=>{
    const val = snap.val() || {};
    state.seatSize = val.seatSize || 10;
    state.tables = val.tables || {};
    document.getElementById('seat-size').value = state.seatSize;
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

  db.ref('activity').limitToLast(30).on('value', snap=>{
    const val = snap.val() || {};
    const items = Object.values(val).sort((a,b)=> (b.ts||0) - (a.ts||0));
    renderActivity(items);
  });

  wireToolbar();
  wirePoolDrop();
  wireImportModal();
}

function logActivity(text){
  db.ref('activity').push({ text, ts: firebase.database.ServerValue.TIMESTAMP });
}

/* ---------------- data helpers ---------------- */
function guestByName(name){
  return GUESTS.find(g=>g.name===name) || {name, meal:''};
}

function tableIdsSorted(){
  return Object.keys(state.tables).sort((a,b)=>{
    const oa = state.tables[a].order || 0;
    const ob = state.tables[b].order || 0;
    return oa - ob;
  });
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
  return GUESTS.map(g=>g.name).filter(n=>!seated.has(n));
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
  const unassigned = computeUnassigned();
  const poolNames = unassigned.filter(n=>n.toLowerCase().includes(search));
  if(poolNames.length===0){
    const hint = document.createElement('div');
    hint.className='empty-hint';
    hint.textContent = unassigned.length===0 ? 'Everyone is seated 🎉' : 'No matches';
    poolZone.appendChild(hint);
  }
  poolNames.forEach(name=>poolZone.appendChild(makeGuestEl(name)));
  document.getElementById('pool-count').textContent = unassigned.length + ' guest' + (unassigned.length===1?'':'s');

  // tables
  const wrap = document.getElementById('tables-wrap');
  wrap.innerHTML = '';
  tableIdsSorted().forEach(id=>{
    wrap.appendChild(makeTableEl(id, state.tables[id], search));
  });

  // stats
  const seatedCount = GUESTS.length - unassigned.length;
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

  if(g.meal){
    const tag = document.createElement('span');
    tag.className='meal-tag';
    tag.textContent = g.meal;
    el.appendChild(tag);
  }

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
  const visibleSeats = seats.filter(n=>n.toLowerCase().includes(search));
  if(seats.length===0){
    const hint = document.createElement('div');
    hint.className='empty-hint';
    hint.textContent='Drop guests here';
    zone.appendChild(hint);
  } else if(visibleSeats.length===0 && search){
    const hint = document.createElement('div');
    hint.className='empty-hint';
    hint.textContent='No matches at this table';
    zone.appendChild(hint);
  } else {
    visibleSeats.forEach(name=>zone.appendChild(makeGuestEl(name)));
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
