import { readFile, writeFile } from 'node:fs/promises';

const indexPath = 'dist/index.html';
let html = await readFile(indexPath, 'utf8');

function replaceRequired(oldText, newText, label) {
  if (!html.includes(oldText)) throw new Error(`V2.3: no se encontró ${label}`);
  html = html.replace(oldText, newText);
}

function replaceBetween(startMarker, endMarker, replacement, label) {
  const a = html.indexOf(startMarker);
  if (a < 0) throw new Error(`V2.3: no se encontró inicio ${label}`);
  const b = html.indexOf(endMarker, a);
  if (b < 0) throw new Error(`V2.3: no se encontró fin ${label}`);
  html = html.slice(0, a) + replacement + html.slice(b);
}

replaceRequired(
  '<div id="buildBadge">BUILD V3D V1.6 · TEMPORAL STABILITY · 0/90/180</div>',
  '<div id="buildBadge">BUILD V2.3 · COVERAGE TEST · 0→180</div>',
  'badge V1.6'
);

replaceRequired(
  '<title>AMURA · ORB 3D V1 · DORSO PERFIL PALMA</title>',
  '<title>AMURA · ORB V2.3 · COVERAGE TEST</title>',
  'title'
);

replaceRequired(
  '</style>',
  `#scanProgress{position:absolute;z-index:55;left:50%;top:calc(max(12px,env(safe-area-inset-top)) + 82px);transform:translateX(-50%);width:min(86vw,480px);display:none;pointer-events:none;text-shadow:0 2px 10px rgba(0,0,0,.9)}\n#scanLabels{display:flex;justify-content:space-between;align-items:center;font-size:10px;font-weight:800;letter-spacing:.08em;margin-bottom:7px;color:rgba(255,255,255,.92)}\n#scanTrack{position:relative;height:8px;border-radius:999px;background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.38);overflow:visible}\n#scanFill{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:999px;background:#fff}\n#scanDot{position:absolute;top:50%;left:0;width:18px;height:18px;border-radius:50%;transform:translate(-50%,-50%);background:#b078ff;border:2px solid #fff;box-shadow:0 2px 12px rgba(0,0,0,.8)}\n#scanStatus{text-align:center;margin-top:7px;font-size:12px;font-weight:800;letter-spacing:.08em}\n</style>`,
  'style'
);

replaceRequired(
  '<div id="top"><div id="brand">AMURA · ORB RELOCALIZATION</div><div id="subtitle">Paso 1/3 · DORSO · coloca la muñeca en la guía</div></div>',
  `<div id="top"><div id="brand">AMURA · ORB V2.3 · COVERAGE</div><div id="subtitle">DORSO arriba · pulsa ESCANEAR</div></div>\n  <div id="scanProgress"><div id="scanLabels"><span>DORSO · 0°</span><span>PERFIL · 90°</span><span>PALMA · 180°</span></div><div id="scanTrack"><div id="scanFill"></div><div id="scanDot"></div></div><div id="scanStatus">DORSO · MANTÉN</div></div>`,
  'top'
);

replaceRequired(
  '<button id="captureBtn" class="primary" type="button">CAPTURAR DORSO</button>',
  '<button id="captureBtn" class="primary" type="button">INICIAR ESCANEO</button>',
  'botón'
);

replaceRequired(
  '<h1>Relocalización 3D · V1</h1>',
  '<h1>Relocalización 3D · V2.3</h1>',
  'h1'
);

replaceRequired(
  '<p>Pon el iPhone vertical y el antebrazo horizontal, como cuando miras la hora. Después mueve el teléfono, acerca/aleja y gira en el plano.</p>',
  '<p>1 segundo DORSO quieto, 6 segundos siguiendo la barra hasta PALMA y 1 segundo PALMA quieta. Esta versión prioriza cobertura: 14 referencias garantizadas y el matcher estable de V1.6.</p>',
  'instrucciones'
);

replaceRequired(
  "const AMURA_BUILD='V3D-V1.6-TEMPORAL-STABILITY-0-90-180';",
  "const AMURA_BUILD='V2.3-COVERAGE-STABLE-MATCHER-20260818';",
  'AMURA_BUILD'
);

replaceRequired(
  'const RESCUE_SCALES=[0.74,1.36];',
  `const RESCUE_SCALES=[0.74,1.36];\nconst SCAN_SAMPLE_MS=100;\nconst SCAN_HOLD_START_MS=1000;\nconst SCAN_MOVE_MS=6000;\nconst SCAN_HOLD_END_MS=1000;\nconst SCAN_TOTAL_MS=SCAN_HOLD_START_MS+SCAN_MOVE_MS+SCAN_HOLD_END_MS;\nconst MAX_SCAN_FRAMES=90;\nconst SWEEP_TARGETS=[0,.10,.20,.30,.38,.44,.48,.52,.56,.62,.70,.80,.90,1];`,
  'constantes'
);

replaceRequired(
  'let captureStep=0;',
  `let captureStep=0;\nlet scanFrames=[],scanStart=0,lastScanSample=0,scanFinishing=false,lastBankIndex=-1;`,
  'estado scan'
);

replaceBetween(
  'function updateCaptureUI(){',
  '\nfunction resize(){',
  `function updateCaptureUI(){\n  captureBtn.textContent='INICIAR ESCANEO';\n  subtitle.textContent='DORSO arriba · pulsa ESCANEAR';\n}\n\n`,
  'updateCaptureUI'
);

replaceRequired(
  "if(mode!=='ready'||!latestLandmarks)return;",
  "if((mode!=='ready'&&mode!=='scanning')||!latestLandmarks)return;",
  'drawLandmarks scanning'
);

const sweepBlock = `async function startSweep(){\n  if(!handSeen){subtitle.textContent='Enséñame primero la mano con DORSO arriba';return}\n  captureBtn.disabled=true;camBtn.disabled=true;\n  subtitle.textContent='Preparando ORB…';\n  await initCV();\n  cleanupBanks();\n  scanFrames=[];scanFinishing=false;lastBankIndex=-1;\n  scanStart=performance.now();lastScanSample=0;\n  mode='scanning';\n  const panel=document.getElementById('scanProgress'),fill=document.getElementById('scanFill'),dot=document.getElementById('scanDot'),status=document.getElementById('scanStatus');\n  if(panel)panel.style.display='block';if(fill)fill.style.width='0%';if(dot)dot.style.left='0%';if(status)status.textContent='DORSO · MANTÉN';\n  flash.classList.remove('go');void flash.offsetWidth;flash.classList.add('go');\n}\n\nfunction captureSweepFrame(now){\n  if(mode!=='scanning'||scanFrames.length>=MAX_SCAN_FRAMES)return;\n  drawCoverToWork();\n  const r0=stageToWork(guideRect());\n  const rx=Math.max(0,Math.round(r0.x)),ry=Math.max(0,Math.round(r0.y));\n  const rw=Math.max(8,Math.min(workCanvas.width-rx,Math.round(r0.w)));\n  const rh=Math.max(8,Math.min(workCanvas.height-ry,Math.round(r0.h)));\n  const rect={x:rx,y:ry,w:rw,h:rh};\n  const c=document.createElement('canvas');c.width=rw;c.height=rh;\n  c.getContext('2d',{willReadFrequently:true}).drawImage(workCanvas,rx,ry,rw,rh,0,0,rw,rh);\n  scanFrames.push({canvas:c,rect,t:Math.max(0,now-scanStart),handSeen,watchAnchor:computeWatchAnchorRef(rect),casePxWork:computeInitialCasePxWork(rect)});\n}\n\nfunction pickTargetFrame(raw,p,used){\n  const targetT=p<=0?650:p>=1?SCAN_HOLD_START_MS+SCAN_MOVE_MS+650:SCAN_HOLD_START_MS+p*SCAN_MOVE_MS;\n  const profile=p>=.44&&p<=.56;\n  const radius=profile?380:300;\n  let pool=raw.filter(x=>!used.has(x)&&Math.abs(x.t-targetT)<=radius&&x.ref.n>=10&&!x.ref.desc.empty());\n  if(!profile){const hand=pool.filter(x=>x.handSeen);if(hand.length)pool=hand}\n  if(!pool.length)pool=raw.filter(x=>!used.has(x)&&x.ref.n>=10&&!x.ref.desc.empty()).sort((a,b)=>Math.abs(a.t-targetT)-Math.abs(b.t-targetT)).slice(0,6);\n  pool.sort((a,b)=>{const dn=b.ref.n-a.ref.n;if(Math.abs(dn)>=4)return dn;return Math.abs(a.t-targetT)-Math.abs(b.t-targetT)});\n  return pool[0]||null;\n}\n\nasync function finishSweep(){\n  if(mode!=='scanning')return;\n  mode='preparing';captureBtn.disabled=true;camBtn.disabled=true;\n  captureSweepFrame(performance.now());\n  const panel=document.getElementById('scanProgress');if(panel)panel.style.display='none';\n  guideWrap.style.display='none';mpCtx.clearRect(0,0,stageRect().width,stageRect().height);\n  subtitle.textContent='Preparando 14 referencias…';\n  if(scanFrames.length<30)throw new Error('Barrido incompleto');\n\n  const raw=[];\n  for(const f of scanFrames){const ref=buildORBReferenceFromCanvas(f.canvas,1);raw.push({...f,ref})}\n  const used=new Set(),selected=[];\n  for(const p of SWEEP_TARGETS){\n    const f=pickTargetFrame(raw,p,used);\n    if(!f)throw new Error('Falta referencia cerca de '+Math.round(p*180)+'°');\n    used.add(f);selected.push({f,p});\n  }\n  for(const x of raw){try{x.ref.kp.delete()}catch(e){}try{x.ref.desc.delete()}catch(e){}}\n\n  banks=[];\n  for(let i=0;i<selected.length;i++){\n    const {f,p}=selected[i];\n    const deg=Math.round(p*180);\n    banks.push({key:'kf'+i,label:deg+'°',viewAngle:-Math.PI*p,bankIndex:i,rect:f.rect,canvas:f.canvas,casePxWork:f.casePxWork,watchAnchor:f.watchAnchor,refs:[]});\n  }\n  let total=0;for(const b of banks)total+=prepareBankRefs(b);\n  scanFrames=[];mode='tracking';captureBtn.classList.add('hidden');resetBtn.classList.remove('hidden');camBtn.disabled=false;\n  subtitle.textContent='V2.3 · '+banks.length+' REFERENCIAS · '+total+' PUNTOS';\n  smoothed=null;lastValidAt=0;lastViewKey=null;lastPoseGate=null;pendingPoseGate=null;pendingPoseCount=0;lastBankIndex=-1;lastMatch=0;\n  if(watchRoot)watchRoot.visible=false;\n}\n\n`;
replaceBetween('async function captureReference(){','function makeORB(gray){',sweepBlock,'captureReference');

const matchFrameV23 = `function matchFrame(){\n  if(!banks.length||!cvx)return{ok:false,reason:'SIN REFERENCIA'};\n  drawCoverToWork();\n  const src=cvx.imread(workCanvas),gray=new cvx.Mat();\n  cvx.cvtColor(src,gray,cvx.COLOR_RGBA2GRAY);cvx.equalizeHist(gray,gray);src.delete();\n  const {kp:sceneKp,desc:sceneDesc}=makeORB(gray);gray.delete();\n  if(sceneDesc.empty()){sceneKp.delete();sceneDesc.delete();return{ok:false,reason:'SIN TEXTURA'}}\n  let candidates=[],lastReason='NO ENCONTRADA';\n  for(const bank of banks){\n    const primary=bank.refs.find(r=>r.scale===1.0)||bank.refs[0];\n    const r=matchAgainst(primary,sceneKp,sceneDesc);\n    if(r.ok){r.pose.bankIndex=bank.bankIndex;candidates.push(r)}else lastReason=r.reason;\n  }\n  if(!candidates.length){\n    for(const bank of banks){\n      for(const rr of bank.refs){\n        if(rr.scale===1.0)continue;\n        const r=matchAgainst(rr,sceneKp,sceneDesc);\n        if(r.ok){r.pose.bankIndex=bank.bankIndex;candidates.push(r);break}else lastReason=r.reason;\n      }\n    }\n  }\n  sceneKp.delete();sceneDesc.delete();\n  if(!candidates.length)return{ok:false,reason:lastReason};\n  candidates.sort((a,b)=>b.score-a.score);\n  const best=candidates[0];\n  lastBankIndex=best.pose.bankIndex;\n  return best;\n}\n\n`;
replaceBetween('function matchFrame(){','function drawWatch(p){',matchFrameV23,'matchFrame');

const resetTick = `function resetLab(){\n  mode='ready';cleanupBanks();captureStep=0;scanFrames=[];scanStart=0;lastScanSample=0;scanFinishing=false;lastBankIndex=-1;\n  smoothed=null;lastValidAt=0;latestLandmarks=null;latestWorldLandmarks=null;handSeen=false;lastVideoTime=-1;\n  guideWrap.style.display='block';captureBtn.classList.remove('hidden');resetBtn.classList.add('hidden');captureBtn.disabled=false;camBtn.disabled=false;\n  const panel=document.getElementById('scanProgress'),fill=document.getElementById('scanFill'),dot=document.getElementById('scanDot');if(panel)panel.style.display='none';if(fill)fill.style.width='0%';if(dot)dot.style.left='0%';\n  updateCaptureUI();if(watchRoot)watchRoot.visible=false;\n}\n\nfunction sweepFail(e){\n  console.error(e);cleanupBanks();mode='ready';scanFrames=[];scanFinishing=false;guideWrap.style.display='block';captureBtn.classList.remove('hidden');resetBtn.classList.add('hidden');captureBtn.disabled=false;camBtn.disabled=false;\n  const panel=document.getElementById('scanProgress');if(panel)panel.style.display='none';subtitle.textContent='ERROR V2.3 · '+(e?.message||String(e));\n}\n\nfunction tick(now){\n  raf=requestAnimationFrame(tick);\n  if(mode==='ready'||mode==='scanning'){detectHand(now);drawLandmarks()}else{const r=stageRect();mpCtx.clearRect(0,0,r.width,r.height)}\n  if(mode==='scanning'){\n    if(now-lastScanSample>=SCAN_SAMPLE_MS){lastScanSample=now;captureSweepFrame(now)}\n    const elapsed=now-scanStart;\n    const progress=Math.max(0,Math.min(1,(elapsed-SCAN_HOLD_START_MS)/SCAN_MOVE_MS));\n    const pct=(progress*100).toFixed(1)+'%';\n    const fill=document.getElementById('scanFill'),dot=document.getElementById('scanDot'),status=document.getElementById('scanStatus');\n    if(fill)fill.style.width=pct;if(dot)dot.style.left=pct;\n    if(elapsed<SCAN_HOLD_START_MS){if(status)status.textContent='DORSO · MANTÉN';subtitle.textContent=handSeen?'DORSO · MANTÉN QUIETO':'DORSO · BUSCANDO MANO'}\n    else if(elapsed<SCAN_HOLD_START_MS+SCAN_MOVE_MS){const deg=Math.round(progress*180);if(status)status.textContent='GIRA · '+deg+'°';subtitle.textContent=handSeen?'GIRA · '+deg+'°':'GIRA · '+deg+'° · ZONA MUERTA'}\n    else{if(status)status.textContent='PALMA · MANTÉN';subtitle.textContent=handSeen?'PALMA · MANTÉN QUIETA':'PALMA · BUSCANDO MANO'}\n    if(elapsed>=SCAN_TOTAL_MS&&!scanFinishing){scanFinishing=true;finishSweep().catch(sweepFail)}\n  }\n  if(mode==='tracking'&&now-lastMatch>=MATCH_MS){\n    lastMatch=now;const r=matchFrame();\n    if(r&&r.ok){drawWatch(r.pose);lastValidAt=now;subtitle.textContent='V2.3 · '+r.pose.viewLabel+' · KF '+(r.pose.bankIndex+1)+'/'+banks.length+' · '+r.pose.inliers+' INLIERS'}\n    else{const reason=(r&&r.reason)?r.reason:'NO ENCONTRADA';if(watchRoot&&watchRoot.visible&&lastValidAt&&(now-lastValidAt)<HOLD_VALID_MS)subtitle.textContent='MANTENIENDO · '+reason;else{if(watchRoot)watchRoot.visible=false;subtitle.textContent=reason}}\n  }\n  if(renderer3&&scene3&&camera3)renderer3.render(scene3,camera3);\n}\n\n`;
replaceBetween('function resetLab(){','openBtn.addEventListener',resetTick,'reset/tick');

replaceRequired(
  "captureBtn.addEventListener('click',()=>captureReference().catch(e=>{console.error(e);subtitle.textContent='ERROR CAPTURA · '+(e?.message||String(e));captureBtn.disabled=false;camBtn.disabled=false;}));",
  "captureBtn.addEventListener('click',()=>{if(mode!=='ready')return;startSweep().catch(sweepFail)});",
  'listener capture'
);

await writeFile(indexPath, html);
await writeFile('dist/BUILD.txt', `AMURA AR V2.3 COVERAGE TEST\nsource=stable-v1.6-matcher\ntime=${new Date().toISOString()}\n`);
console.log('V2.3 listo: 14 referencias garantizadas + matcher V1.6 + búsqueda global');
