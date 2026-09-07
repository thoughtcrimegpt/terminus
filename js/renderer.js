/* TERMINUS cinematic renderer. Loaded after simulation.js. */
(function () {
  'use strict';
  const C = { bg:'#071016', road:'#111b20', roadEdge:'#203238', teal:'#35c9ae', amber:'#ffd7a3', coral:'#ff9166', red:'#ff2d46', steel:'#6e8790' };
  let terrain = null, terrainKey = '', quality = 'high', reducedMotion = false, glowAmber = null, glowRed = null, glowTeal = null, fogTex = null;
  let dust = [];
  const districtArt = new Image();
  districtArt.onload = () => { terrainKey = ''; };
  districtArt.src = new URL('../assets/district-07.png', document.currentScript.src).href;

  const TAU = Math.PI * 2;
  const hash = (n) => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const clamp = (n,a,b) => n < a ? a : n > b ? b : n;

  function makeTerrain(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w*dpr)); c.height = Math.max(1, Math.round(h*dpr));
    const g = c.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0);
    g.fillStyle = C.bg; g.fillRect(0,0,w,h);
    if (districtArt.complete && districtArt.naturalWidth) {
      const scale = Math.max(w / districtArt.naturalWidth, h / districtArt.naturalHeight);
      const dw = districtArt.naturalWidth * scale, dh = districtArt.naturalHeight * scale;
      g.drawImage(districtArt, (w-dw)/2, (h-dh)/2, dw, dh);
      g.fillStyle = 'rgba(5,18,24,.22)'; g.fillRect(0,0,w,h);
      return c;
    }

    const cell = Math.max(80, Math.round(Math.min(w,h) / 5));
    // faded survey grid and old coordinate ticks
    g.strokeStyle = 'rgba(71,116,119,.10)'; g.lineWidth = 1;
    for (let x=0;x<w;x+=cell) { g.beginPath(); g.moveTo(x,0); g.lineTo(x,h); g.stroke(); }
    for (let y=0;y<h;y+=cell) { g.beginPath(); g.moveTo(0,y); g.lineTo(w,y); g.stroke(); }
    const roadW = Math.max(22, Math.min(52, Math.round(Math.min(w,h)*.055)));
    const vx = w*.27, vy = h*.57;
    g.fillStyle = C.road; g.fillRect(vx-roadW/2,0,roadW,h); g.fillRect(0,vy-roadW/2,w,roadW);
    g.fillStyle = 'rgba(39,65,67,.32)'; g.fillRect(vx-roadW/2-4,0,4,h); g.fillRect(vx+roadW/2,0,4,h); g.fillRect(0,vy-roadW/2-4,w,4); g.fillRect(0,vy+roadW/2,w,4);
    g.strokeStyle = 'rgba(255,215,163,.30)'; g.lineWidth = 1; g.setLineDash([13,11]);
    g.beginPath(); g.moveTo(vx,0); g.lineTo(vx,h); g.moveTo(0,vy); g.lineTo(w,vy); g.stroke(); g.setLineDash([]);
    // blocks are sparse, translucent and low enough to preserve unit legibility
    const cols = Math.ceil(w/cell)+1, rows = Math.ceil(h/cell)+1;
    for (let r=0;r<rows;r++) for (let col=0;col<cols;col++) {
      const x=col*cell+8, y=r*cell+8, bw=cell-17, bh=cell-17;
      if (x < vx+roadW/2+7 && x+bw > vx-roadW/2-7 || y < vy+roadW/2+7 && y+bh > vy-roadW/2-7) continue;
      const q=hash(col*97+r*131+17); if(q<.22) continue;
      const skew = 4 + hash(col*43+r*71)*5;
      g.fillStyle = q>.78 ? 'rgba(41,67,68,.42)' : 'rgba(25,41,46,.78)';
      g.beginPath();
      g.moveTo(x+2,y+skew); g.lineTo(x+bw-5,y); g.lineTo(x+bw,y+4); g.lineTo(x+bw-2,y+bh-5);
      g.lineTo(x+bw-10,y+bh); g.lineTo(x+3,y+bh-2); g.closePath(); g.fill();
      g.fillStyle = 'rgba(62,92,92,.34)'; g.fillRect(x,y,bw,2); g.fillRect(x,y,2,bh);
      g.fillStyle = 'rgba(4,11,15,.7)';
      for(let k=0;k<3;k++) if(hash(col*17+r*19+k)>.44) g.fillRect(x+8+k*13,y+10+(k%2)*13,5,3);
      g.fillStyle='rgba(105,141,139,.30)';
      if (q>.48) { g.fillRect(x+bw*.22,y+bh*.24,5,3); g.fillRect(x+bw*.68,y+bh*.61,4,4); }
      g.strokeStyle='rgba(128,164,157,.22)'; g.beginPath(); g.moveTo(x+10,y+bh*.58); g.lineTo(x+bw*.35,y+bh*.48); g.lineTo(x+bw*.6,y+bh*.55); g.stroke();
      // shallow isometric ruin shadow and broken roof line
      g.fillStyle='rgba(0,0,0,.42)'; g.beginPath(); g.moveTo(x+skew,y+bh); g.lineTo(x+bw+skew,y+bh); g.lineTo(x+bw,y+bh+skew); g.lineTo(x,y+bh+skew); g.closePath(); g.fill();
      g.strokeStyle='rgba(53,201,174,.12)'; g.beginPath(); g.moveTo(x+5,y+bh-7); g.lineTo(x+bw-5,y+bh-7); g.stroke();
    }
    // intersection markings and abandoned conduits
    g.strokeStyle='rgba(53,201,174,.16)'; g.lineWidth=2;
    g.beginPath(); g.arc(vx,vy,roadW*.82,0,TAU); g.stroke();
    g.strokeStyle='rgba(255,145,102,.15)'; g.lineWidth=1;
    g.beginPath(); g.moveTo(0,h*.18); g.lineTo(w*.18,h*.13); g.moveTo(w*.65,h); g.lineTo(w*.88,h*.72); g.stroke();
    // deterministic roadside wreckage, lamps and road fractures
    for(let i=0;i<34;i++){ const px=hash(i*71+4)*w, py=hash(i*113+8)*h, s=1+hash(i*19)*3; g.fillStyle=i%5===0?'rgba(255,145,102,.45)':'rgba(88,116,118,.42)'; g.fillRect(px,py,s,s*.55); if(i%7===0){g.fillStyle='rgba(255,215,163,.18)';g.beginPath();g.arc(px,py,8,0,TAU);g.fill();} }
    g.strokeStyle='rgba(2,8,11,.72)'; g.lineWidth=1; for(let i=0;i<15;i++){const px=hash(i*47+9)*w,py=hash(i*89+2)*h;g.beginPath();g.moveTo(px,py);g.lineTo(px+hash(i*13)*18-9,py+hash(i*31)*12);g.stroke();}
    g.font='600 9px ui-monospace,monospace'; g.fillStyle='rgba(132,193,185,.43)';
    g.fillText('TRANSIT SPINE', Math.min(w-120,vx+12), Math.max(14,vy- roadW*.65));
    g.fillStyle='rgba(255,145,102,.34)'; g.fillText('RECLAMATION ZONE', 14, Math.min(h-8,vy+roadW*.9));
    g.font='8px ui-monospace,monospace'; g.fillStyle='rgba(113,148,150,.34)';
    for(let i=0;i<6;i++){ const xx=18+i*(w-36)/5; g.fillText('0'+(i+1),xx,12); }
    return c;
  }
  function ensureTerrain() {
    const key = W+'x'+H+'@'+Math.min(window.devicePixelRatio||1,2);
    if (key !== terrainKey) { terrain = makeTerrain(W,H); terrainKey = key; dust=[]; for(let i=0;i<90;i++) dust.push({x:hash(i*7)*W,y:hash(i*13+9)*H,s:.3+hash(i*29)*1.1,p:hash(i*37)}); makeSprites(); }
  }
  function makeSprites(){
    const sprite=(color,alpha,size)=>{const c=document.createElement('canvas');c.width=c.height=size*2;const g=c.getContext('2d'),q=g.createRadialGradient(size,size,0,size,size,size);q.addColorStop(0,color.replace(')',','+alpha+')').replace('rgb','rgba'));q.addColorStop(1,color.replace(')',',0)').replace('rgb','rgba'));g.fillStyle=q;g.fillRect(0,0,size*2,size*2);return c;};
    glowAmber=sprite('rgb(255,180,100)',.28,26); glowRed=sprite('rgb(255,45,70)',.22,26); glowTeal=sprite('rgb(53,201,174)',.18,34);
    fogTex=document.createElement('canvas');fogTex.width=320;fogTex.height=180;const f=fogTex.getContext('2d');for(let i=0;i<15;i++){const x=hash(i*7)*320,y=hash(i*17)*180,r=18+hash(i*31)*42,q=f.createRadialGradient(x,y,0,x,y,r);q.addColorStop(0,'rgba(104,177,171,.10)');q.addColorStop(1,'rgba(104,177,171,0)');f.fillStyle=q;f.fillRect(x-r,y-r,r*2,r*2);}
  }
  function drawScrapCapped() {
    if(!scrap || !COLS) return; const stride = quality==='low' ? 3 : 2, max=quality==='low'?1500:3000;
    ctx.fillStyle='rgba(53,201,174,.24)'; let n=0;
    for(let i=0;i<scrap.length && n<max;i+=stride) if(scrap[i]>.55){ const x=(i%COLS)*CELL+CELL*.5,y=((i/COLS)|0)*CELL+CELL*.5; ctx.fillRect(x,y,1.7,1.7); n++; }
  }
  function drawOps(t) {
    const op = typeof OPS==='object' ? OPS : null; if(!op) return;
    for(const s of (op.shelters||[])){ const life=clamp((s.life??s.maxLife??1)/(s.maxLife||1),0,1), r=s.r||62; if(glowTeal)ctx.drawImage(glowTeal,s.x-34,s.y-34); ctx.save(); ctx.translate(s.x,s.y); ctx.strokeStyle='rgba(53,201,174,'+(0.34+life*.4)+')'; ctx.lineWidth=1.5; ctx.beginPath(); for(let i=0;i<6;i++){const a=i*TAU/6-Math.PI/6; const x=Math.cos(a)*r,y=Math.sin(a)*r; i?ctx.lineTo(x,y):ctx.moveTo(x,y);} ctx.closePath(); ctx.stroke(); ctx.fillStyle='rgba(53,201,174,.055)'; ctx.fill(); ctx.setLineDash([5,7]); ctx.beginPath();ctx.arc(0,0,r*.86,-t*.25,t*-.25+TAU*.7);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#c7fff0';ctx.fillRect(-2,-r*.5,4,r*.5);ctx.strokeStyle='rgba(191,255,239,.5)';ctx.beginPath();ctx.arc(0,-r*.5,4,0,TAU);ctx.stroke();ctx.strokeStyle='rgba(53,201,174,.55)';ctx.beginPath();ctx.arc(0,0,r+5,-Math.PI/2,-Math.PI/2+TAU*clamp(s.hp/100,0,1));ctx.stroke();ctx.restore(); }
    for(const b of (op.beacons||[])){ const life=clamp((b.life??b.maxLife??1)/(b.maxLife||1),0,1), r=b.r||135, lure=b.type==='lure'; if(glowAmber)ctx.drawImage(glowAmber,b.x-26,b.y-26);ctx.strokeStyle=(lure?'rgba(255,145,102,':'rgba(255,215,163,')+(life*.32)+')';ctx.lineWidth=1;ctx.setLineDash(lure?[2,8]:[2,6]);ctx.beginPath();ctx.arc(b.x,b.y,r,0,TAU);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=lure?'#ff9166':'#ffd7a3';ctx.fillRect(b.x-2,b.y-2,4,4); }
    for(const p of (op.pulses||[])){ const k=1-clamp((p.t??0)/(p.maxT||1),0,1), r=(p.r||110)*(1-k)+8, emp=p.type==='emp'; ctx.strokeStyle=(emp?'rgba(105,191,255,':'rgba(53,201,174,')+(k*.65)+')';ctx.lineWidth=emp?2.5:2;ctx.beginPath();ctx.arc(p.x,p.y,r,0,TAU);ctx.stroke(); }
  }
  function drawHumansCinematic() {
    if(humans.length > 1200) { drawHumans(); return; }
    // Cloaked field operatives with bright helmet lamps, role bands, and a walking stride.
    const colors = {scavenger:'#ebc185', medic:'#98dacb', engineer:'#e5a07a'};
    const stride = humans.length > 1300 ? 1 : 1.2;
    for(let i=0;i<humans.length;i++) {
      const a=humans[i]; if(a.dead) continue;
      const x=a.x,y=a.y, color=colors[a.role]||colors.scavenger;
      const step = Math.sin(a.ph)*1.3;
      if (quality==='high' && i%9===0 && i<1000 && glowAmber) {
        ctx.globalAlpha=.5;ctx.drawImage(glowAmber,x-18,y-20,36,36);ctx.globalAlpha=1;
      }
      ctx.strokeStyle='#25323a';ctx.lineWidth=2.5;
      ctx.beginPath();ctx.moveTo(x-1,y+1);ctx.lineTo(x-2+step,y+4);ctx.moveTo(x+1,y+1);ctx.lineTo(x+2-step,y+4);ctx.stroke();
      ctx.fillStyle=a.panic>.35?'#b56c4e':'#48524b';
      ctx.beginPath();ctx.moveTo(x,y-3);ctx.lineTo(x-3*stride,y+2);ctx.lineTo(x+2.8*stride,y+2.8);ctx.closePath();ctx.fill();
      ctx.fillStyle=color;ctx.fillRect(x-2.5,y-1,5,1.4);
      ctx.fillStyle='#1a252b';ctx.fillRect(x-1.7,y-4.6,3.4,3);
      ctx.fillStyle='#f4e1b8';ctx.fillRect(x-1.6,y-4.5,3.2,1.9);
      ctx.fillStyle=color;ctx.fillRect(x+2,y-.7,1.5,1.4);
      if(a.shelter){ctx.fillStyle='#7ae4c0';ctx.fillRect(x-1,y+6,2,1);}
    }
  }
  function drawMachinesCinematic(t) {
    const limit=quality==='low'?1000:2000; for(let i=0;i<machines.length && i<limit;i++){const m=machines[i],x=m.x,y=m.y,ang=m.a||0,kind=m.kind||(i%11===0?'titan':i%3===0?'hunter':'scout'), disabled=m.disabled>0; const scale=kind==='titan'?1.9:kind==='hunter'?1.35:1;
      if(!disabled && (kind!=='scout'||i%3===0)){if(glowRed)ctx.drawImage(glowRed,x-26,y-26);ctx.save();ctx.translate(x,y);ctx.rotate(ang);ctx.fillStyle=kind==='titan'?'rgba(255,45,70,.09)':'rgba(255,45,70,.055)';ctx.beginPath();ctx.moveTo(4*scale,0);ctx.arc(0,0,kind==='titan'?90:kind==='hunter'?55:34,-.19,.19);ctx.closePath();ctx.fill();ctx.restore();}
      ctx.save();ctx.translate(x,y);ctx.rotate(ang);ctx.fillStyle=disabled?'#46545b':kind==='titan'?'#55202a':kind==='hunter'?'#40151c':'#29161d';ctx.strokeStyle=disabled?'#74848a':kind==='titan'?'#ff6a62':kind==='hunter'?'#ff4257':'#c93349';ctx.lineWidth=1;ctx.beginPath(); if(kind==='titan'){const leg=Math.sin(simTime*4+i)*2;ctx.rect(-5*scale,-4*scale,10*scale,8*scale);ctx.moveTo(-7*scale,-4*scale);ctx.lineTo(-10*scale,-8*scale+leg);ctx.moveTo(7*scale,-4*scale);ctx.lineTo(10*scale,-8*scale-leg);ctx.moveTo(-7*scale,4*scale);ctx.lineTo(-10*scale,8*scale-leg);ctx.moveTo(7*scale,4*scale);ctx.lineTo(10*scale,8*scale+leg);}else{ctx.moveTo(6*scale,0);ctx.lineTo(-4*scale,4*scale);ctx.lineTo(-2*scale,0);ctx.lineTo(-4*scale,-4*scale);ctx.closePath();}ctx.fill();ctx.stroke();ctx.fillStyle=disabled?'#89999b':'#ffb1a1';ctx.fillRect(2*scale,-1.2,2.2*scale,2.4);ctx.restore();
    }
  }
  function drawAtmosphere(t) { if(reducedMotion||quality==='low') return; const storm=typeof OPS==='object'&&OPS.storm; if(fogTex){ctx.save();ctx.globalAlpha=storm?.5:.32;ctx.globalCompositeOperation='screen';ctx.drawImage(fogTex,((t*5)%W)-W*.25,((t*2)%H)-H*.2,W*1.5,H*1.3);ctx.restore();}ctx.save();ctx.globalAlpha=storm?.3:.14;ctx.strokeStyle=storm?'#9bd6cb':'#789b9d';ctx.lineWidth=.7;for(const d of dust){const x=(d.x+t*d.s*8)%W,y=(d.y+t*d.s*18)%H;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-(storm?3:1),y+(storm?8:3));ctx.stroke();}ctx.restore(); if(storm){ctx.fillStyle='rgba(112,219,195,.025)';ctx.fillRect(0,0,W,H);ctx.strokeStyle='rgba(126,222,209,.12)';ctx.lineWidth=1;const sy=(t*36)%H;ctx.beginPath();ctx.moveTo(0,sy);ctx.lineTo(W,sy);ctx.stroke();} }
  function drawVignette(){const g=ctx.createRadialGradient(W*.5,H*.48,Math.min(W,H)*.2,W*.5,H*.48,Math.max(W,H)*.72);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(.7,'rgba(0,0,0,.06)');g.addColorStop(1,'rgba(0,0,0,.62)');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);}
  render = function(){ const t=reducedMotion?0:simTime; ensureTerrain();ctx.clearRect(0,0,W,H);ctx.drawImage(terrain,0,0,W,H);drawScrapCapped();
    // static population shadows keep the world grounded without per-unit gradients
    ctx.fillStyle='rgba(0,0,0,.33)';ctx.beginPath();for(let i=0;i<humans.length;i++){const a=humans[i];ctx.moveTo(a.x+3.3,a.y+3);ctx.ellipse(a.x+1,a.y+3,2.3,1,0,0,TAU);}for(let i=0;i<machines.length;i++){const a=machines[i];ctx.moveTo(a.x+6,a.y+4);ctx.ellipse(a.x+2,a.y+4,4,1.8,0,0,TAU);}ctx.fill();
    if(typeof drawCorpses==='function') drawCorpses(); if(typeof drawFx==='function') drawFx(); drawOps(t);drawHumansCinematic();drawMachinesCinematic(t);drawAtmosphere(t);drawVignette();if(hoverOn)drawCursor();
  };
  drawCursor = function(){const r=(typeof COMMANDS==='object'&&COMMANDS[tool]&&COMMANDS[tool].radius)||((BRUSH&&BRUSH[tool])||24);ctx.save();ctx.strokeStyle=tool==='machine'?'rgba(255,45,70,.65)':tool==='scrap'?'rgba(53,201,174,.65)':'rgba(255,215,163,.65)';ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.beginPath();ctx.arc(mx,my,r,0,TAU);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='rgba(255,255,255,.5)';ctx.fillRect(mx-1,my-1,2,2);ctx.restore();};
  window.TerminusRenderer={setQuality(q){quality=q==='low'?'low':'high';},setReducedMotion(v){reducedMotion=!!v;},get quality(){return quality;}};
})();
