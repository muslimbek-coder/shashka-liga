const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const E = require('./public/engine.js');

const PORT = process.env.PORT || 3000;
const FILE = path.join(process.env.DATA_DIR || __dirname, 'data.json');
const MAXP = 16, MAXG = 8;
let state = { users: {}, sessions: {}, groups: {} }, pg = null, timer = null;

/* ---------- Saqlash ---------- */
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
  state.users = state.users || {}; state.sessions = state.sessions || {}; state.groups = state.groups || {};
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

/* ---------- Parol ---------- */
const hash = (p, salt) => crypto.scryptSync(p, salt, 32).toString('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/* ---------- AI ---------- */
const TIERS = ['Boshlovchi', 'Oddiy', "O'rta", 'Kuchli'];
const AINAMES = ['Anvar', 'Bobur', 'Dilshod', 'Eldor', 'Farhod', 'Gulnora', 'Hamid', 'Ilhom', 'Jasur', 'Kamola', 'Laziz', 'Malika', 'Nodir', 'Otabek', 'Pariza'];
const AIS = AINAMES.map((n, i) => { const lvl = i < 4 ? 0 : i < 8 ? 1 : i < 12 ? 2 : 3; return { name: `${n} (AI, ${TIERS[lvl].toLowerCase()})`, lvl }; });

function legal(b, col) {
  const caps = E.allCaps(b, col);
  if (caps.length) {
    const seen = new Set(), o = [];
    for (const s of caps) { const t = s.path[s.path.length - 1], k = s.from + '-' + t; if (!seen.has(k)) { seen.add(k); o.push([s.from, t]); } }
    return o;
  }
  const o = [];
  b.forEach((p, i) => { if (p !== '.' && p.toLowerCase() === col) for (const t of E.simple(b, i)) o.push([i, t]); });
  return o;
}
function evalB(b, col) {
  let v = 0;
  b.forEach((p, i) => {
    if (p === '.') return;
    const c = p.toLowerCase(), k = p !== c;
    let x = k ? 32 : 10;
    if (!k) x += (c === 'w' ? 9 - Math.floor(i / 10) : Math.floor(i / 10)) * 0.6;
    v += c === col ? x : -x;
  });
  return v + Math.random() * 0.3;
}
function nega(s, d, a, b) {
  const bd = s.board.split(''), ms = legal(bd, s.turn);
  if (!ms.length) return -1000 - d;
  if (d === 0) return evalB(bd, s.turn);
  let best = -Infinity;
  for (const [f, t] of ms) {
    const r = E.play(s, f, t, '');
    const v = r.status === 'done' ? (r.result === 'd' ? 0 : 1000 + d) : -nega({ board: r.board, turn: r.turn }, d - 1, -b, -a);
    if (v > best) best = v;
    if (best > a) a = best;
    if (a >= b) break;
  }
  return best;
}
function aiPick(g, lvl) {
  const ms = legal(g.board.split(''), g.turn);
  if (lvl === 0) return ms[Math.floor(Math.random() * ms.length)];
  let best = -Infinity, bm = ms[0];
  for (const [f, t] of ms) {
    const r = E.play(g, f, t, '');
    const v = r.status === 'done' ? (r.result === 'd' ? 0 : 1000) : -nega({ board: r.board, turn: r.turn }, lvl - 1, -Infinity, Infinity);
    if (v > best) { best = v; bm = [f, t]; }
  }
  return bm;
}
function newAILeague(u) {
  const ids = [u.id, ...AIS.map((_, i) => 'ai:' + (i + 1))];
  const players = { [u.id]: { name: u.name } };
  AIS.forEach((a, i) => players['ai:' + (i + 1)] = { name: a.name, ai: true, lvl: a.lvl });
  const lv = k => k === 0 ? 1.5 : AIS[k - 1].lvl;
  const games = {};
  // 16 ishtirokchi, har biri 8 ta o'yin: i va i±1..4 (mod 16). Siz bilan o'yinlar (0-1..4, 0-12..15) haqiqiy, qolganlari avtomatik hisoblanadi.
  for (let i = 1; i < 16; i++) for (let d = 1; d <= 4; d++) {
    const j = (i + d) % 16; if (j === 0) continue;
    const pa = Math.min(0.85, Math.max(0.15, 0.5 + 0.14 * (lv(i) - lv(j))));
    const r = Math.random(); let res = 'd';
    if (r > 0.12) res = Math.random() < pa ? 'w' : 'b';
    const left = 1 + Math.floor(Math.random() * 7);
    games['s' + i + '_' + j] = { white: ids[i], black: ids[j], status: 'done', result: res, wl: res === 'w' ? left : 1, bl: res === 'b' ? left : 1, sim: true, created: 0, board: '', turn: 'w', msg: '' };
  }
  u.ai = { players, games };
}

/* ---------- Server ---------- */
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
const ctxFor = s => s.mode === 'online' ? G(s.g) : s.mode === 'ai' && state.users[s.uid] ? state.users[s.uid].ai : null;
function pushTo(s) {
  const c = ctxFor(s);
  if (c && s.readyState === 1) s.send(JSON.stringify({ t: 'state', mode: s.mode, league: s.g, players: c.players, games: c.games }));
}
const pushAll = pred => { for (const c of wss.clients) if (pred(c)) pushTo(c); };
const pushSame = s => pushAll(c => s.mode === 'online' ? (c.mode === 'online' && c.g === s.g) : (c.mode === 'ai' && c.uid === s.uid));
const count = (ctx, id) => Object.values(ctx.games).filter(x => x.white === id || x.black === id).length;
const paired = (ctx, a, b) => Object.values(ctx.games).some(x => (x.white === a && x.black === b) || (x.white === b && x.black === a));

function aiTurn(sock, gid) {
  const ctx = ctxFor(sock), g = ctx && ctx.games[gid];
  if (!g || g.status !== 'playing') return;
  const aiId = g.turn === 'w' ? g.white : g.black;
  if (!aiId.startsWith('ai:')) return;
  const turn = g.turn;
  setTimeout(() => {
    if (g.status !== 'playing' || g.turn !== turn) return;
    const mv = aiPick(g, ctx.players[aiId].lvl);
    if (!mv) return;
    Object.assign(g, E.play(g, mv[0], mv[1], ctx.players[aiId].name));
    save(); pushSame(sock);
  }, 700);
}

wss.on('connection', sock => {
  const send = o => sock.readyState === 1 && sock.send(JSON.stringify(o));
  const fail = msg => send({ t: 'error', msg });
  const authOk = (u, token) => {
    if (!token) { token = crypto.randomBytes(24).toString('hex'); state.sessions[token] = u.id; save(); }
    sock.uid = u.id; send({ t: 'authed', token, name: u.name, id: u.id });
  };
  sock.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'ping') return;

    if (m.t === 'register' || m.t === 'login') {
      const first = String(m.first || '').trim().replace(/\s+/g, ' ').slice(0, 20), last = String(m.last || '').trim().replace(/\s+/g, ' ').slice(0, 20), pass = String(m.pass || '');
      if (first.length < 2 || last.length < 2) return fail('Ism va familyani kiriting');
      const id = (first + ' ' + last).toLowerCase(), u = state.users[id];
      if (m.t === 'register') {
        if (u) return fail("Bu ism-familya allaqachon ro'yxatdan o'tgan");
        if (pass.length < 4) return fail("Parol kamida 4 ta belgidan iborat bo'lsin");
        const salt = crypto.randomBytes(16).toString('hex');
        state.users[id] = { id, name: first + ' ' + last, salt, hash: hash(pass, salt), created: Date.now() };
        save(); return authOk(state.users[id]);
      }
      if (!u || !same(hash(pass, u.salt), u.hash)) return fail("Ism-familya yoki parol noto'g'ri");
      return authOk(u);
    }
    if (m.t === 'resume') {
      const uid = state.sessions[String(m.token)];
      if (!uid || !state.users[uid]) return send({ t: 'noauth' });
      return authOk(state.users[uid], String(m.token));
    }
    if (!sock.uid) return send({ t: 'noauth' });
    const u = state.users[sock.uid];

    if (m.t === 'leave') { sock.mode = null; sock.g = null; return; }
    if (m.t === 'joinLeague') {
      const g = String(m.g || '').trim().toLowerCase().replace(/[\/\s]+/g, '_').slice(0, 30);
      if (!g) return fail('Liga nomini kiriting');
      const grp = G(g);
      if (!grp.players[u.id]) {
        if (Object.keys(grp.players).length >= MAXP) return fail(`Ligada ${MAXP} ta ishtirokchi to'lgan`);
        grp.players[u.id] = { name: u.name, created: Date.now() };
        save();
      }
      sock.mode = 'online'; sock.g = g;
      return pushSame(sock);
    }
    if (m.t === 'startAI') {
      if (!u.ai) { newAILeague(u); save(); }
      sock.mode = 'ai'; sock.g = null;
      pushTo(sock);
      for (const gid in u.ai.games) aiTurn(sock, gid);
      return;
    }
    const ctx = ctxFor(sock);
    if (!ctx) return;

    if (m.t === 'challenge') {
      const oid = String(m.oid);
      if (!ctx.players[oid] || oid === sock.uid) return fail('Ishtirokchi topilmadi');
      if (paired(ctx, sock.uid, oid)) return fail("Siz bu ishtirokchi bilan o'ynagansiz");
      if (count(ctx, sock.uid) >= MAXG || count(ctx, oid) >= MAXG) return fail(`Har kim ${MAXG} ta o'yin o'ynaydi`);
      const w = Math.random() < 0.5, gid = Math.random().toString(36).slice(2, 10);
      ctx.games[gid] = { white: w ? sock.uid : oid, black: w ? oid : sock.uid, board: E.initBoard(), turn: 'w', status: 'playing', result: '', msg: '', created: Date.now() };
      save(); send({ t: 'opened', gid }); pushSame(sock);
      return aiTurn(sock, gid);
    }
    if (m.t === 'move') {
      const g = ctx.games[m.gid];
      if (!g || g.status !== 'playing') return;
      const col = g.white === sock.uid ? 'w' : g.black === sock.uid ? 'b' : null;
      if (col !== g.turn) return fail('Hozir sizning yurishingiz emas');
      const from = +m.from, to = +m.to, b = g.board.split('');
      if (!(from >= 0 && from < 100 && to >= 0 && to < 100)) return;
      if (b[from] === '.' || b[from].toLowerCase() !== col || !E.dests(b, col, from).includes(to)) return fail('Bunday yurish mumkin emas');
      Object.assign(g, E.play(g, from, to, u.name));
      save(); pushSame(sock);
      return aiTurn(sock, m.gid);
    }
  });
});

load().then(() => server.listen(PORT, () => console.log('Shashka Liga: port ' + PORT)));
