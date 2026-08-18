import { readFile, writeFile } from 'node:fs/promises';

const indexPath = 'dist/index.html';
let html = await readFile(indexPath, 'utf8');

function replaceRequired(oldText, newText, label) {
  if (!html.includes(oldText)) throw new Error(`V2.1: no se encontró ${label}`);
  html = html.replace(oldText, newText);
}

replaceRequired(
  '<div id="buildBadge">BUILD V2 · SWEEP KEYFRAMES · 0→180</div>',
  '<div id="buildBadge">BUILD V2.1 · 4S AUTO SWEEP · 0→180</div>',
  'badge V2'
);

replaceRequired(
  '</style>',
  `#scanProgress{position:absolute;z-index:55;left:50%;top:calc(max(12px,env(safe-area-inset-top)) + 82px);transform:translateX(-50%);width:min(86vw,480px);display:none;pointer-events:none;text-shadow:0 2px 10px rgba(0,0,0,.9)}\n#scanLabels{display:flex;justify-content:space-between;align-items:center;font-size:10px;font-weight:800;letter-spacing:.08em;margin-bottom:7px;color:rgba(255,255,255,.92)}\n#scanTrack{position:relative;height:8px;border-radius:999px;background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.38);overflow:visible}\n#scanFill{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:999px;background:#fff}\n#scanDot{position:absolute;top:50%;left:0;width:18px;height:18px;border-radius:50%;transform:translate(-50%,-50%);background:#b078ff;border:2px solid #fff;box-shadow:0 2px 12px rgba(0,0,0,.8)}\n#scanSeconds{text-align:center;margin-top:7px;font-size:12px;font-weight:800;letter-spacing:.08em}\n</style>`,
  'cierre style'
);

replaceRequired(
  '<div id="top"><div id="brand">AMURA · ORB V2 · SWEEP</div><div id="subtitle">DORSO arriba · pulsa ESCANEAR y gira lentamente hasta PALMA</div></div>',
  `<div id="top"><div id="brand">AMURA · ORB V2 · SWEEP</div><div id="subtitle">DORSO arriba · pulsa ESCANEAR y acompaña la barra hasta PALMA</div></div>\n  <div id="scanProgress"><div id="scanLabels"><span>DORSO · 0°</span><span>PERFIL · 90°</span><span>PALMA · 180°</span></div><div id="scanTrack"><div id="scanFill"></div><div id="scanDot"></div></div><div id="scanSeconds">4.0 s</div></div>`,
  'cabecera V2'
);

replaceRequired(
  '<p>Coloca DORSO en la guía. Pulsa iniciar y gira lentamente la muñeca hasta PALMA. Pulsa terminar al llegar. V2 aprenderá automáticamente los keyframes útiles y puenteará la zona muerta del perfil.</p>',
  '<p>Coloca DORSO en la guía. Pulsa iniciar y gira la muñeca siguiendo la barra durante 4 segundos hasta PALMA. El escaneo termina automáticamente y entran el reloj y la tríada.</p>',
  'instrucciones V2'
);

replaceRequired(
  "const AMURA_BUILD='V2-SWEEP-KEYFRAMES-20260818';",
  "const AMURA_BUILD='V2.1-4S-AUTO-SWEEP-20260818';",
  'AMURA_BUILD V2'
);

replaceRequired(
  'const MAX_KEYFRAMES=18;',
  'const MAX_KEYFRAMES=18;\nconst SCAN_DURATION_MS=4000;',
  'MAX_KEYFRAMES'
);

replaceRequired(
  "if(mode!=='ready'||!latestLandmarks)return;",
  "if((mode!=='ready'&&mode!=='scanning')||!latestLandmarks)return;",
  'guard drawLandmarks'
);

replaceRequired(
  `function updateCaptureUI(){\n  if(mode==='scanning'){\n    captureBtn.textContent='TERMINAR EN PALMA';\n    subtitle.textContent='ESCANEANDO · gira lentamente hasta PALMA';\n  }else{\n    captureBtn.textContent='INICIAR ESCANEO';\n    subtitle.textContent='DORSO arriba · pulsa ESCANEAR y gira lentamente hasta PALMA';\n  }\n}`,
  `function updateCaptureUI(){\n  if(mode==='scanning'){\n    captureBtn.textContent='ESCANEANDO 4 s…';\n    subtitle.textContent='SIGUE LA BARRA · DORSO → PALMA';\n  }else{\n    captureBtn.textContent='INICIAR ESCANEO';\n    subtitle.textContent='DORSO arriba · pulsa ESCANEAR y acompaña la barra hasta PALMA';\n  }\n}`,
  'updateCaptureUI V2'
);

replaceRequired(
  `  mode='scanning';\n  captureBtn.disabled=false;camBtn.disabled=true;\n  flash.classList.remove('go');void flash.offsetWidth;flash.classList.add('go');\n  updateCaptureUI();`,
  `  mode='scanning';\n  captureBtn.disabled=true;camBtn.disabled=true;\n  const scanProgress=document.getElementById('scanProgress');\n  const scanFill=document.getElementById('scanFill');\n  const scanDot=document.getElementById('scanDot');\n  const scanSeconds=document.getElementById('scanSeconds');\n  if(scanProgress)scanProgress.style.display='block';\n  if(scanFill)scanFill.style.width='0%';\n  if(scanDot)scanDot.style.left='0%';\n  if(scanSeconds)scanSeconds.textContent='4.0 s';\n  flash.classList.remove('go');void flash.offsetWidth;flash.classList.add('go');\n  updateCaptureUI();`,
  'inicio scanning V2'
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
  `  if(mode==='scanning'){\n    if(now-lastScanSample>=SCAN_SAMPLE_MS){lastScanSample=now;captureSweepFrame(now)}\n    const progress=Math.max(0,Math.min(1,(now-scanStart)/SCAN_DURATION_MS));\n    const pct=(progress*100).toFixed(1)+'%';\n    const scanFill=document.getElementById('scanFill'),scanDot=document.getElementById('scanDot'),scanSeconds=document.getElementById('scanSeconds');\n    if(scanFill)scanFill.style.width=pct;if(scanDot)scanDot.style.left=pct;\n    if(scanSeconds)scanSeconds.textContent=Math.max(0,(SCAN_DURATION_MS-(now-scanStart))/1000).toFixed(1)+' s';\n    const deg=Math.round(progress*180);\n    subtitle.textContent=handSeen?'ESCANEANDO · '+deg+'° · sigue la barra':'ESCANEANDO · '+deg+'° · ZONA MUERTA · sigue girando';\n    if(progress>=1)finishSweep().catch(sweepFail);\n  }`,
  'bloque scanning tick'
);

replaceRequired(
  "openBtn.addEventListener('click',openCamera);",
  `function sweepFail(e){\n  console.error(e);cleanupBanks();mode='ready';guideWrap.style.display='block';captureBtn.classList.remove('hidden');resetBtn.classList.add('hidden');captureBtn.disabled=false;camBtn.disabled=false;\n  const scanProgress=document.getElementById('scanProgress');if(scanProgress)scanProgress.style.display='none';\n  subtitle.textContent='ERROR V2.1 · '+(e?.message||String(e));updateCaptureUI();\n}\n\nopenBtn.addEventListener('click',openCamera);`,
  'listener openBtn'
);

replaceRequired(
  "captureBtn.addEventListener('click',()=>{const job=mode==='scanning'?finishSweep():startSweep();job.catch(e=>{console.error(e);cleanupBanks();mode='ready';guideWrap.style.display='block';captureBtn.classList.remove('hidden');resetBtn.classList.add('hidden');captureBtn.disabled=false;camBtn.disabled=false;subtitle.textContent='ERROR V2 · '+(e?.message||String(e));updateCaptureUI()})});",
  "captureBtn.addEventListener('click',()=>{if(mode!=='ready')return;startSweep().catch(sweepFail)});",
  'listener capture V2'
);

await writeFile(indexPath, html);
await writeFile('dist/BUILD.txt', `AMURA AR V2.1 4S AUTO SWEEP\nsource=postprocess-v2.1\ntime=${new Date().toISOString()}\n`);
console.log('Postproceso V2.1: barra 4 s + MediaPipe visible + cierre automático + reloj/tríada');
