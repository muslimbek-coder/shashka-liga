const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const E = require('./public/engine.js');

const PORT = process.env.PORT || 3000;
const FILE = path.join(process.env.DATA_DIR || __dirname, 'data.json');
const MAXP = 16, MAXG = 8;
let state = { groups: {} }, pg = null, timer = null;

async function load() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pg = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === '0' ? false : { rejectUnauthorized: false } });
    await pg.query('create table if not exists kv(k text primary key, v jsonb)');
    const r = await pg.query("select v from kv where k='state'");
    if (r.rows[0]) state = r.rows[0].v;
  } else {
    try { state = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
  }
}
function save() {
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    try {
      if (pg) await pg.query("insert into kv(k,v) values('state',$1) on conflict(k) do update set v=$1", [JSON.stringify(state)]);
      else fs.writeFileSync(FILE, JSON.stringify(state));
    } catch (e) { console.error('save error', e.message); }
  }, 400);
}

const server = http.createServer((req, res) => {
  const f = req.url.split('?')[0] === '/engine.js' ? 'engine.js' : 'index.html';
  fs.readFile(path.join(__dirname, 'public', f), (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(d);
  });
});

const wss = new WebSocketServer({ server });
const G = g => state.groups[g] || (state.groups[g] = { players: {}, games: {} });
function push(g) {
  const s = JSON.stringify({ t: 'state', players: G(g).players, games: G(g).games });
  for (const c of wss.clients) if (c.g === g && c.readyState === 1) c.send(s);
}
const count = (grp, id) => Object.values(grp.games).filter(x => x.white === id || x.black === id).length;
const paired = (grp, a, b) => Object.values(grp.games).some(x => (x.white === a && x.black === b) || (x.white === b && x.black === a));

wss.on('connection', sock => {
  const send = o => sock.readyState === 1 && sock.send(JSON.stringify(o));
  const fail = msg => send({ t: 'error', msg });
  sock.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'join') {
      const g = String(m.g || '').trim().toLowerCase().replace(/[\/\s]+/g, '_').slice(0, 30);
      const n = String(m.n || '').trim().slice(0, 20);
      if (!g || !n) return fail('Guruh nomi va ismni kiriting');
      const id = n.toLowerCase(), grp = G(g);
      if (!grp.players[id]) {
        if (Object.keys(grp.players).length >= MAXP) return fail(`Guruhda ${MAXP} ta ishtirokchi to'lgan`);
        grp.players[id] = { name: n, created: Date.now() };
        save();
      }
      sock.g = g; sock.id = id;
      send({ t: 'joined' });
      return push(g);
    }
    if (!sock.g) return;
    const grp = G(sock.g);
    if (m.t === 'challenge') {
      const oid = String(m.oid);
      if (!grp.players[oid] || oid === sock.id) return fail('Ishtirokchi topilmadi');
      if (paired(grp, sock.id, oid)) return fail("Siz bu ishtirokchi bilan o'ynagansiz");
      if (count(grp, sock.id) >= MAXG || count(grp, oid) >= MAXG) return fail(`Har kim ${MAXG} ta o'yin o'ynaydi`);
      const w = Math.random() < 0.5, gid = Math.random().toString(36).slice(2, 10);
      grp.games[gid] = { white: w ? sock.id : oid, black: w ? oid : sock.id, board: E.initBoard(), turn: 'w', status: 'playing', result: '', msg: '', created: Date.now() };
      save(); send({ t: 'opened', gid }); return push(sock.g);
    }
    if (m.t === 'move') {
      const g = grp.games[m.gid];
      if (!g || g.status !== 'playing') return;
      const col = g.white === sock.id ? 'w' : g.black === sock.id ? 'b' : null;
      if (col !== g.turn) return fail('Hozir sizning yurishingiz emas');
      const from = +m.from, to = +m.to, b = g.board.split('');
      if (!(from >= 0 && from < 100 && to >= 0 && to < 100)) return;
      if (b[from] === '.' || b[from].toLowerCase() !== col || !E.dests(b, col, from).includes(to)) return fail("Bunday yurish mumkin emas");
      Object.assign(g, E.play(g, from, to, grp.players[sock.id].name));
      save(); return push(sock.g);
    }
  });
});

load().then(() => server.listen(PORT, () => console.log('Shashka Liga: port ' + PORT)));
