/* Guest-facing "find your table" page.
   READ-ONLY BY CONSTRUCTION: this file contains no set/update/push/remove
   calls — it only listens to the `published` snapshot the couple pushes from
   the planning app. No login, no links to the planner. */
(function(){
'use strict';

var PAGE_URL = 'https://jdas1996.github.io/seating-chart/';
var pub = null;          // the published snapshot
var current = null;      // { name, table }

firebase.initializeApp(firebaseConfig);
firebase.database().ref('published').on('value', function(snap){
  pub = snap.val();
  document.getElementById('loading').textContent = pub
    ? '' : 'The seating chart hasn’t been published yet — check back soon!';
  search();
});

var strip = function(n){ return n.replace(/^(Mr|Mrs|Ms|Dr|Rev|Pastor)\.\s+/, ''); };

function allNames(){
  var out = [];
  (pub && pub.tables || []).forEach(function(t){
    (t.seats || []).forEach(function(n){ out.push({ name: n, table: t }); });
  });
  return out;
}

function search(){
  var q = document.getElementById('q').value.trim().toLowerCase();
  var box = document.getElementById('matches');
  box.textContent = '';
  if(!pub || q.length < 2) return;
  allNames()
    .filter(function(e){ return strip(e.name).toLowerCase().indexOf(q) >= 0; })
    .sort(function(a, b){ return strip(a.name).localeCompare(strip(b.name)); })
    .slice(0, 12)
    .forEach(function(e){
      var d = document.createElement('div');
      d.className = 'match';
      d.textContent = strip(e.name);
      d.onclick = function(){ show(e); };
      box.appendChild(d);
    });
  if(!box.children.length){
    var d = document.createElement('div');
    d.className = 'loading';
    d.textContent = 'No name matches “' + q + '” — try just your first or last name.';
    box.appendChild(d);
  }
}
document.getElementById('q').addEventListener('input', search);

function numLabel(t){
  return String(t.n).toUpperCase() === 'SH' ? 'Sweetheart Table' : t.n;
}

function show(e){
  current = e;
  var t = e.table;
  document.getElementById('searcher').style.display = 'none';
  document.getElementById('result').style.display = 'block';
  document.getElementById('r-name').textContent = strip(e.name);
  var sweet = String(t.n).toUpperCase() === 'SH';
  document.getElementById('r-label').textContent = sweet ? 'You’re at the' : 'You’re at table';
  document.getElementById('r-num').textContent = numLabel(t);

  var mates = document.getElementById('mates');
  mates.textContent = '';
  var lastKey = function(n){ var p = strip(n).split(/\s+/); return (p[p.length-1] + ' ' + p.join(' ')).toLowerCase(); };
  (t.seats || []).slice().sort(function(a, b){ return lastKey(a).localeCompare(lastKey(b)); })
    .forEach(function(n){
      var row = document.createElement('div');
      if(n === e.name){ var b = document.createElement('b'); b.textContent = strip(n) + ' (you)'; row.appendChild(b); }
      else row.textContent = strip(n);
      mates.appendChild(row);
    });

  var diets = document.getElementById('diets');
  if(t.diets && t.diets.length){
    diets.style.display = 'block';
    diets.textContent = 'Dietary notes at this table: ' + t.diets.join(' · ');
  } else diets.style.display = 'none';

  drawMap(t);
  document.getElementById('status').textContent = '';
}

document.getElementById('back').onclick = function(){
  document.getElementById('result').style.display = 'none';
  document.getElementById('searcher').style.display = 'block';
  document.getElementById('q').focus();
};

/* ---- map: full room, dimmed, target table spotlighted ---- */
function drawMap(target){
  var svg = document.getElementById('fp-svg');
  var tables = (pub.tables || []).map(function(t){
    return { id: 'n' + t.n, title: '', x: t.x, y: t.y,
             r: String(t.n).toUpperCase() === 'SH' ? 11 : 14,
             count: 0, cap: 0, label: String(t.n) };
  });
  FloorPlan.draw({ svg: svg, tables: tables, locked: true });
  var gItems = svg.querySelector('.fp-items');
  // dark veil over everything drawn so far…
  var SVGNS = 'http://www.w3.org/2000/svg';
  var veil = document.createElementNS(SVGNS, 'rect');
  veil.setAttribute('x', 8); veil.setAttribute('y', 300);
  veil.setAttribute('width', 1090); veil.setAttribute('height', 372);
  veil.setAttribute('class', 'gp-dim');
  gItems.appendChild(veil);
  // …then lift the target table above the veil with a ring
  var g = gItems.querySelector('g.fp-item[data-id="n' + target.n + '"]');
  if(g){
    g.setAttribute('class', 'fp-item gp-target');
    var ring = document.createElementNS(SVGNS, 'circle');
    ring.setAttribute('cx', target.x); ring.setAttribute('cy', target.y);
    ring.setAttribute('r', (String(target.n).toUpperCase() === 'SH' ? 11 : 14) + 7);
    ring.setAttribute('class', 'gp-ring');
    gItems.appendChild(ring);
    gItems.appendChild(g);
  }
}

/* ---- share card ---- */
function drawCard(){
  var t = current.table;
  var cv = document.createElement('canvas');
  cv.width = 1080; cv.height = 1350;
  var c = cv.getContext('2d');
  c.fillStyle = '#faf6ef'; c.fillRect(0, 0, 1080, 1350);
  c.strokeStyle = '#b8965a'; c.lineWidth = 6;
  c.strokeRect(40, 40, 1000, 1270);
  c.textAlign = 'center'; c.fillStyle = '#3d3830';
  c.font = '400 58px Georgia'; c.fillText('The Yesudasans', 540, 170);
  c.font = '400 30px Georgia'; c.fillStyle = '#8a8272';
  c.fillText('R E C E P T I O N   ·   A U G U S T   2 2,   2 0 2 6', 540, 225);
  c.fillStyle = '#3d3830'; c.font = '400 44px Georgia';
  c.fillText(strip(current.name), 540, 340);
  c.fillStyle = '#8a8272'; c.font = '400 30px Georgia';
  var sweet = String(t.n).toUpperCase() === 'SH';
  c.fillText(sweet ? 'is at the' : 'is at table', 540, 395);
  c.fillStyle = '#b8965a';
  if(sweet){ c.font = '700 90px Georgia'; c.fillText('Sweetheart', 540, 520); c.fillText('Table', 540, 620); }
  else { c.font = '700 260px Georgia'; c.fillText(String(t.n), 540, 640); }
  c.fillStyle = '#8a8272'; c.font = '400 26px Georgia';
  c.fillText('S I T T I N G   W I T H', 540, 740);
  c.fillStyle = '#3d3830'; c.font = '400 32px Georgia';
  var lastKey2 = function(n){ var p = strip(n).split(/\s+/); return (p[p.length-1] + ' ' + p.join(' ')).toLowerCase(); };
  var mates = (t.seats || []).filter(function(n){ return n !== current.name; })
    .sort(function(a, b){ return lastKey2(a).localeCompare(lastKey2(b)); }).map(strip);
  var step = mates.length > 10 ? 38 : 44;
  if(mates.length > 10) c.font = '400 28px Georgia';
  mates.slice(0, 11).forEach(function(ln, ix){ c.fillText(ln, 540, 795 + ix * step); });
  if(t.diets && t.diets.length){
    c.fillStyle = '#8a5c2e'; c.font = '400 24px Georgia';
    c.fillText('Dietary notes at this table: ' + t.diets.join(' · ').slice(0, 70), 540, 1215);
  }
  c.fillStyle = '#8a8272'; c.font = '400 26px Georgia';
  c.fillText('Find yours:  ' + PAGE_URL.replace('https://', ''), 540, 1275);
  return cv;
}

function shareText(){
  var t = current.table;
  return strip(current.name) + ' is at ' +
    (String(t.n).toUpperCase() === 'SH' ? 'the Sweetheart Table' : 'table ' + t.n) +
    ' — sitting with ' +
    (t.seats || []).filter(function(n){ return n !== current.name; }).map(strip).join(', ') +
    '. Find your table: ' + PAGE_URL;
}

document.getElementById('share').onclick = function(){
  var status = document.getElementById('status');
  drawCard().toBlob(function(blob){
    var file = new File([blob], 'my-table.png', { type: 'image/png' });
    if(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })){
      navigator.share({ files: [file], text: shareText() })
        .then(function(){ status.textContent = 'Shared!'; })
        .catch(function(){ status.textContent = ''; });
    } else {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'my-table.png';
      a.click();
      URL.revokeObjectURL(a.href);
      if(navigator.clipboard) navigator.clipboard.writeText(shareText()).catch(function(){});
      status.textContent = 'Image downloaded — the text and link are on your clipboard.';
    }
  }, 'image/png');
};

document.getElementById('copy').onclick = function(){
  var status = document.getElementById('status');
  if(navigator.clipboard){
    navigator.clipboard.writeText(shareText())
      .then(function(){ status.textContent = 'Copied — paste it into a text.'; });
  }
};
})();
