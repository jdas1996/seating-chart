/* Venue floor plan — the real room, traced from the venue's Room Viewer PDF.
   Ported from the reception-plan app (christal-yesudasan-reception.web.app) so
   both tools draw the same room from the same numbers.

   No Firebase and no app state in here: draw() takes a plain array of tables
   and hands positions back through callbacks. That keeps this file swappable
   if the seating data ever moves to a different backend.

   Coordinates are SVG user units, ~4.66 per foot. The scale came from a flat
   raster PDF with no printed dimensions, so it is good enough to plan with but
   not survey-grade — confirm anything load-bearing with the venue. */
(function(){
'use strict';

var SVGNS = 'http://www.w3.org/2000/svg';
var UPF = 4.66;                        // svg units per foot
var VIEWBOX = '8 300 1090 372';

/* Room outline as vertices rather than a path string — same list the other
   app's layout solver uses, so the walls can't drift between the two. */
var HALL = [
  [20,317],[952,317],[952,655],[655,655],[610,605],[578,645],[545,605],
  [188,605],[158,648],[116,605],[60,657],[20,657]
];
var hallPath = function(pts){ return 'M' + pts.map(function(p){return p.join(',');}).join(' L') + ' Z'; };
var FOYER = 'M955,330 L1079,330 L1079,640 L955,640 Z';

/* Things that genuinely cannot move: the four bars, the structural columns and
   the service alcove. The couple's rule was "the things that can't move are
   the Bars" — these carry no pointer handlers at all. */
var LOCKED = [
  {t:'rect',x:20,y:327,w:90,h:29,label:'South Ballroom BAR'},
  {t:'rect',x:132,y:327,w:78,h:29,label:'South Center BAR'},
  {t:'rect',x:539,y:327,w:81,h:29,label:'North Center BAR'},
  {t:'rect',x:647,y:327,w:76,h:29,label:'North Ballroom BAR'},
  {t:'rect',x:270,y:324,w:40,h:11,label:''},{t:'rect',x:270,y:345,w:40,h:11,label:''},
  {t:'rect',x:299,y:324,w:11,h:32,label:''},{t:'rect',x:620,y:320,w:27,h:42,label:''},
  {t:'col',x:119,y:549},{t:'col',x:361,y:549},{t:'col',x:646,y:549},{t:'col',x:843,y:549}
];

/* Default round-table positions from the venue diagram — used to seed a table
   that has never been placed. 43 of them; the couple delete down from there. */
var R_TABLES = [[413,342],[463,342],[804,340],[856,340],[907,340],[404,391],[451,390],[500,391],
 [776,388],[827,388],[879,390],[930,423],[823,443],[882,451],[930,483],[823,496],[881,510],[930,538],
 [400,543],[454,544],[505,543],[557,544],[605,543],[706,548],[760,548],[810,548],[886,584],[268,559],
 [221,580],[318,582],[400,587],[457,587],[505,587],[555,587],[606,588],[667,592],[719,592],[776,592],
 [833,592],[702,640],[756,640],[805,640],[851,640]];

var COCKTAILS = [[239,396],[344,395],[257,472],[181,489],[1033,445],[1033,515]];

/* Context furniture. Drawn fixed and inert — none of it seats guests, so it is
   scenery here even though the floor-plan app lets you drag it. The sweetheart
   table is deliberately NOT in this list: it exists as a real table in the
   seating data, so it gets drawn as a live table instead. */
var FURN = [
  {kind:'round',x:683,y:465,r:14,label:'Cake'},
  {kind:'rect',x:596,y:383,w:24,h:13,label:'D.J.'},
  {kind:'rect',x:938,y:333,w:12,h:38,label:'Gifts',rot:-90},
  {kind:'rect',x:207,y:614,w:82,h:9,label:'Welcome / Memorial / Guest Book',below:true},
  {kind:'rect',x:118,y:432,w:13,h:33,label:'Photo Booth',rot:-90},
  {kind:'rect',x:160,y:658,w:44,h:8,label:'Seating Chart',below:true}
];

/* Where a table titled "Sweetheart …" gets seeded, and how big. */
var SWEET_POS = {x:970, y:474, r:11};

/* ---------------- svg helpers ---------------- */
function el(tag, attrs, parent){
  var n = document.createElementNS(SVGNS, tag);
  for(var k in attrs) n.setAttribute(k, attrs[k]);
  if(parent) parent.appendChild(n);
  return n;
}
function txt(x, y, s, cls, rot, parent){
  var t = el('text', {x:x, y:y, 'class':cls || 'fp-lbl'}, parent);
  if(rot) t.setAttribute('transform', 'rotate(' + rot + ' ' + x + ' ' + y + ')');
  t.textContent = s;
  return t;
}

function clip(s, n){
  s = String(s);
  return s.length > n ? s.slice(0, n - 1).replace(/[\s/-]+$/, '') + '…' : s;
}

/* Door symbol: hinge, the closed leaf along the wall, and the leaf swung into
   the room — leaf line plus swing arc, the standard architectural mark. */
function door(g, hx, hy, ax, ay, bx, by, sweep){
  var r = Math.hypot(bx - hx, by - hy);
  el('path', {d:'M' + hx + ',' + hy + ' L' + bx + ',' + by, 'class':'fp-door-leaf'}, g);
  el('path', {d:'M' + bx + ',' + by + ' A' + r + ',' + r + ' 0 0 ' + sweep + ' ' + ax + ',' + ay,
              'class':'fp-door-arc'}, g);
}

/* ---------------- the static room ---------------- */
/* Drawn once into its own <g>. Nothing in here responds to pointers, so a
   table can never be hidden behind a wall you accidentally grabbed. */
function buildShell(gRoom, gFixed){
  var hall = hallPath(HALL);
  el('path', {d:hall,  'class':'fp-roomfill'}, gRoom);
  el('path', {d:FOYER, 'class':'fp-foyerfill'}, gRoom);
  el('path', {d:hall,  'class':'fp-wall'}, gRoom);
  el('path', {d:FOYER, 'class':'fp-wall'}, gRoom);
  el('line', {x1:20, y1:414, x2:952, y2:414, 'class':'fp-divider'}, gRoom);
  el('line', {x1:20, y1:519, x2:952, y2:519, 'class':'fp-divider'}, gRoom);
  el('line', {x1:116, y1:317, x2:116, y2:605, 'class':'fp-wall'}, gRoom);
  el('line', {x1:608, y1:356, x2:608, y2:605, 'class':'fp-divider'}, gRoom);
  el('line', {x1:20, y1:317, x2:116, y2:414, 'class':'fp-wall-thin'}, gRoom);
  el('line', {x1:20, y1:520, x2:116, y2:616, 'class':'fp-wall-thin'}, gRoom);

  // pipe-and-drape opening, drawn as a zigzag the way the venue shows it
  var d = 'M376,317';
  for(var y = 320; y <= 605; y += 8) d += ' L' + (376 + (y % 16 === 0 ? 3.5 : -3.5)) + ',' + y;
  el('path', {d:d, fill:'none', stroke:'#8f8879', 'stroke-width':1.1}, gRoom);
  txt(371, 470, 'PIPE & DRAPE OPENING', 'fp-lbl-sm', -90, gRoom);

  el('rect', {x:376, y:414, width:477, height:105, fill:'#faf7ef', stroke:'#cdc6b6',
              'stroke-width':1, 'stroke-dasharray':'7 5'}, gRoom);
  txt(500, 466, 'OPEN FLOOR / DANCE', 'fp-zone', 0, gRoom);
  txt(250, 309, 'COCKTAIL HOUR ROOM', 'fp-zone', 0, gRoom);
  txt(700, 309, 'RECEPTION ROOMS', 'fp-zone', 0, gRoom);
  txt(1017, 352, 'PRE-FUNCTION', 'fp-zone', 0, gRoom);
  txt(345, 601, 'ENTRANCE →', 'fp-lbl-sm', 0, gRoom);

  LOCKED.forEach(function(o){
    if(o.t === 'col'){
      el('rect', {x:o.x - 4, y:o.y - 4, width:8, height:8, 'class':'fp-furn fp-fixed'}, gFixed);
      el('path', {d:'M' + (o.x-4) + ',' + (o.y-4) + ' L' + (o.x+4) + ',' + (o.y+4) +
                     ' M' + (o.x+4) + ',' + (o.y-4) + ' L' + (o.x-4) + ',' + (o.y+4),
                  fill:'none', stroke:'#8b8478', 'stroke-width':.8}, gFixed);
    } else {
      el('rect', {x:o.x, y:o.y, width:o.w, height:o.h, 'class':'fp-furn fp-fixed'}, gFixed);
      if(o.label) txt(o.x + o.w/2, o.y + o.h/2, o.label, 'fp-lbl-sm', 0, gFixed);
    }
  });
  txt(290, 364, 'Satellite Bar', 'fp-lbl-sm', 0, gFixed);

  // stairs, as nested treads
  for(var i = 0; i < 6; i++)
    el('path', {d:'M' + (896 + i*4) + ',656 A ' + (54 - i*7) + ' ' + (54 - i*7) +
                   ' 0 0 0 950,' + (602 + i*7), fill:'none', stroke:'#8b8478', 'stroke-width':.9}, gFixed);
  txt(922, 650, 'STAIRS', 'fp-lbl-sm', 0, gFixed);

  var W = 15;
  [242, 493, 743].forEach(function(x){ door(gFixed, x, 317, x + W, 317, x, 317 + W, 0); });
  [[344,1],[401,-1],[545,1],[610,-1]].forEach(function(p){
    door(gFixed, p[0], 605, p[0] + p[1]*W, 605, p[0], 605 - W, p[1] > 0 ? 1 : 0);
  });
  door(gFixed, 116, 605, 131, 605, 116, 590, 1);
  door(gFixed, 188, 605, 173, 605, 188, 590, 0);

  COCKTAILS.forEach(function(p){
    el('circle', {cx:p[0], cy:p[1], r:8, 'class':'fp-cock'}, gFixed);
  });
}
/* Furniture is drawn per-frame in draw() now, so the DJ, gifts, cake and the
   welcome/photo/seating-chart tables can be dragged and their moved positions
   synced — they were scenery before. */

/* ---------------- numbering ---------------- */
/* Rows are found by clustering on y, not by banding to a fixed grid: a table
   joins the row being built while it stays within ROW_TOL of that row's
   running mean y, otherwise it opens the next one. Banding split tables that
   sat a couple of units either side of a boundary. One series for the whole
   room, left to right, top to bottom. Returns [{id,label}]. */
var ROW_TOL = 18;                      // ~4 ft at UPF 4.66
function renumber(tables){
  if(!tables.length) return [];
  var rows = [], cur = [], sum = 0;
  tables.slice().sort(function(a,b){ return a.y - b.y; }).forEach(function(t){
    if(cur.length && Math.abs(t.y - sum/cur.length) > ROW_TOL){ rows.push(cur); cur = []; sum = 0; }
    cur.push(t); sum += t.y;
  });
  if(cur.length) rows.push(cur);
  var out = [], n = 1;
  rows.forEach(function(r){
    r.sort(function(a,b){ return a.x - b.x; }).forEach(function(t){
      out.push({id:t.id, label:String(n++)});
    });
  });
  return out;
}

/* Two round tables whose edges come within ~3 ft, and any two sharing a
   number. Both wear the same amber — each means "look at this before the
   place cards are printed". */
function issues(tables){
  var clash = {}, dup = {}, seen = {};
  for(var i = 0; i < tables.length; i++){
    for(var j = i + 1; j < tables.length; j++){
      var a = tables[i], b = tables[j];
      if(Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + 3 * UPF){ clash[a.id] = 1; clash[b.id] = 1; }
    }
  }
  tables.forEach(function(t){
    var k = String(t.label || '').trim();
    if(!k) return;
    if(seen[k]){ dup[seen[k]] = 1; dup[t.id] = 1; } else seen[k] = t.id;
  });
  return {clash:clash, dup:dup, nClash:Object.keys(clash).length, nDup:Object.keys(dup).length};
}

/* Seed positions for tables that have never been placed. Anything titled
   "Sweetheart…" goes to the sweetheart spot; everything else takes the next
   free slot from the venue diagram, in the order given. */
function seedPositions(tables, taken){
  var used = {};
  (taken || []).forEach(function(k){ used[k] = 1; });
  var next = 0, out = [];
  tables.forEach(function(t){
    if(/^sweetheart/i.test(t.title || '')){
      out.push({id:t.id, x:SWEET_POS.x, y:SWEET_POS.y});
      return;
    }
    while(next < R_TABLES.length && used[next]) next++;
    var p = R_TABLES[next] || [120 + (next % 8) * 40, 330 + Math.floor(next / 8) * 40];
    used[next] = 1;
    out.push({id:t.id, x:p[0], y:p[1]});
  });
  return out;
}

/* ---------------- the live tables ---------------- */
/* opts: {svg, tables:[{id,title,x,y,r,count,cap,label,hit}], onMove, onDropGuest,
          onPickUp, searchHit:{id:true}} */
function draw(opts){
  var svg = opts.svg;
  var gRoom = svg.querySelector('.fp-room'), gFixed = svg.querySelector('.fp-fixedg'),
      gItems = svg.querySelector('.fp-items');

  if(!gRoom){
    svg.setAttribute('viewBox', VIEWBOX);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    gRoom  = el('g', {'class':'fp-room'}, svg);
    gFixed = el('g', {'class':'fp-fixedg'}, svg);
    gItems = el('g', {'class':'fp-items'}, svg);
    buildShell(gRoom, gFixed);
  }
  gItems.textContent = '';

  /* Movable furniture (DJ, gifts, cake, welcome, photo booth, seating chart).
     Position overrides come from opts.furniturePos {id:{x,y}}; drags report
     through opts.onMoveFurn(id,x,y). Locked layouts get no drag wiring. */
  FURN.forEach(function(f){
    var pos = (opts.furniturePos || {})[f.id] || f;
    var g = el('g', {'class':'fp-furni', 'data-furn':f.id}, gItems);
    if(f.kind === 'round'){
      el('circle', {cx:pos.x, cy:pos.y, r:f.r, 'class':'fp-furn'}, g);
      txt(pos.x, pos.y, f.label, 'fp-lbl-sm', 0, g);
      el('circle', {cx:pos.x, cy:pos.y, r:f.r + 4, 'class':'fp-hitarea'}, g);
    } else {
      el('rect', {x:pos.x, y:pos.y, width:f.w, height:f.h, 'class':'fp-furn'}, g);
      var wide = f.below || (f.label.length * 3.4 > f.w && !f.rot);
      txt(pos.x + f.w/2, wide ? (pos.y + f.h + 6) : (pos.y + f.h/2), f.label, 'fp-lbl-sm', f.rot || 0, g);
      el('rect', {x:pos.x - 4, y:pos.y - 4, width:f.w + 8, height:f.h + 8, 'class':'fp-hitarea'}, g);
    }
    if(!opts.locked && opts.onMoveFurn) wireFurn(svg, g, f, pos, opts);
  });

  /* Empty numbered spots (assign view). Dashed circles, drop targets only. */
  (opts.slots || []).forEach(function(s){
    var g = el('g', {'class':'fp-slot', 'data-slot':s.i}, gItems);
    el('circle', {cx:s.x, cy:s.y, r:14, 'class':'fp-slot-c'}, g);
    txt(s.x, s.y + 3, s.label, 'fp-slot-n', 0, g);
    g.addEventListener('dragover', function(e){ e.preventDefault(); g.classList.add('fp-dropping'); });
    g.addEventListener('dragleave', function(){ g.classList.remove('fp-dropping'); });
    g.addEventListener('drop', function(e){
      e.preventDefault();
      g.classList.remove('fp-dropping');
      if(opts.onDropGroup) opts.onDropGroup(s.i);
    });
    g.addEventListener('click', function(){
      if(opts.onSlotClick) opts.onSlotClick(s.i);
    });
  });

  var flags = issues(opts.tables);

  opts.tables.forEach(function(t){
    var cls = 'fp-item';
    if(flags.clash[t.id] || flags.dup[t.id]) cls += ' fp-warn';
    if(opts.searchHit && opts.searchHit[t.id]) cls += ' fp-hit';
    var g = el('g', {'class':cls, 'data-id':t.id}, gItems);

    el('circle', {cx:t.x, cy:t.y, r:t.r, 'class':'fp-tbl'}, g);
    txt(t.x, t.y - 3, t.label, 'fp-num', 0, g);
    txt(t.x, t.y + 6, t.count + '/' + t.cap, 'fp-seats', 0, g);
    /* Titles are group names ("Tamil Aunty/Uncle #3"), not "Table 12", and at
       this spacing a full one runs into its neighbours. Clip to what fits
       between two tables — the number is the identifier, the title is a hint,
       and the list view has the whole thing. */
    if(t.title) txt(t.x, t.y + t.r + 5, clip(t.title, 13), 'fp-title', 0, g);

    // fill badge, same three states the other app uses
    var badge = t.count > t.cap ? 'over' : (t.count && t.count < 6 ? 'under' : 'fill');
    el('circle', {cx:t.x + t.r - 2, cy:t.y - t.r + 2, r:5.2, 'class':'fp-badge fp-' + badge}, g);
    txt(t.x + t.r - 2, t.y - t.r + 2, String(t.count), 'fp-badge-t', 0, g);

    // generous invisible hit area, so a table is easy to grab on a phone
    var hit = el('circle', {cx:t.x, cy:t.y, r:t.r + 4, 'class':'fp-hitarea'}, g);
    wireTable(svg, g, hit, t, opts);
  });

  return flags;
}

function wireFurn(svg, g, f, pos, opts){
  var hit = g.querySelector('.fp-hitarea');
  hit.addEventListener('pointerdown', function(e){
    if(opts.guestDragActive && opts.guestDragActive()) return;
    e.preventDefault();
    hit.setPointerCapture(e.pointerId);
    if(opts.onDragState) opts.onDragState(true);
    var start = toUser(svg, e.clientX, e.clientY);
    var ox = pos.x, oy = pos.y, moved = false;
    function move(ev){
      var p = toUser(svg, ev.clientX, ev.clientY);
      var nx = ox + (p.x - start.x), ny = oy + (p.y - start.y);
      if(Math.abs(p.x - start.x) + Math.abs(p.y - start.y) > 1.5) moved = true;
      g.setAttribute('transform', 'translate(' + (nx - pos.x) + ',' + (ny - pos.y) + ')');
      g._nx = nx; g._ny = ny;
    }
    function up(){
      hit.removeEventListener('pointermove', move);
      hit.removeEventListener('pointerup', up);
      hit.removeEventListener('pointercancel', up);
      if(opts.onDragState) opts.onDragState(false);
      if(moved) opts.onMoveFurn(f.id, Math.round(g._nx * 10)/10, Math.round(g._ny * 10)/10);
    }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerup', up);
    hit.addEventListener('pointercancel', up);
  });
}

/* Screen pixels -> SVG user units. Has to go through the live CTM because the
   plan scales to whatever width the panel happens to be. */
function toUser(svg, clientX, clientY){
  var pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function wireTable(svg, g, hit, t, opts){
  /* Dragging a table uses pointer events; dropping a guest card on one uses
     HTML5 drag-and-drop, because that is what the guest cards already speak.
     The two never overlap — a guest drag sets dragGuestName, and we bail out
     of the pointer path while one is in flight. */
  hit.addEventListener('pointerdown', function(e){
    if(opts.locked){ if(opts.onSelect) opts.onSelect(t.id); return; }
    if(opts.guestDragActive && opts.guestDragActive()) return;
    e.preventDefault();
    hit.setPointerCapture(e.pointerId);
    if(opts.onDragState) opts.onDragState(true);
    var start = toUser(svg, e.clientX, e.clientY);
    var ox = t.x, oy = t.y, moved = false;
    if(opts.onPickUp) opts.onPickUp(t.id);
    g.classList.add('fp-dragging');

    function move(ev){
      var p = toUser(svg, ev.clientX, ev.clientY);
      var nx = ox + (p.x - start.x), ny = oy + (p.y - start.y);
      if(Math.abs(p.x - start.x) + Math.abs(p.y - start.y) > 1.5) moved = true;
      g.setAttribute('transform', 'translate(' + (nx - t.x) + ',' + (ny - t.y) + ')');
      g._nx = nx; g._ny = ny;
    }
    function up(){
      hit.removeEventListener('pointermove', move);
      hit.removeEventListener('pointerup', up);
      hit.removeEventListener('pointercancel', up);
      g.classList.remove('fp-dragging');
      if(opts.onDragState) opts.onDragState(false);
      if(moved && opts.onMove) opts.onMove(t.id, Math.round(g._nx * 10)/10, Math.round(g._ny * 10)/10);
      else if(!moved && opts.onSelect) opts.onSelect(t.id);
    }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerup', up);
    hit.addEventListener('pointercancel', up);
  });

  g.addEventListener('dragover', function(e){ e.preventDefault(); g.classList.add('fp-dropping'); });
  g.addEventListener('dragleave', function(){ g.classList.remove('fp-dropping'); });
  g.addEventListener('drop', function(e){
    e.preventDefault();
    g.classList.remove('fp-dropping');
    if(opts.onDropGuest) opts.onDropGuest(t.id);
  });
}

window.FloorPlan = {
  UPF: UPF,
  R_TABLES: R_TABLES,
  SWEET_POS: SWEET_POS,
  draw: draw,
  renumber: renumber,
  issues: issues,
  seedPositions: seedPositions
};
})();
