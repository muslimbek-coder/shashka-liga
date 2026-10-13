const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const E = require('./public/engine.js');

const PORT = process.env.PORT || 3000;
const FILE = path.join(process.env.DATA_DIR || __dirname, 'data.json');
const MAXP = 16, MAXG = 8;
process.on('uncaughtException', e => console.error(e));
let state = { users: {}, sessions: {}, groups: {}, cups: {} }, pg = null, timer = null;

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
  state.users = state.users || {}; state.sessions = state.sessions || {}; state.groups = state.groups || {}; state.cups = state.cups || {};
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
const ctxFor = s => s.mode === 'online' ? G(s.g) : s.mode === 'cup' ? state.cups[s.g] || null : s.mode === 'ai' && state.users[s.uid] ? state.users[s.uid].ai : null;
function pushTo(s) {
  const c = ctxFor(s);
  if (c && s.readyState === 1) s.send(JSON.stringify({ t: 'state', mode: s.mode, league: s.g, players: c.players, games: c.games, cup: s.mode === 'cup' ? { name: c.name, owner: c.owner, status: c.status, rounds: c.rounds, champion: c.champion } : undefined }));
}
const pushAll = pred => { for (const c of wss.clients) if (pred(c)) pushTo(c); };
const pushSame = s => pushAll(c => s.mode === 'ai' ? (c.mode === 'ai' && c.uid === s.uid) : (c.mode === s.mode && c.g === s.g));
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

/* ---------- Profil, do'stlar, kubok ---------- */
const getU = id => Object.prototype.hasOwnProperty.call(state.users, id) ? state.users[id] : null;
const fr = u => { u.friends = u.friends || []; u.reqIn = u.reqIn || []; u.reqOut = u.reqOut || []; return u; };
const card = id => { const x = getU(id); return x ? { id: x.id, username: x.username || x.id, name: x.name, avatar: x.avatar || '' } : null; };
const relation = (me, o) => { fr(me); return me.id === o.id ? 'self' : me.friends.includes(o.id) ? 'friend' : me.reqOut.includes(o.id) ? 'out' : me.reqIn.includes(o.id) ? 'in' : 'none'; };
function stats(uid) {
  let w = 0, l = 0, d = 0;
  const scan = gs => { for (const g of Object.values(gs || {})) {
    if (g.sim || g.status !== 'done' || (g.white !== uid && g.black !== uid)) continue;
    if (g.result === 'd') d++; else if ((g.result === 'w') === (g.white === uid)) w++; else l++;
  } };
  Object.values(state.groups).forEach(x => scan(x.games));
  Object.values(state.cups).forEach(x => scan(x.games));
  const u = getU(uid); if (u && u.ai) scan(u.ai.games);
  return { played: w + l + d, wins: w, losses: l, draws: d };
}
const profile = (me, o) => ({ ...card(o.id), bio: o.bio || '', stats: stats(o.id), relation: relation(me, o) });
function sendFriends(uid) {
  const u = getU(uid); if (!u) return; fr(u);
  const s = JSON.stringify({ t: 'friends', friends: u.friends.map(card).filter(Boolean), incoming: u.reqIn.map(card).filter(Boolean), outgoing: u.reqOut.map(card).filter(Boolean) });
  for (const c of wss.clients) if (c.uid === uid && c.readyState === 1) c.send(s);
}
const rid = () => Math.random().toString(36).slice(2, 10);
function mkGame(ctx, a, b) {
  const w = Math.random() < 0.5, gid = rid();
  ctx.games[gid] = { white: w ? a : b, black: w ? b : a, board: E.initBoard(), turn: 'w', status: 'playing', result: '', msg: '', created: Date.now() };
  return gid;
}
function cupRound(c, ids) {
  const ms = [];
  for (let k = 0; k < ids.length; k += 2) {
    const a = ids[k], b = ids[k + 1];
    ms.push(b == null ? { a, b: null, winner: a, gid: null, draws: 0 } : { a, b, winner: null, gid: mkGame(c, a, b), draws: 0 });
  }
  c.rounds.push(ms);
}
function cupStart(c) {
  const ids = Object.keys(c.players).sort(() => Math.random() - 0.5), n = ids.length;
  let N = 2; while (N < n) N *= 2;
  const first = ids.slice(0, N / 2), rest = ids.slice(N / 2), slots = [];
  for (let k = 0; k < N / 2; k++) { slots.push(first[k]); slots.push(rest[k] == null ? null : rest[k]); }
  c.status = 'running'; cupRound(c, slots);
}
function cupAdvance(c) {
  const last = c.rounds[c.rounds.length - 1];
  if (last.some(m => !m.winner)) return;
  const w = last.map(m => m.winner);
  if (w.length === 1) { c.status = 'done'; c.champion = w[0]; return; }
  cupRound(c, w);
}
function cupAfter(c, gid) {
  const g = c.games[gid]; if (!g || g.status !== 'done') return;
  const m = c.rounds[c.rounds.length - 1].find(x => x.gid === gid); if (!m) return;
  if (g.result === 'd') { m.draws++; m.gid = mkGame(c, m.a, m.b); }
  else m.winner = g.result === 'w' ? g.white : g.black;
  cupAdvance(c);
}

wss.on('connection', sock => {
  const send = o => sock.readyState === 1 && sock.send(JSON.stringify(o));
  const fail = msg => send({ t: 'error', msg });
  const authOk = (u, token) => {
    if (!token) { token = crypto.randomBytes(24).toString('hex'); state.sessions[token] = u.id; save(); }
    sock.uid = u.id; send({ t: 'authed', token, name: u.name, id: u.id, username: u.username || u.id }); sendFriends(u.id);
  };
  sock.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'ping') return;

    if (m.t === 'register' || m.t === 'login') {
      const un = String(m.username || '').trim().toLowerCase().replace(/^@/, ''), pass = String(m.pass || '');
      if (m.t === 'register') {
        const first = String(m.first || '').trim().replace(/\s+/g, ' ').slice(0, 20), last = String(m.last || '').trim().replace(/\s+/g, ' ').slice(0, 20);
        if (first.length < 2 || last.length < 2) return fail('Ism va familyani kiriting');
        if (!/^[a-z0-9_.]{3,20}$/.test(un)) return fail("Username 3-20 ta belgi bo'lsin: lotin harflari, raqam, _ yoki .");
        if (getU(un)) return fail('Bu username band');
        if (pass.length < 4) return fail("Parol kamida 4 ta belgidan iborat bo'lsin");
        const salt = crypto.randomBytes(16).toString('hex');
        state.users[un] = { id: un, username: un, name: first + ' ' + last, salt, hash: hash(pass, salt), bio: '', avatar: '', friends: [], reqIn: [], reqOut: [], created: Date.now() };
        save(); return authOk(state.users[un]);
      }
      const u = getU(un);
      if (!u || !same(hash(pass, u.salt), u.hash)) return fail("Username yoki parol noto'g'ri");
      return authOk(u);
    }
    if (m.t === 'resume') {
      const uid = state.sessions[String(m.token)];
      if (!uid || !getU(uid)) return send({ t: 'noauth' });
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
    if (m.t === 'joinCup') {
      const nameRaw = String(m.g || '').trim().slice(0, 30), g = nameRaw.toLowerCase().replace(/[\/\s]+/g, '_');
      if (!g) return fail('Kubok nomini kiriting');
      let c = Object.prototype.hasOwnProperty.call(state.cups, g) ? state.cups[g] : null;
      if (!c) c = state.cups[g] = { name: nameRaw, owner: u.id, status: 'open', players: {}, games: {}, rounds: [], champion: null };
      if (!c.players[u.id]) {
        if (c.status !== 'open') return fail('Bu kubok allaqachon boshlangan');
        if (Object.keys(c.players).length >= MAXP) return fail(`Kubokda ${MAXP} ta ishtirokchi to'lgan`);
        c.players[u.id] = { name: u.name }; save();
      }
      sock.mode = 'cup'; sock.g = g;
      return pushSame(sock);
    }
    if (m.t === 'cupStart') {
      const c = sock.mode === 'cup' ? ctxFor(sock) : null;
      if (!c || c.owner !== u.id || c.status !== 'open') return;
      if (Object.keys(c.players).length < 2) return fail('Kamida 2 ta ishtirokchi kerak');
      cupStart(c); save(); return pushSame(sock);
    }
    if (m.t === 'getProfile') {
      const o = getU(String(m.id || u.id)); if (!o) return fail('Foydalanuvchi topilmadi');
      return send({ t: 'profile', user: profile(u, o) });
    }
    if (m.t === 'saveProfile') {
      u.bio = String(m.bio || '').slice(0, 200);
      if (typeof m.avatar === 'string') {
        if (m.avatar === '') u.avatar = '';
        else if (m.avatar.startsWith('data:image/jpeg;base64,') && m.avatar.length <= 60000) u.avatar = m.avatar;
      }
      save(); return send({ t: 'profile', user: profile(u, u) });
    }
    if (m.t === 'searchUser') {
      const q = String(m.q || '').trim().toLowerCase().replace(/^@/, '');
      if (q.length < 2) return send({ t: 'sres', q, users: [] });
      const un = x => x.username || x.id;
      const out = Object.values(state.users).filter(x => x.id !== u.id && un(x).startsWith(q))
        .sort((x, y) => (un(x) === q ? 0 : 1) - (un(y) === q ? 0 : 1)).slice(0, 8)
        .map(x => ({ ...card(x.id), relation: relation(u, x) }));
      return send({ t: 'sres', q, users: out });
    }
    if (['friendReq', 'friendAccept', 'friendDecline', 'friendRemove', 'friendCancel'].includes(m.t)) {
      const o = getU(String(m.to || m.from || m.id || ''));
      if (!o || o.id === u.id) return;
      const a = fr(u), b = fr(o);
      const rm = (arr, x) => { const i = arr.indexOf(x); if (i >= 0) arr.splice(i, 1); };
      const add = (arr, x) => { if (!arr.includes(x)) arr.push(x); };
      const clear = () => { rm(a.reqIn, o.id); rm(a.reqOut, o.id); rm(b.reqIn, u.id); rm(b.reqOut, u.id); };
      const mk = () => { clear(); add(a.friends, o.id); add(b.friends, u.id); };
      if (m.t === 'friendReq') { if (a.friends.includes(o.id)) return; if (a.reqIn.includes(o.id)) mk(); else { add(a.reqOut, o.id); add(b.reqIn, u.id); } }
      else if (m.t === 'friendAccept') { if (a.reqIn.includes(o.id)) mk(); }
      else if (m.t === 'friendRemove') { rm(a.friends, o.id); rm(b.friends, u.id); }
      else clear();
      save(); sendFriends(u.id); sendFriends(o.id); return;
    }
    const ctx = ctxFor(sock);
    if (!ctx) return;

    if (m.t === 'challenge') {
      if (sock.mode === 'cup') return;
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
      if (sock.mode === 'cup') cupAfter(ctx, m.gid);
      save(); pushSame(sock);
      return aiTurn(sock, m.gid);
    }
  });
});

load().then(() => server.listen(PORT, () => console.log('Shashka Liga: port ' + PORT)));
