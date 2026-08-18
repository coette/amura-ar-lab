import { readFile, writeFile } from 'node:fs/promises';

const indexPath = 'dist/index.html';
let html = await readFile(indexPath, 'utf8');

function replaceRequired(oldText, newText, label) {
  if (!html.includes(oldText)) throw new Error(`V2.2: no se encontró ${label}`);
  html = html.replace(oldText, newText);
}

replaceRequired(
  '<div id="buildBadge">BUILD V2 · SWEEP KEYFRAMES · 0→180</div>',
  '<div id="buildBadge">BUILD V2.2 · 1+6+1S SWEEP · 0→180</div>',
  'badge V2'
);

replaceRequired(
  '</style>',
  `#scanProgress{position:absolute;z-index:55;left:50%;top:calc(max(12px,env(safe-area-inset-top)) + 82px);transform:translateX(-50%);width:min(86vw,480px);display:none;pointer-events:none;text-shadow:0 2px 10px rgba(0,0,0,.9)}\n#scanLabels{display:flex;justify-content:space-between;align-items:center;font-size:10px;font-weight:800;letter-spacing:.08em;margin-bottom:7px;color:rgba(255,255,255,.92)}\n#scanTrack{position:relative;height:8px;border-radius:999px;background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.38);overflow:visible}\n#scanFill{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:999px;background:#fff}\n#scanDot{position:absolute;top:50%;left:0;width:18px;height:18px;border-radius:50%;transform:translate(-50%,-50%);background:#b078ff;border:2px solid #fff;box-shadow:0 2px 12px rgba(0,0,0,.8)}\n#scanSeconds{text-align:center;margin-top:7px;font-size:12px;font-weight:800;letter-spacing:.08em}\n</style>`,
  'cierre style'
);

replaceRequired(
  '<div id="top"><div id="brand">AMURA · ORB V2 · SWEEP</div><div id="subtitle">DORSO arriba · pulsa ESCANEAR y gira lentamente hasta PALMA</div></div>',
  `<div id="top"><div id="brand">AMURA · ORB V2 · SWEEP</div><div id="subtitle">DORSO arriba · pulsa ESCANEAR · 1 s quieto + 6 s giro + 1 s quieto</div></div>\n  <div id="scanProgress"><div id="scanLabels"><span>DORSO · 0°</span><span>PERFIL · 90°</span><span>PALMA · 180°</span></div><div id="scanTrack"><div id="scanFill"></div><div id="scanDot"></div></div><div id="scanSeconds">DORSO · MANTÉN</div></div>`,
  'cabecera V2'
);

replaceRequired(
  '<p>Coloca DORSO en la guía. Pulsa iniciar y gira lentamente la muñeca hasta PALMA. Pulsa terminar al llegar. V2 aprenderá automáticamente los keyframes útiles y puenteará la zona muerta del perfil.</p>',
  '<p>Coloca DORSO en la guía. Al pulsar iniciar mantén 1 segundo quieto, sigue la barra durante 6 segundos hasta PALMA y mantén PALMA 1 segundo. Después entran automáticamente el reloj y la tríada.</p>',
  'instrucciones V2'
);

replaceRequired(
  "const AMURA_BUILD='V2-SWEEP-KEYFRAMES-20260818';",
  "const AMURA_BUILD='V2.2-1-6-1-SWEEP-20260818';",
  'AMURA_BUILD V2'
);

replaceRequired(
  'const SCAN_SAMPLE_MS=120;\nconst MAX_SCAN_FRAMES=48;\nconst MAX_KEYFRAMES=18;',
  'const SCAN_SAMPLE_MS=120;\nconst MAX_SCAN_FRAMES=80;\nconst MAX_KEYFRAMES=18;\nconst SCAN_HOLD_START_MS=1000;\nconst SCAN_MOVE_MS=6000;\nconst SCAN_HOLD_END_MS=1000;\nconst SCAN_TOTAL_MS=SCAN_HOLD_START_MS+SCAN_MOVE_MS+SCAN_HOLD_END_MS;',
  'constantes escaneo V2'
);

replaceRequired(
  "if(mode!=='ready'||!latestLandmarks)return;",
  "if((mode!=='ready'&&mode!=='scanning')||!latestLandmarks)return;",
  'guard drawLandmarks'
);

replaceRequired(
  `function updateCaptureUI(){\n  if(mode==='scanning'){\n    captureBtn.textContent='TERMINAR EN PALMA';\n    subtitle.textContent='ESCANEANDO · gira lentamente hasta PALMA';\n  }else{\n    captureBtn.textContent='INICIAR ESCANEO';\n    subtitle.textContent='DORSO arriba · pulsa ESCANEAR y gira lentamente hasta PALMA';\n  }\n}`,
  `function updateCaptureUI(){\n  if(mode==='scanning'){\n    captureBtn.textContent='CALIBRANDO 8 s…';\n    subtitle.textContent='DORSO · MANTÉN QUIETO';\n  }else{\n    captureBtn.textContent='INICIAR ESCANEO';\n    subtitle.textContent='DORSO arriba · pulsa ESCANEAR · después sigue la barra';\n  }\n}`,
  'updateCaptureUI V2'
);

replaceRequired(
  `  mode='scanning';\n  captureBtn.disabled=false;camBtn.disabled=true;\n  flash.classList.remove('go');void flash.offsetWidth;flash.classList.add('go');\n  updateCaptureUI();`,
  `  mode='scanning';\n  captureBtn.disabled=true;camBtn.disabled=true;\n  const scanProgress=document.getElementById('scanProgress');\n  const scanFill=document.getElementById('scanFill');\n  const scanDot=document.getElementById('scanDot');\n  const scanSeconds=document.getElementById('scanSeconds');\n  if(scanProgress)scanProgress.style.display='block';\n  if(scanFill)scanFill.style.width='0%';\n  if(scanDot)scanDot.style.left='0%';\n  if(scanSeconds)scanSeconds.textContent='DORSO · MANTÉN';\n  flash.classList.remove('go');void flash.offsetWidth;flash.classList.add('go');\n  updateCaptureUI();`,
  'inicio scanning V2'
);

replaceRequired(
  `  let selected=[usable[0]];\n  for(let i=1;i<usable.length-1;i++){\n    const cur=usable[i],last=selected[selected.length-1];\n    const totalT=Math.max(1,usable[usable.length-1].t-usable[0].t);\n    const prog=(cur.t-usable[0].t)/totalT;\n    const profile=prog>.38&&prog<.62;\n    const sim=appearanceSimilarity(last.ref,cur.ref);\n    const gap=cur.t-last.t;\n    if(sim<(profile?.54:.43)||gap>(profile?300:520))selected.push(cur);\n  }\n  const tail=usable[usable.length-1];\n  if(selected[selected.length-1]!==tail)selected.push(tail);`,
  `  const startPool=usable.filter(x=>x.t>=280&&x.t<=900);\n  const startHand=startPool.filter(x=>x.handSeen);\n  const stableStart=(startHand.length?startHand:startPool).sort((a,b)=>b.ref.n-a.ref.n)[0]||usable[0];\n  let selected=[stableStart];\n  for(let i=1;i<usable.length-1;i++){\n    const cur=usable[i],last=selected[selected.length-1];\n    if(cur.t<=last.t)continue;\n    const prog=Math.max(0,Math.min(1,(cur.t-SCAN_HOLD_START_MS)/SCAN_MOVE_MS));\n    const profile=prog>.38&&prog<.62;\n    const sim=appearanceSimilarity(last.ref,cur.ref);\n    const gap=cur.t-last.t;\n    if(sim<(profile?.54:.43)||gap>(profile?300:520))selected.push(cur);\n  }\n  const endPool=usable.filter(x=>x.t>=SCAN_HOLD_START_MS+SCAN_MOVE_MS+180);\n  const endHand=endPool.filter(x=>x.handSeen);\n  const tail=(endHand.length?endHand:endPool).sort((a,b)=>b.ref.n-a.ref.n)[0]||usable[usable.length-1];\n  if(selected[selected.length-1]!==tail)selected.push(tail);\n\n  const forcedTargets=[0,.12,.24,.36,.43,.47,.53,.57,.64,.76,.88,1];\n  const forced=[];\n  for(const target of forcedTargets){\n    const targetT=target<=0?650:target>=1?SCAN_HOLD_START_MS+SCAN_MOVE_MS+650:SCAN_HOLD_START_MS+target*SCAN_MOVE_MS;\n    let pool=usable.filter(x=>Math.abs(x.t-targetT)<=420);\n    if(!pool.length)pool=usable.slice();\n    const withHand=pool.filter(x=>x.handSeen);\n    if(withHand.length)pool=withHand;\n    pool.sort((a,b)=>{\n      const da=Math.abs(a.t-targetT),db=Math.abs(b.t-targetT);\n      if(Math.abs(da-db)>70)return da-db;\n      return b.ref.n-a.ref.n;\n    });\n    const pick=pool[0];\n    if(pick){pick._forced=true;forced.push(pick)}\n  }\n  selected=[...new Set([...selected,...forced])].sort((a,b)=>a.t-b.t);`,
  'selector keyframes V2'
);

replaceRequired(
  `      const p=(selected[i].t-selected[0].t)/Math.max(1,selected[selected.length-1].t-selected[0].t);\n      if(p>.40&&p<.60)continue;`,
  `      const p=Math.max(0,Math.min(1,(selected[i].t-SCAN_HOLD_START_MS)/SCAN_MOVE_MS));\n      if(selected[i]._forced||(p>.40&&p<.60))continue;`,
  'protección keyframes forzados'
);

replaceRequired(
  `  const t0=selected[0].t,t1=Math.max(t0+1,selected[selected.length-1].t);\n  for(const x of raw){try{x.ref.kp.delete();x.ref.desc.delete()}catch(e){}}\n\n  banks=[];\n  for(let i=0;i<selected.length;i++){\n    const f=selected[i];\n    const progress=Math.max(0,Math.min(1,(f.t-t0)/(t1-t0)));`,
  `  for(const x of raw){try{x.ref.kp.delete();x.ref.desc.delete()}catch(e){}}\n\n  banks=[];\n  for(let i=0;i<selected.length;i++){\n    const f=selected[i];\n    const progress=Math.max(0,Math.min(1,(f.t-SCAN_HOLD_START_MS)/SCAN_MOVE_MS));`,
  'mapeo temporal 0-180 V2'
);

replaceRequired(
  `  mode='preparing';\n  guideWrap.style.display='none';`,
  `  mode='preparing';\n  const scanProgress=document.getElementById('scanProgress');\n  if(scanProgress)scanProgress.style.display='none';\n  guideWrap.style.display='none';`,
  'finishSweep preparing'
);

replaceRequired(
  `  guideWrap.style.display='block';captureBtn.classList.remove('hidden');resetBtn.classList.add('hidden');captureBtn.disabled=false;camBtn.disabled=false;updateCaptureUI();if(watchRoot)watchRoot.visible=false;`,
  `  guideWrap.style.display='block';captureBtn.classList.remove('hidden');resetBtn.classList.add('hidden');captureBtn.disabled=false;camBtn.disabled=false;\n  const scanProgress=document.getElementById('scanProgress');const scanFill=document.getElementById('scanFill');const scanDot=document.getElementById('scanDot');\n  if(scanProgress)scanProgress.style.display='none';if(scanFill)scanFill.style.width='0%';if(scanDot)scanDot.style.left='0%';\n  updateCaptureUI();if(watchRoot)watchRoot.visible=false;`,
  'reset V2'
);

replaceRequired(
  `  if(mode==='scanning'){\n    if(now-lastScanSample>=SCAN_SAMPLE_MS){lastScanSample=now;captureSweepFrame(now)}\n    subtitle.textContent=handSeen?'ESCANEANDO · '+scanFrames.length+' frames · sigue girando':'ESCANEANDO · ZONA MUERTA · sigue girando';\n  }`,
  `  if(mode==='scanning'){\n    if(now-lastScanSample>=SCAN_SAMPLE_MS){lastScanSample=now;captureSweepFrame(now)}\n    const elapsed=now-scanStart;\n    const progress=Math.max(0,Math.min(1,(elapsed-SCAN_HOLD_START_MS)/SCAN_MOVE_MS));\n    const pct=(progress*100).toFixed(1)+'%';\n    const scanFill=document.getElementById('scanFill'),scanDot=document.getElementById('scanDot'),scanSeconds=document.getElementById('scanSeconds');\n    if(scanFill)scanFill.style.width=pct;if(scanDot)scanDot.style.left=pct;\n    if(elapsed<SCAN_HOLD_START_MS){\n      if(scanSeconds)scanSeconds.textContent='DORSO · MANTÉN';\n      subtitle.textContent=handSeen?'DORSO · MANTÉN QUIETO':'DORSO · BUSCANDO MANO';\n    }else if(elapsed<SCAN_HOLD_START_MS+SCAN_MOVE_MS){\n      const deg=Math.round(progress*180);\n      if(scanSeconds)scanSeconds.textContent='GIRA · '+deg+'°';\n      subtitle.textContent=handSeen?'GIRA · '+deg+'° · sigue la barra':'GIRA · '+deg+'° · ZONA MUERTA · sigue girando';\n    }else{\n      if(scanSeconds)scanSeconds.textContent='PALMA · MANTÉN';\n      subtitle.textContent=handSeen?'PALMA · MANTÉN QUIETA':'PALMA · BUSCANDO MANO';\n    }\n    if(elapsed>=SCAN_TOTAL_MS)finishSweep().catch(sweepFail);\n  }`,
  'bloque scanning tick'
);

replaceRequired(
  "openBtn.addEventListener('click',openCamera);",
  `function sweepFail(e){\n  console.error(e);cleanupBanks();mode='ready';guideWrap.style.display='block';captureBtn.classList.remove('hidden');resetBtn.classList.add('hidden');captureBtn.disabled=false;camBtn.disabled=false;\n  const scanProgress=document.getElementById('scanProgress');if(scanProgress)scanProgress.style.display='none';\n  subtitle.textContent='ERROR V2.2 · '+(e?.message||String(e));updateCaptureUI();\n}\n\nopenBtn.addEventListener('click',openCamera);`,
  'listener openBtn'
);

replaceRequired(
  "captureBtn.addEventListener('click',()=>{const job=mode==='scanning'?finishSweep():startSweep();job.catch(e=>{console.error(e);cleanupBanks();mode='ready';guideWrap.style.display='block';captureBtn.classList.remove('hidden');resetBtn.classList.add('hidden');captureBtn.disabled=false;camBtn.disabled=false;subtitle.textContent='ERROR V2 · '+(e?.message||String(e));updateCaptureUI()})});",
  "captureBtn.addEventListener('click',()=>{if(mode!=='ready')return;startSweep().catch(sweepFail)});",
  'listener capture V2'
);

await writeFile(indexPath, html);
await writeFile('dist/BUILD.txt', `AMURA AR V2.2 1+6+1S SWEEP\nsource=postprocess-v2.2\ntime=${new Date().toISOString()}\n`);
console.log('Postproceso V2.2: 1 s DORSO + 6 s giro + 1 s PALMA + cobertura keyframes');
