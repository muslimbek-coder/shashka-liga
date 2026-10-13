const MAXG=8;
const {dests}=Engine;
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ls={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}},del:k=>{try{localStorage.removeItem(k)}catch(e){}}};
let meId,myName,players={},games={},cur=null,sel=null,sock=null,token=null,authed=false,lastEnter=null,regMode=false,curMode=null,myUser,cupData=null,fr={friends:[],incoming:[],outgoing:[]},prof=null,viewP=null,sres=[],lastQ='',mtab='prof',pend=null,saving=false,roomLists={league:[],cup:[]},inviteId=null;

/* ---------- Jadval ---------- */
function table(){
  const t={};
  for(const id in players)t[id]={id,name:players[id].name,pts:0,diff:0,pl:0};
  for(const g of Object.values(games)){
    if(g.status!=='done')continue;
    const W=t[g.white],B=t[g.black];if(!W||!B)continue;
    W.pl++;B.pl++;
    if(g.result==='d'){W.pts++;B.pts++}
    else{
      const win=g.result==='w'?W:B,lose=g.result==='w'?B:W,left=g.result==='w'?g.wl:g.bl;
      win.pts+=3;win.diff+=left;lose.diff-=left;
    }
  }
  return Object.values(t).sort((x,y)=>y.pts-x.pts||y.diff-x.diff||x.name.localeCompare(y.name));
}
const nGames=id=>Object.values(games).filter(g=>g.white===id||g.black===id).length;
const paired=(a,b)=>Object.values(games).some(g=>(g.white===a&&g.black===b)||(g.white===b&&g.black===a));
const nm=id=>players[id]?players[id].name:id;

/* ---------- Ko'rinish ---------- */
function renderTable(){
  const rows=table();
  $('#tbl').innerHTML=`<table><tr><th>#</th><th>Ishtirokchi</th><th>O'yin</th><th>Donalar</th><th>Ochko</th></tr>`+
  rows.map((r,i)=>`<tr class="${i<3&&r.pl>0?'top':''} ${r.id===meId?'me':''}"><td>${i+1}</td><td>${esc(r.name)}</td><td>${r.pl}/${Math.min(MAXG,Math.max(nGames(r.id),r.pl))}</td><td>${r.diff>0?'+':''}${r.diff}</td><td><b>${r.pts}</b></td></tr>`).join('')+`</table>`;
}
function renderLobby(){
  const mine=nGames(meId);
  $('#lobby').innerHTML=Object.keys(players).sort().map(id=>{
    if(id===meId)return `<div class="row"><span>${esc(nm(id))} <span class="tag">siz</span></span><span class="mut">${mine}/${MAXG}</span></div>`;
    const ok=!paired(meId,id)&&mine<MAXG&&nGames(id)<MAXG;
    const why=paired(meId,id)?'o\'ynalgan':nGames(id)>=MAXG?'to\'lgan':'';
    return `<div class="row"><span>${esc(nm(id))} <span class="mut">${nGames(id)}/${MAXG}</span></span>${ok?`<button data-ch="${id}">O'ynash</button>`:`<span class="mut">${why}</span>`}</div>`;
  }).join('')||'<div class="mut">Hali hech kim yo\'q</div>';
}
function renderGames(){
  const list=Object.entries(games).filter(([,g])=>!g.sim).sort((a,b)=>b[1].created-a[1].created);
  $('#glist').innerHTML=list.map(([id,g])=>{
    const mine=g.white===meId||g.black===meId;
    const my=mine&&g.status==='playing'&&((g.turn==='w'&&g.white===meId)||(g.turn==='b'&&g.black===meId));
    const res=g.status==='done'?(g.result==='d'?'durang':(g.result==='w'?nm(g.white):nm(g.black))+' yutdi'):'davom etmoqda';
    return `<div class="row"><span>${esc(nm(g.white))} – ${esc(nm(g.black))}<br><span class="mut">${esc(res)}</span> ${my?'<span class="tag">sizning yurishingiz</span>':''}</span><button class="ghost" data-open="${id}">${mine?'Ochish':'Ko\'rish'}</button></div>`;
  }).join('')||'<div class="mut">O\'yin yo\'q. Ishtirokchini tanlang.</div>';
}
function renderBoard(){
  const g=games[cur];
  if(!g){$('#board').innerHTML='';$('#info').innerHTML='<div class="big">O\'yin tanlang</div><div class="mut" style="text-align:center">Chapdagi ro\'yxatdan raqib tanlang</div>';$('#msg').textContent='';return}
  const mine=g.white===meId?'w':g.black===meId?'b':null,flip=mine==='b',b=g.board.split('');
  const d=new Set();
  if(sel!=null&&mine&&g.turn===mine&&g.status==='playing')dests(b,mine,sel).forEach(x=>d.add(x));
  let h='';
  for(let k=0;k<100;k++){
    const i=flip?99-k:k,r=Math.floor(i/10),c=i%10,p=b[i],dark=(r+c)%2;
    h+=`<div class="sq ${dark?'d':'l'}${i===sel?' sel':''}${d.has(i)?' dst':''}" data-i="${i}">${k%10===0?`<b class="rk">${10-r}</b>`:''}${k>=90?`<b class="fl">${'abcdefghij'[c]}</b>`:''}${p!=='.'?`<i class="pc ${p.toLowerCase()}">${p===p.toUpperCase()?'♛':''}</i>`:''}</div>`;
  }
  $('#board').innerHTML=h;
  const wc=b.filter(x=>x.toLowerCase()==='w').length,bc=b.filter(x=>x.toLowerCase()==='b').length;
  let st;
  if(g.status==='done')st=g.result==='d'?'Durang':`${esc(nm(g.result==='w'?g.white:g.black))} g'alaba qozondi`;
  else st=`Yurish navbati: ${esc(nm(g.turn==='w'?g.white:g.black))}${mine===g.turn?' (siz)':''}`;
  const pl=(col,id,n)=>`<div class="pcard${g.status==='playing'&&g.turn===col?' act':''}"><i class="pc ${col} mini"></i><div style="min-width:0"><b>${esc(nm(id))}${id===meId?' (siz)':''}</b><div class="mut">${col==='w'?'Oq':'Qora'} · ${n} dona</div></div></div>`;
  $('#info').innerHTML=`<div class="pcards">${pl('w',g.white,wc)}${pl('b',g.black,bc)}</div><div class="st">${st}</div>`;
  $('#msg').textContent=g.msg||'';
}
const renderAll=()=>{
  if(cupData)renderCup();
  else{$('#h2l').textContent='Ishtirokchilar';$('#h2r').textContent='Liga jadvali';$('#rules').hidden=false;renderTable();renderLobby()}
  renderGames();renderBoard();
};
function roundName(i,R){const l=R-i;return l===1?'Final':l===2?'Yarim final':l===3?'Chorak final':l===4?'1/8 final':(i+1)+'-tur'}
function matchHTML(m){
  const row=(id,bye)=>`<div class="mrow${id&&m.winner===id?' win':''}${id&&m.winner&&m.winner!==id?' lose':''}">${id?esc(nm(id)):`<span class="mut">${bye?'dam olish':'—'}</span>`}</div>`;
  const mine=(m.a===meId||m.b===meId)&&!m.winner;
  return `<div class="match${mine?' mine':''}${m.gid?' clk':''}"${m.gid?` data-open="${m.gid}"`:''}>${row(m.a)}${row(m.b,m.a&&!m.b)}${m.draws?`<div class="dr">${m.draws} marta durang, qayta o'ynaladi</div>`:''}</div>`;
}
function bracketHTML(c){
  if(!c.rounds.length)return '<div class="mut">Kubok hali boshlanmagan. Tashkilotchi boshlagach, qura bo\'yicha setka tuziladi.</div>';
  const N=c.rounds[0].length*2,R=Math.log2(N);let cols='';
  for(let i=0;i<R;i++){
    const ms=c.rounds[i]||Array.from({length:N/2**(i+1)},()=>({}));
    cols+=`<div class="bcol"><div class="bh">${roundName(i,R)}</div><div class="bm">${ms.map(matchHTML).join('')}</div></div>`;
  }
  cols+=`<div class="bcol"><div class="bh">Chempion</div><div class="bm"><div class="champ">🏆<div>${c.champion?esc(nm(c.champion)):'—'}</div></div></div></div>`;
  return `<div class="bracket">${cols}</div>`;
}
function renderCup(){
  const c=cupData,ids=Object.keys(players);
  $('#h2l').textContent='Ishtirokchilar';$('#h2r').textContent=c.ai?'AI kubogi setkasi':'Kubok setkasi';$('#rules').hidden=true;
  let h=ids.map(id=>`<div class="row"><span>${esc(nm(id))}${id===meId?' <span class="tag">siz</span>':''}${id===c.owner?' <span class="mut">(tashkilotchi)</span>':''}</span></div>`).join('');
  if(c.status==='open'){
    h+=`<div class="mut" style="margin:10px 0">${ids.length}/16 ishtirokchi</div>`;
    h+=c.owner===meId?`<button id="cupstart" style="width:100%" ${ids.length<2?'disabled':''}>Kubokni boshlash</button>`:'<div class="mut">Tashkilotchi boshlashini kuting</div>';
  }else if(c.status==='done')h+=`<div class="st">Chempion: ${esc(nm(c.champion))}</div>`;
  $('#lobby').innerHTML=h;$('#tbl').innerHTML=bracketHTML(c);
}
function renderRooms(kind){
  const list=roomLists[kind]||[],id=kind==='cup'?'cuplist':'leaguelist';
  $( '#'+id ).innerHTML=list.map(r=>{
    const full=r.players>=r.max&&!r.joined,started=r.status!=='open'&&kind==='cup'&&!r.joined;
    const status=kind==='cup'&&started?'Boshlangan':`${r.players}/${r.max} ishtirokchi`;
    return `<div class="roomrow"><span><b>${esc(r.name)}</b><br><span class="roommeta">${esc(status)}</span></span><button data-room-kind="${kind}" data-room-id="${esc(r.id)}" ${full||started?'disabled':''}>${started?'Yopiq':'Kirish'}</button></div>`;
  }).join('')||"<div class='mut'>Hozircha ommaviy xona yo'q</div>";
}

/* ---------- Harakatlar ---------- */
const send=o=>{if(sock&&sock.readyState===1)sock.send(JSON.stringify(o))};
const toast=t=>{$('#msg').textContent=t};
const show=id=>{['login','mode','app'].forEach(x=>$('#'+x).hidden=x!==id)};
$('#board').onclick=e=>{
  const s=e.target.closest('.sq');if(!s)return;
  const g=games[cur];if(!g||g.status!=='playing')return;
  const mine=g.white===meId?'w':g.black===meId?'b':null;
  if(!mine||g.turn!==mine)return;
  const i=+s.dataset.i,b=g.board.split('');
  if(sel!=null&&dests(b,mine,sel).includes(i)){send({t:'move',gid:cur,from:sel,to:i});sel=null}
  else if(b[i]!=='.'&&b[i].toLowerCase()===mine)sel=i;
  else sel=null;
  renderBoard();
};
document.addEventListener('click',e=>{
  const o=e.target.closest('[data-open]');
  if(o){cur=o.dataset.open;sel=null;renderBoard();return}
  const c=e.target.closest('[data-ch]');
  if(c)send({t:'challenge',oid:c.dataset.ch});
  const r=e.target.closest('[data-room-id]');
  if(r)enterRoom({t:'joinRoom',kind:r.dataset.roomKind,id:r.dataset.roomId});
});

/* ---------- Ulanish va kirish ---------- */
function wsOpen(){
  return new Promise((res,rej)=>{
    if(sock&&sock.readyState===1)return res();
    const s=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host);
    sock=s;
    s.onopen=()=>res();
    s.onerror=()=>rej(new Error("Serverga ulanib bo'lmadi"));
    s.onmessage=onMsg;
    s.onclose=()=>{if(authed){toast('Aloqa uzildi, qayta ulanmoqda...');setTimeout(async()=>{try{await wsOpen();send({t:'resume',token})}catch(e){}},2000)}};
  });
}
function showErr(t){
  if(!$('#modal').hidden){$('#mmsg').textContent=t;return}
  if(!$('#app').hidden)toast(t);
  else if(!$('#mode').hidden){$('#merr').textContent=t;lastEnter=null;ls.del('shashka_enter')}
  else $('#err').textContent=t;
}
function onMsg(ev){
  const m=JSON.parse(ev.data);
  if(m.t==='authed'){
    token=m.token;authed=true;meId=m.id;myName=m.name;myUser=m.username;ls.set('shashka_token',token);
    if(lastEnter)send(lastEnter);else{$('#mhi').textContent='Salom, '+m.name;show('mode');send({t:'listRooms',kind:'league'});send({t:'listRooms',kind:'cup'})}
  }else if(m.t==='noauth'){
    token=null;authed=false;ls.del('shashka_token');show('login');
  }else if(m.t==='state'){
    players=m.players;games=m.games;cupData=m.cup||null;
    const key=m.mode+(m.league||'');
    if(curMode!==key){curMode=key;cur=null;sel=null}
    if($('#app').hidden)show('app');
    $('#hg').textContent=m.mode==='ai'?'AI bilan liga':m.mode==='aicup'?'AI kubogi':m.mode==='duel'?"Do'st bilan duel":(m.mode==='cup'?'Kubok: ':'Liga: ')+(m.league||'');
    if(m.mode!=='ai'&&m.mode!=='aicup')$('#hg').textContent+=' · ID '+(m.roomId||'');
    $('#hn').textContent='Siz: '+myName;
    document.querySelector('main').className=m.mode==='cup'||m.mode==='aicup'?'cup':'';
    const mp=Object.entries(games).find(([,x])=>x.status==='playing'&&(x.white===meId||x.black===meId)),g0=games[cur];
    if(!g0||(g0.status==='done'&&mp&&(g0.white===meId||g0.black===meId)))cur=mp?mp[0]:(g0?cur:null);
    renderAll();
  }else if(m.t==='opened'){cur=m.gid;sel=null;renderAll()}
  else if(m.t==='rooms'){roomLists[m.kind]=m.rooms;renderRooms(m.kind)}
  else if(m.t==='challengeInvite'){
    inviteId=m.id;$('#inviteText').textContent=`${m.from.name} sizni 1 ga 1 shashka o'yiniga taklif qildi.`;$('#inviteNotice').hidden=false;
  }else if(m.t==='challengeSent')toast(`${m.name} ga o'yin taklifi yuborildi`);
  else if(m.t==='challengeDeclined')toast(`${m.name} taklifni rad etdi`);
  else if(m.t==='challengeCancelled'){inviteId=null;$('#inviteNotice').hidden=true;toast('Taklif bekor qilindi')}
  else if(m.t==='profile'){
    if(m.user.id===meId){prof=m.user;const was=saving;saving=false;if(was)pend=null;renderModal();if(was&&$('#sv'))$('#sv').textContent='Saqlandi ✓'}
    else{viewP=m.user;renderModal()}
  }else if(m.t==='sres'){sres=m.users;if(!$('#modal').hidden&&mtab==='fr'&&!viewP)renderModal()}
  else if(m.t==='friends'){
    fr=m;updBadge();
    if(!$('#modal').hidden&&(mtab==='fr'||viewP)){
      if(lastQ)send({t:'searchUser',q:lastQ});
      if(viewP)send({t:'getProfile',id:viewP.id});
      renderModal();
    }
  }
  else if(m.t==='error')showErr(m.msg);
}
const err=t=>$('#err').textContent=t;
function setTab(reg){
  regMode=reg;$('#pw2w').hidden=!reg;$('#namew').hidden=!reg;$('#go').textContent=reg?"Ro'yxatdan o'tish":'Kirish';
  $('#tabin').classList.toggle('on',!reg);$('#tabup').classList.toggle('on',reg);
  $('#pw').autocomplete=reg?'new-password':'current-password';err('');
}
$('#tabin').onclick=()=>setTab(false);
$('#tabup').onclick=()=>setTab(true);
$('#go').onclick=async()=>{
  const first=$('#fn').value.trim(),last=$('#ln').value.trim(),username=$('#un').value.trim(),pass=$('#pw').value;
  if(!username||!pass||(regMode&&(!first||!last)))return err(regMode?'Ism, familya, username va parolni kiriting':'Username va parolni kiriting');
  if(regMode&&pass!==$('#pw2').value)return err('Parollar bir xil emas');
  err('');
  try{await wsOpen()}catch(e){return err(e.message)}
  send(regMode?{t:'register',first,last,username,pass}:{t:'login',username,pass});
};
function enter(m){lastEnter=m;ls.set('shashka_enter',JSON.stringify(m));$('#merr').textContent='';cur=null;sel=null;send(m)}
function enterRoom(m){lastEnter=null;ls.del('shashka_enter');$('#merr').textContent='';cur=null;sel=null;send(m)}
function createRoom(kind){
  const cup=kind==='cup',name=$('#'+(cup?'newcup':'newlg')).value.trim(),visibility=$('#'+kind+'visibility').value,password=$('#'+kind+'createpass').value;
  if(!name)return $('#merr').textContent=cup?'Kubok nomini kiriting':'Liga nomini kiriting';
  if(visibility==='private'&&password.length<4)return $('#merr').textContent="Maxfiy xona paroli kamida 4 ta belgidan iborat bo'lsin";
  enterRoom({t:'createRoom',kind,name,visibility,password});
}
function joinById(kind){
  const cup=kind==='cup',id=$('#'+kind+'id').value.trim(),password=$('#'+kind+'pass').value;
  if(!id)return $('#merr').textContent='Xona ID sini kiriting';
  enterRoom({t:'joinRoom',kind,id,password});
}
$('#createleague').onclick=()=>createRoom('league');
$('#createcup').onclick=()=>createRoom('cup');
$('#joinleagueid').onclick=()=>joinById('league');
$('#joincupid').onclick=()=>joinById('cup');
$('#leaguevisibility').onchange=()=>$('#leaguecreatepass').hidden=$('#leaguevisibility').value!=='private';
$('#cupvisibility').onchange=()=>$('#cupcreatepass').hidden=$('#cupvisibility').value!=='private';
$('#ai').onclick=()=>enter({t:'startAI'});
$('#aicup').onclick=()=>enter({t:'startAICup'});
$('#back').onclick=()=>{lastEnter=null;ls.del('shashka_enter');send({t:'leave'});cur=null;sel=null;curMode=null;$('#mhi').textContent='Salom, '+myName;show('mode');send({t:'listRooms',kind:'league'});send({t:'listRooms',kind:'cup'})};
const logout=()=>{authed=false;ls.del('shashka_token');ls.del('shashka_enter');location.reload()};
$('#out').onclick=logout;$('#out2').onclick=logout;
/* ---------- Profil va do'stlar ---------- */
const ini=n=>String(n).split(' ').map(x=>x[0]||'').slice(0,2).join('').toUpperCase();
const avHTML=(src,name,cls='')=>src&&src.startsWith('data:image/')?`<img class="av ${cls}" src="${esc(src)}" alt="">`:`<div class="av ini ${cls}">${esc(ini(name))}</div>`;
const updBadge=()=>{const t='Profil'+(fr.incoming.length?' · '+fr.incoming.length:'');$('#openProf').textContent=t;$('#openProf2').textContent="Profil va do'stlar"+(fr.incoming.length?' · '+fr.incoming.length:'')};
const statsHTML=s=>`<div class="stats"><div class="stat"><b>${s.played}</b><span>O'yin</span></div><div class="stat w"><b>${s.wins}</b><span>G'alaba</span></div><div class="stat l"><b>${s.losses}</b><span>Mag'lubiyat</span></div><div class="stat d"><b>${s.draws}</b><span>Durang</span></div></div>`;
const btn=(act,id,txt,ghost)=>`<button class="${ghost?'ghost':''}" data-act="${act}" data-id="${esc(id)}">${txt}</button>`;
function relBtns(u){
  const r=u.relation;
  return r==='friend'?btn('rem',u.id,"Do'stlikdan chiqarish",1):r==='out'?btn('cancel',u.id,"Taklifni bekor qilish",1):r==='in'?btn('acc',u.id,'Qabul qilish')+btn('dec',u.id,'Rad etish',1):btn('req',u.id,"Do'st qo'shish");
}
const presenceLabel={online:'onlayn',offline:'oflayn',playing:"o'yinda"};
const urow=(u,btns)=>`<div class="urow">${avHTML(u.avatar,u.name,'sm')}<div class="ui"><b>${esc(u.name)}</b><div class="mut">@${esc(u.username)}${u.presence?` · <span class="presence ${esc(u.presence)}">${presenceLabel[u.presence]||'oflayn'}</span>`:''}</div></div><div class="ua">${btns}</div></div>`;
function renderModal(){
  if($('#modal').hidden)return;
  $('#tprof').classList.toggle('on',mtab==='prof'&&!viewP);$('#tfr').classList.toggle('on',mtab==='fr'||!!viewP);
  let h='';
  if(viewP){
    const U=viewP;
    h=`<button class="ghost" data-act="back" style="margin-bottom:12px">← Orqaga</button><div class="ph">${avHTML(U.avatar,U.name)}<div><h2>${esc(U.name)}</h2><div class="mut">@${esc(U.username)}</div></div></div>`+
      (U.bio?`<p>${esc(U.bio)}</p>`:'<p class="mut">Bio yozilmagan</p>')+`<div class="hbtns">${relBtns(U)}</div>`+statsHTML(U.stats);
  }else if(mtab==='prof'){
    const U=prof;
    if(!U)h='<div class="mut">Yuklanmoqda...</div>';
    else h=`<div class="ph"><div class="avw" data-act="pick" id="avbox">${avHTML(pend!==null?pend:U.avatar,U.name)}<span class="avedit">O'zgartirish</span></div><div><h2>${esc(U.name)}</h2><div class="mut">@${esc(U.username)}</div></div></div>
      <label for="bio">Bio</label><textarea id="bio" maxlength="200" placeholder="O'zingiz haqingizda qisqacha yozing">${esc(U.bio)}</textarea>
      <div style="margin-top:10px;display:flex;gap:10px;align-items:center"><button data-act="save">Saqlash</button><span id="sv" class="mut"></span></div>${statsHTML(U.stats)}`;
  }else{
    h=`<div class="srch"><input id="sq" placeholder="Username bo'yicha qidirish" value="${esc(lastQ)}" autocapitalize="none"><button data-act="search">Qidirish</button></div>`;
    if(lastQ)h+=sres.length?sres.map(u=>urow(u,btn('view',u.id,'Profil',1)+relBtns(u))).join(''):'<div class="mut">Hech kim topilmadi</div>';
    if(fr.incoming.length)h+=`<h3>Do'stlik so'rovlari</h3>`+fr.incoming.map(u=>urow(u,btn('view',u.id,'Profil',1)+btn('acc',u.id,'Qabul')+btn('dec',u.id,'Rad',1))).join('');
    h+=`<h3>Do'stlarim (${fr.friends.length})</h3>`+(fr.friends.length?fr.friends.map(u=>{
      const duel=u.presence==='online'?btn('duel',u.id,'1 ga 1'):u.presence==='playing'?'<button disabled>O\'yinda</button>':'';
      return urow(u,btn('view',u.id,'Profil',1)+duel+btn('rem',u.id,"O'chirish",1));
    }).join(''):'<div class="mut">Hozircha do\'st yo\'q. Username bo\'yicha qidiring.</div>');
    if(fr.outgoing.length)h+=`<h3>Yuborilgan takliflar</h3>`+fr.outgoing.map(u=>urow(u,btn('view',u.id,'Profil',1)+btn('cancel',u.id,'Bekor qilish',1))).join('');
  }
  $('#mbody').innerHTML=h;
}
function openModal(tab){mtab=tab;viewP=null;pend=null;$('#mmsg').textContent='';$('#modal').hidden=false;send({t:'getProfile'});renderModal()}
const closeModal=()=>{$('#modal').hidden=true;viewP=null};
$('#openProf').onclick=()=>openModal('prof');
$('#openProf2').onclick=()=>openModal('prof');
$('#mclose').onclick=closeModal;
$('#tprof').onclick=()=>{mtab='prof';viewP=null;send({t:'getProfile'});renderModal()};
$('#tfr').onclick=()=>{mtab='fr';viewP=null;renderModal()};
function doSearch(){lastQ=$('#sq').value.trim();if(lastQ.length<2){sres=[];renderModal();return}send({t:'searchUser',q:lastQ})}
$('#modal').addEventListener('click',e=>{
  if(e.target.id==='modal'){closeModal();return}
  const t=e.target.closest('[data-act]');if(!t)return;
  const a=t.dataset.act,id=t.dataset.id;$('#mmsg').textContent='';
  if(a==='pick')$('#avf').click();
  else if(a==='save'){saving=true;send({t:'saveProfile',bio:$('#bio').value,avatar:pend})}
  else if(a==='search')doSearch();
  else if(a==='view')send({t:'getProfile',id});
  else if(a==='back'){viewP=null;renderModal()}
  else if(a==='req')send({t:'friendReq',to:id});
  else if(a==='acc')send({t:'friendAccept',from:id});
  else if(a==='dec')send({t:'friendDecline',from:id});
  else if(a==='rem')send({t:'friendRemove',id});
  else if(a==='cancel')send({t:'friendCancel',to:id});
  else if(a==='duel')send({t:'challengeFriend',id});
});
$('#modal').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='sq')doSearch()});
$('#avf').onchange=e=>{
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>{const im=new Image();im.onload=()=>{
    const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d'),sz=Math.min(im.width,im.height);
    x.drawImage(im,(im.width-sz)/2,(im.height-sz)/2,sz,sz,0,0,128,128);
    pend=c.toDataURL('image/jpeg',.8);const b=$('#avbox');if(b)b.innerHTML=avHTML(pend,prof.name)+'<span class="avedit">O\'zgartirish</span>';
  };im.src=r.result};
  r.readAsDataURL(f);e.target.value='';
};
document.addEventListener('click',e=>{if(e.target.closest('#cupstart'))send({t:'cupStart'})});
$('#inviteAccept').onclick=()=>{
  if(inviteId)send({t:'answerChallenge',id:inviteId,accept:true});
  inviteId=null;$('#inviteNotice').hidden=true;
};
$('#inviteDecline').onclick=()=>{
  if(inviteId)send({t:'answerChallenge',id:inviteId,accept:false});
  inviteId=null;$('#inviteNotice').hidden=true;
};
setInterval(()=>send({t:'ping'}),25000);
setInterval(()=>{if(authed&&!$('#mode').hidden){send({t:'listRooms',kind:'league'});send({t:'listRooms',kind:'cup'})}},15000);
(async()=>{
  token=ls.get('shashka_token');
  try{lastEnter=JSON.parse(ls.get('shashka_enter'))}catch(e){}
  if(token){try{await wsOpen();send({t:'resume',token})}catch(e){}}
})();