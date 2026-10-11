(function(root){

const DIRS=[[-1,-1],[-1,1],[1,-1],[1,1]];
const inb=(r,c)=>r>=0&&r<10&&c>=0&&c<10;
const sq=i=>String.fromCharCode(97+i%10)+(10-Math.floor(i/10));
function initBoard(){let s='';for(let r=0;r<10;r++)for(let c=0;c<10;c++)s+=(r+c)%2?(r<4?'b':r>5?'w':'.'):'.';return s}
function capSeq(b,r,c,col,k,capd,path){
  const res=[];
  for(const [dr,dc] of DIRS){
    let rr=r+dr,cc=c+dc;
    if(k)while(inb(rr,cc)&&b[rr*10+cc]==='.'){rr+=dr;cc+=dc}
    if(!inb(rr,cc))continue;
    const i=rr*10+cc,q=b[i];
    if(q==='.'||q.toLowerCase()===col||capd.includes(i))continue;
    let lr=rr+dr,lc=cc+dc;
    while(inb(lr,lc)&&b[lr*10+lc]==='.'){
      const L=lr*10+lc,nc=[...capd,i],np=[...path,L];
      const sub=capSeq(b,lr,lc,col,k,nc,np);
      if(sub.length)res.push(...sub);else res.push({path:np,caps:nc});
      if(!k)break;
      lr+=dr;lc+=dc;
    }
  }
  return res;
}
function allCaps(b,col){
  const out=[];
  b.forEach((p,i)=>{
    if(p==='.'||p.toLowerCase()!==col)return;
    const c2=b.slice();c2[i]='.';
    capSeq(c2,Math.floor(i/10),i%10,col,p!==col,[],[i]).forEach(s=>out.push({from:i,...s}));
  });
  return out;
}
function simple(b,i){
  const p=b[i],col=p.toLowerCase(),k=p!==col,r=Math.floor(i/10),c=i%10,o=[];
  for(const [dr,dc] of DIRS){
    if(!k&&dr!==(col==='w'?-1:1))continue;
    let rr=r+dr,cc=c+dc;
    while(inb(rr,cc)&&b[rr*10+cc]==='.'){o.push(rr*10+cc);if(!k)break;rr+=dr;cc+=dc}
  }
  return o;
}
function hasMove(b,col){
  if(allCaps(b,col).length)return true;
  return b.some((p,i)=>p!=='.'&&p.toLowerCase()===col&&simple(b,i).length);
}
function dests(b,col,from){
  const o=allCaps(b,col).filter(s=>s.from===from).map(s=>s.path[s.path.length-1]);
  return [...o,...simple(b,from)];
}
function play(g,from,to,name){
  const col=g.turn,opp=col==='w'?'b':'w',b=g.board.split('');
  const caps=allCaps(b,col);
  const s=caps.find(x=>x.from===from&&x.path[x.path.length-1]===to);
  const p=b[from];b[from]='.';
  if(s)s.caps.forEach(i=>b[i]='.');
  const man=p===p.toLowerCase();
  b[to]=(man&&((col==='w'&&to<10)||(col==='b'&&to>=90)))?p.toUpperCase():p;
  let msg='';
  if(!s&&caps.length){
    const cand=[...new Set(caps.map(x=>x.from))];
    const victim=cand.includes(from)?to:cand[0];
    b[victim]='.';
    msg=`Chippaki! ${name} urishi kerak edi, ${sq(victim)} dagi dona raqibga berildi.`;
  }
  const cnt=c=>b.filter(x=>x.toLowerCase()===c).length;
  const wc=cnt('w'),bc=cnt('b');
  let status='playing',result='';
  if(wc===1&&bc===1&&!b.includes('W')&&!b.includes('B')){status='done';result='d'}
  else if(cnt(opp)===0||!hasMove(b,opp)){status='done';result=col}
  return {board:b.join(''),turn:status==='playing'?opp:col,status,result,wl:wc,bl:bc,msg};
}


const E={initBoard,allCaps,simple,hasMove,dests,play,sq};
if(typeof module!=='undefined'&&module.exports)module.exports=E;else root.Engine=E;
})(typeof self!=='undefined'?self:this);
