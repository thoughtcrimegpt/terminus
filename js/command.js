/* Command center presentation and agent inspection. No simulation rules live here. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const toolCopy = {
    inspect: ['Observe & inspect', 'Click a signal to inspect its behavior.'],
    human: ['Seed survivor signals', 'Click and drag to introduce survivors.'],
    machine: ['Deploy hostile units', 'Click and drag to introduce machines.'],
    scrap: ['Replenish the ruins', 'Click and drag to paint resource caches.'],
    clear: ['Clear a region', 'Click and drag to remove agents and resources.'],
    shelter: ['Refuge dome · 40 power', 'Click to place a refuge. Lasts up to 75 seconds.'],
    emp: ['EMP strike · 30 power', 'Click to disable machines in range for 8 seconds.'],
    lure: ['Ghost signal · 20 power', 'Click to draw nearby machines away for 20 seconds.'],
    supply: ['Supply drop · 25 power', 'Click to replenish nearby resources and survivor energy.']
  };
  let selected = null, selectedType = null, lastTool = '', lastMissions = '', lastScenario = '';
  let modalResume = false, lastReport = null;
  function modalOpen(id) {
    if (document.querySelector('dialog[open]')) return;
    modalResume = running;
    setRunning(false);
    $(id).showModal();
  }
  for (const [button, dialog] of [['btnSettings','settingsDialog'], ['btnHelp','helpDialog']]) {
    $(button).onclick = () => modalOpen(dialog);
    $(dialog).addEventListener('close', () => { if (modalResume) setRunning(true); $(button).setAttribute('aria-expanded','false'); });
  }
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).close());
  document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => { P.speed = Number(b.dataset.speed); syncSliders(); });
  $('effects').onchange = e => TerminusRenderer.setQuality(e.target.checked ? 'high' : 'low');
  $('reducedMotion').checked = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  TerminusRenderer.setReducedMotion($('reducedMotion').checked);
  $('reducedMotion').onchange = e => TerminusRenderer.setReducedMotion(e.target.checked);
  $('btnFullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.querySelector('.feed-panel').requestFullscreen) await document.querySelector('.feed-panel').requestFullscreen();
      else document.body.classList.toggle('expanded');
    } catch (_) { document.body.classList.toggle('expanded'); }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden && running) setRunning(false); });
  document.addEventListener('keydown', e => {
    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { e.preventDefault(); if (!$('helpDialog').open) modalOpen('helpDialog'); }
  });
  cv.addEventListener('pointerdown', e => {
    if (tool !== 'inspect') return;
    const [x,y] = pos(e);
    let nearest = null, type = null, best = 28*28;
    for (const a of humans) { const d=(a.x-x)**2+(a.y-y)**2; if (!a.dead && d<best) {nearest=a;type='human';best=d;} }
    for (const a of machines) { const d=(a.x-x)**2+(a.y-y)**2; if (d<best) {nearest=a;type='machine';best=d;} }
    selected=nearest;selectedType=type;
    updateInspector();
  });
  document.querySelectorAll('.tool').forEach(button => button.addEventListener('click', () => {
    if (window.matchMedia('(max-width: 800px)').matches) {
      stage.scrollIntoView({behavior: $('reducedMotion').checked ? 'auto' : 'smooth', block: 'center'});
    }
  }));
  const cinematicRender = render;
  render = function () {
    cinematicRender();
    if (!selected) return;
    const list = selectedType === 'human' ? humans : machines;
    if (selected.dead || !list.includes(selected)) { selected=null; updateInspector(); return; }
    ctx.save();
    ctx.strokeStyle=selectedType==='human'?'#edc18a':'#f18b71';ctx.lineWidth=1;
    const x=selected.x,y=selected.y;const r=selected.kind==='titan'?24:13;
    for(let n=0;n<4;n++) {const a=n*Math.PI/2+.2;ctx.beginPath();ctx.arc(x,y,r,a,a+.7);ctx.stroke();}
    ctx.restore();
  };
  function updateInspector() {
    if (!selected) {
      $('inspectTitle').textContent='SIGNAL INTELLIGENCE';
      $('inspectBody').innerHTML='<p>Select a survivor or machine to reveal its role, energy, and current behavior.</p><div class="entity-key"><span><i class="dot h"></i> HUMAN</span><span><i class="dot m"></i> MACHINE</span><span><i class="dot s"></i> RESOURCE</span></div>';
      return;
    }
    const h=selectedType==='human';
    const behavior=h?(selected.shelter?'Sheltered':selected.panic>.35?'Fleeing':selected.role==='medic'?'Field support':'Scavenging'):(selected.disabled>0?'EMP disabled':selected.lured?'Decoy tracking':selected.lock?'Pursuing':'Searching');
    $('inspectTitle').textContent=(h?'HUMAN / ':'MACHINE / ')+(selected.role||selected.kind||'unknown').toUpperCase();
    const rows=[['STATUS',behavior],['ENERGY',Math.max(0,Math.round(selected.e))],['AGE',Math.floor(selected.age)+'s'],['COORDINATES',Math.round(selected.x)+', '+Math.round(selected.y)]];
    $('inspectBody').innerHTML='<div class="inspect-details">'+rows.map(([k,v])=>'<div><small>'+k+'</small><b>'+v+'</b></div>').join('')+'</div>';
  }
  function refresh() {
    $('opsCredits').textContent=Math.floor(OPS.credits);
    $('powerBar').style.width=(OPS.credits/OPS.maxCredits*100)+'%';
    $('stormStatus').textContent=OPS.storm?'ION STORM ACTIVE':'ION FRONT';
    $('stormCountdown').textContent=Math.max(0,Math.ceil(OPS.storm?OPS.stormTime:OPS.nextStorm))+'s';
    document.querySelector('.weather-chip').classList.toggle('storm-active',OPS.storm);
    $('feedState').textContent=running&&P.speed>0?'OBSERVING':'FEED PAUSED';
    document.querySelectorAll('[data-speed]').forEach(b=>b.classList.toggle('active',P.speed===Number(b.dataset.speed)));
    if (lastScenario!==selectedScenario) {
      document.querySelectorAll('.preset').forEach(b=>{b.classList.toggle('active',b.dataset.p===selectedScenario);b.setAttribute('aria-pressed',String(b.dataset.p===selectedScenario));});
      lastScenario=selectedScenario;
    }
    if (lastTool!==tool) {
      const info=toolCopy[tool]||toolCopy.inspect;
      $('toolName').textContent=info[0];$('toolDescription').textContent=info[1];
      document.querySelectorAll('.tool').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.t===tool)));
      lastTool=tool;
      lastReport=OPS.lastAction;
    }
    if (OPS.lastAction && OPS.lastAction!==lastReport) {
      $('toolDescription').textContent=OPS.lastAction.text;lastReport=OPS.lastAction;
    } else if (!OPS.lastAction && lastReport) {
      $('toolDescription').textContent=(toolCopy[tool]||toolCopy.inspect)[1];lastReport=null;
    }
    document.querySelectorAll('.command').forEach(b=>{
      const c=COMMANDS[b.dataset.t], cooldown=typeof commandReady==='object'?commandReady[b.dataset.t]:0;
      b.classList.toggle('unavailable',OPS.credits<c.cost||cooldown>0);
      b.querySelector('.cost').innerHTML=(cooldown>0?cooldown.toFixed(1)+'s':c.cost)+'<kbd>'+({shelter:5,emp:6,lure:7,supply:8}[b.dataset.t])+'</kbd>';
    });
    const objectives=OPS.objectives||[
      {title:'A place to survive',detail:'Shelter 10 survivors at once.',done:false},
      {title:'Break the hunting network',detail:'Disable 3 machines with EMP strikes.',done:false},
      {title:'Outlast the silence',detail:'Keep human signals alive for 2 minutes.',done:false}
    ];
    const markup=objectives.map((o,i)=>{
      const progress=Math.max(0,Math.min(1,o.progress||0));
      const value=o.done?'Complete':o.id==='refuge'?Math.round(progress*10)+' / 10 sheltered'
        :o.id==='emp'?Math.min(3,OPS.empHits)+' / 3 disabled':Math.floor(OPS.survivalTime||0)+' / 120s alive';
      return '<div class="mission-row '+(o.done?'complete':'')+'"><span class="mission-marker">'+(o.done?'✓':String(i+1).padStart(2,'0'))+'</span><div class="mission-content"><b>'+o.title+'</b><p>'+o.detail+'</p><div class="mission-meter" role="progressbar" aria-label="'+o.title+'" aria-valuenow="'+Math.round(progress*100)+'" aria-valuemin="0" aria-valuemax="100"><i style="width:'+(progress*100)+'%"></i></div><span class="mission-value">'+value+'</span></div></div>';
    }).join('');
    if (markup!==lastMissions) {$('missionList').innerHTML=markup;lastMissions=markup;}
    $('objectiveProgress').textContent=objectives.filter(o=>o.done).length+' / '+objectives.length;
    const targeting=hoverOn && ['shelter','emp','lure','supply'].includes(tool);
    const preview=$('targetPreview');preview.hidden=!targeting;
    if(targeting) {
      const impact=commandImpact(tool,mx,my), cd=commandReady[tool];
      const units=tool==='emp'||tool==='lure';
      const count=units?impact.units:impact.people;
      const effect=count+' '+(units?(count===1?'machine':'machines'):(count===1?'survivor':'survivors'))+' in range';
      const paused=!running||P.speed===0;
      const readiness=cd>0?(paused?'Paused · resume to recharge':'Recharging '+cd.toFixed(1)+'s'):OPS.credits<impact.cost?(paused?'Paused · resume to restore power':'Need '+Math.ceil(impact.cost-OPS.credits)+' more power'):impact.cost+' power · click to deploy';
      preview.textContent=effect+' / '+readiness;
      preview.classList.toggle('unavailable',cd>0||OPS.credits<impact.cost);
    }
    updateInspector();
  }
  refresh();setInterval(refresh,200);
})();
