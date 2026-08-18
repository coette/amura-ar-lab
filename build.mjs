import { mkdir, writeFile, copyFile, access, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const SOURCE = process.env.ASSET_SOURCE || 'https://amura-engine-2.pages.dev';
const DIST = 'dist';

const assets = [
  'vendor_v272/mediapipe/vision_bundle.mjs',
  'vendor_v272/mediapipe/wasm/vision_wasm_internal.wasm',
  'vendor_v272/mediapipe/wasm/vision_wasm_nosimd_internal.js',
  'vendor_v272/mediapipe/wasm/vision_wasm_module_internal.wasm',
  'vendor_v272/mediapipe/wasm/vision_wasm_nosimd_internal.wasm',
  'vendor_v272/mediapipe/wasm/vision_wasm_internal.js',
  'vendor_v272/mediapipe/wasm/vision_wasm_module_internal.js',
  'vendor_v272/opencv/opencv.wasm',
  'vendor_v272/opencv/opencv.js',
  'vendor_v272/three/three.core.js',
  'vendor_v272/three/three.module.js',
  'vendor_v272/three/addons/loaders/DRACOLoader.js',
  'vendor_v272/three/addons/loaders/GLTFLoader.js',
  'vendor_v272/three/addons/utils/BufferGeometryUtils.js',
  'vendor_v272/three/draco/draco_decoder.js',
  'vendor_v272/three/draco/draco_decoder.wasm',
  'vendor_v272/three/draco/draco_wasm_wrapper.js',
  'models_v272/hand_landmarker.task',
  'models_v272/A1-Irontide-AR-diagnostic.glb'
];

async function ensureDir(path) { await mkdir(dirname(path), { recursive: true }); }
async function download(path) {
  const url = `${SOURCE}/${path}`;
  console.log('GET', url);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`No se pudo descargar ${url}: ${res.status}`);
  const out = `${DIST}/${path}`;
  await ensureDir(out);
  await writeFile(out, new Uint8Array(await res.arrayBuffer()));
}

function replaceRequired(text, oldText, newText, label) {
  if (!text.includes(oldText)) throw new Error(`V2: no se encontró ${label}`);
  return text.replace(oldText, newText);
}

function replaceBetweenRequired(text, startMarker, endMarker, replacement, label) {
  const a = text.indexOf(startMarker);
  if (a < 0) throw new Error(`V2: no se encontró inicio ${label}`);
  const b = text.indexOf(endMarker, a);
  if (b < 0) throw new Error(`V2: no se encontró fin ${label}`);
  return text.slice(0, a) + replacement + text.slice(b);
}

await mkdir(DIST, { recursive: true });
for (const asset of assets) await download(asset);

try {
  await access('index.html');
  await copyFile('index.html', `${DIST}/index.html`);
} catch {
  const res = await fetch(`${SOURCE}/index.html`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`No se pudo descargar index.html actual: ${res.status}`);
  await writeFile(`${DIST}/index.html`, new Uint8Array(await res.arrayBuffer()));
}

const indexPath = `${DIST}/index.html`;
let html = await readFile(indexPath, 'utf8');

html = replaceRequired(html, '<title>AMURA · ORB 3D V1 · DORSO PERFIL PALMA</title>', '<title>AMURA · ORB 3D V2 · ESCANEO CONTINUO</title>', 'title V1');
html = replaceRequired(html, '<div id="buildBadge">BUILD V3D V1 · DORSO 0/90/180 · 20260818-2015</div>', '<div id="buildBadge">BUILD V2 · SWEEP KEYFRAMES · 0→180</div>', 'badge V1');
html = replaceRequired(html, '<div id="top"><div id="brand">AMURA · ORB RELOCALIZATION</div><div id="subtitle">Paso 1/3 · DORSO · coloca la muñeca en la guía</div></div>', '<div id="top"><div id="brand">AMURA · ORB V2 · SWEEP</div><div id="subtitle">DORSO arriba · pulsa ESCANEAR y gira lentamente hasta PALMA</div></div>', 'subtitle V1');
html = replaceRequired(html, '<button id="captureBtn" class="primary" type="button">CAPTURAR DORSO</button>', '<button id="captureBtn" class="primary" type="button">INICIAR ESCANEO</button>', 'botón captura');
html = replaceRequired(html, '<h1>Relocalización 3D · V1</h1>', '<h1>Relocalización 3D · V2</h1>', 'cabecera V1');
html = replaceRequired(html, '<p>Pon el iPhone vertical y el antebrazo horizontal, como cuando miras la hora. Después mueve el teléfono, acerca/aleja y gira en el plano.</p>', '<p>Coloca DORSO en la guía. Pulsa iniciar y gira lentamente la muñeca hasta PALMA. Pulsa terminar al llegar. V2 aprenderá automáticamente los keyframes útiles y puenteará la zona muerta del perfil.</p>', 'texto instrucciones');
html = replaceRequired(html, "const AMURA_BUILD='V3D-V1-DORSO-PERFIL-PALMA-20260818-2015';", "const AMURA_BUILD='V2-SWEEP-KEYFRAMES-20260818';", 'AMURA_BUILD');
html = replaceRequired(html, 'const MATCH_MS=110;\nconst HOLD_VALID_MS=1400;\nconst RESCUE_SCALES=[0.74,1.36];', 'const MATCH_MS=95;\nconst HOLD_VALID_MS=450;\nconst RESCUE_SCALES=[0.74,1.36];\nconst SCAN_SAMPLE_MS=120;\nconst MAX_SCAN_FRAMES=48;\nconst MAX_KEYFRAMES=18;', 'constantes V1');

const oldState = `let mode='ready',raf=0,lastMatch=0;\nconst CAPTURE_SEQUENCE=[\n  {key:'dorso',label:'DORSO',viewAngle:0},\n  {key:'perfil',label:'PERFIL 90°',viewAngle:Math.PI/2},\n  {key:'palma',label:'PALMA 180°',viewAngle:Math.PI}\n];\nlet captureStep=0;\nlet banks=[];\nlet orb=null,matcher=null;\nlet renderer3=null,scene3=null,camera3=null,watchRoot=null,watchReady=false;\nlet smoothed=null;\nlet lastValidAt=0;\nlet lastViewKey=null;`;
const newState = `let mode='ready',raf=0,lastMatch=0;\nlet scanFrames=[],scanStart=0,lastScanSample=0;\nlet banks=[];\nlet orb=null,matcher=null;\nlet renderer3=null,scene3=null,camera3=null,watchRoot=null,watchReady=false;\nlet smoothed=null;\nlet lastValidAt=0;\nlet lastBankIndex=-1;\nlet lastPoseGate=null;\nlet pendingPoseGate=null;\nlet pendingPoseCount=0;\nlet frameCounter=0;`;
html = replaceRequired(html, oldState, newState, 'estado 3 capturas');

html = replaceBetweenRequired(html, 'function updateCaptureUI(){', '\nfunction resize(){', `function updateCaptureUI(){\n  if(mode==='scanning'){\n    captureBtn.textContent='TERMINAR EN PALMA';\n    subtitle.textContent='ESCANEANDO · gira lentamente hasta PALMA';\n  }else{\n    captureBtn.textContent='INICIAR ESCANEO';\n    subtitle.textContent='DORSO arriba · pulsa ESCANEAR y gira lentamente hasta PALMA';\n  }\n}\n\n`, 'updateCaptureUI');

html = replaceBetweenRequired(html, 'function cleanupBanks(){', '\nfunction buildORBReferenceFromCanvas', `function cleanupBanks(){\n  for(const bank of banks){\n    for(const r of (bank.refs||[])){\n      try{if(r.kp)r.kp.delete()}catch(e){}\n      try{if(r.desc)r.desc.delete()}catch(e){}\n    }\n  }\n  banks=[];\n  scanFrames=[];\n  lastBankIndex=-1;\n  lastPoseGate=null;\n  pendingPoseGate=null;\n  pendingPoseCount=0;\n}\n\n`, 'cleanupBanks');

const sweepBlock = `async function startSweep(){\n  if(!handSeen){subtitle.textContent='Enséñame primero la mano con DORSO arriba';return}\n  captureBtn.disabled=true;camBtn.disabled=true;\n  subtitle.textContent='Preparando ORB para el escaneo…';\n  try{await initCV()}catch(e){captureBtn.disabled=false;camBtn.disabled=false;throw e}\n  cleanupBanks();\n  scanFrames=[];\n  scanStart=performance.now();lastScanSample=0;\n  mode='scanning';\n  captureBtn.disabled=false;camBtn.disabled=true;\n  flash.classList.remove('go');void flash.offsetWidth;flash.classList.add('go');\n  updateCaptureUI();\n}\n\nfunction captureSweepFrame(now){\n  if(mode!=='scanning'||scanFrames.length>=MAX_SCAN_FRAMES)return;\n  drawCoverToWork();\n  const r0=stageToWork(guideRect());\n  const rx=Math.max(0,Math.round(r0.x)),ry=Math.max(0,Math.round(r0.y));\n  const rw=Math.max(8,Math.min(workCanvas.width-rx,Math.round(r0.w)));\n  const rh=Math.max(8,Math.min(workCanvas.height-ry,Math.round(r0.h)));\n  const rect={x:rx,y:ry,w:rw,h:rh};\n  const c=document.createElement('canvas');c.width=rw;c.height=rh;\n  c.getContext('2d',{willReadFrequently:true}).drawImage(workCanvas,rx,ry,rw,rh,0,0,rw,rh);\n  scanFrames.push({canvas:c,rect,t:Math.max(0,now-scanStart),watchAnchor:computeWatchAnchorRef(rect),casePxWork:computeInitialCasePxWork(rect),handSeen});\n}\n\nfunction appearanceSimilarity(a,b){\n  if(!a||!b||a.desc.empty()||b.desc.empty())return 0;\n  let good=0;\n  try{\n    const vv=new cvx.DMatchVectorVector();matcher.knnMatch(a.desc,b.desc,vv,2);\n    for(let i=0;i<vv.size();i++){\n      const v=vv.get(i);\n      if(v.size()>=2){const m=v.get(0),n=v.get(1);if(m.distance<.84*n.distance&&m.distance<86)good++}\n      v.delete();\n    }\n    vv.delete();\n  }catch(e){return 0}\n  return good/Math.max(1,Math.min(a.n,b.n));\n}\n\nasync function finishSweep(){\n  if(mode!=='scanning')return;\n  captureBtn.disabled=true;camBtn.disabled=true;\n  captureSweepFrame(performance.now());\n  mode='preparing';\n  guideWrap.style.display='none';\n  mpCtx.clearRect(0,0,stageRect().width,stageRect().height);\n  subtitle.textContent='Analizando barrido y eligiendo keyframes…';\n  if(scanFrames.length<6)throw new Error('Barrido demasiado corto · repite más despacio');\n\n  const raw=[];\n  for(let i=0;i<scanFrames.length;i++){\n    const f=scanFrames[i];\n    const ref=buildORBReferenceFromCanvas(f.canvas,1.0);\n    raw.push({...f,ref});\n  }\n  const usable=raw.filter(x=>x.ref.n>=10&&!x.ref.desc.empty());\n  if(usable.length<5){for(const x of raw){try{x.ref.kp.delete();x.ref.desc.delete()}catch(e){}};throw new Error('Poca textura durante el barrido')}\n\n  let selected=[usable[0]];\n  for(let i=1;i<usable.length-1;i++){\n    const cur=usable[i],last=selected[selected.length-1];\n    const totalT=Math.max(1,usable[usable.length-1].t-usable[0].t);\n    const prog=(cur.t-usable[0].t)/totalT;\n    const profile=prog>.38&&prog<.62;\n    const sim=appearanceSimilarity(last.ref,cur.ref);\n    const gap=cur.t-last.t;\n    if(sim<(profile?.54:.43)||gap>(profile?300:520))selected.push(cur);\n  }\n  const tail=usable[usable.length-1];\n  if(selected[selected.length-1]!==tail)selected.push(tail);\n\n  while(selected.length>MAX_KEYFRAMES){\n    let removeAt=-1,bestRedundancy=-1;\n    for(let i=1;i<selected.length-1;i++){\n      const p=(selected[i].t-selected[0].t)/Math.max(1,selected[selected.length-1].t-selected[0].t);\n      if(p>.40&&p<.60)continue;\n      const redundancy=appearanceSimilarity(selected[i-1].ref,selected[i+1].ref);\n      if(redundancy>bestRedundancy){bestRedundancy=redundancy;removeAt=i}\n    }\n    if(removeAt<0)removeAt=Math.floor(selected.length/2);\n    selected.splice(removeAt,1);\n  }\n\n  const t0=selected[0].t,t1=Math.max(t0+1,selected[selected.length-1].t);\n  for(const x of raw){try{x.ref.kp.delete();x.ref.desc.delete()}catch(e){}}\n\n  banks=[];\n  for(let i=0;i<selected.length;i++){\n    const f=selected[i];\n    const progress=Math.max(0,Math.min(1,(f.t-t0)/(t1-t0)));\n    const degrees=Math.round(progress*180);\n    const bank={key:'kf'+i,label:degrees+'°',viewAngle:-Math.PI*progress,bankIndex:i,progress,profileZone:progress>.40&&progress<.60,rect:f.rect,canvas:f.canvas,casePxWork:f.casePxWork,watchAnchor:f.watchAnchor,refs:[]};\n    banks.push(bank);\n  }\n  let total=0;\n  for(const b of banks)total+=prepareBankRefs(b);\n  scanFrames=[];\n  mode='tracking';\n  captureBtn.classList.add('hidden');resetBtn.classList.remove('hidden');camBtn.disabled=false;\n  subtitle.textContent='V2 · '+banks.length+' KEYFRAMES · '+total+' PUNTOS';\n  smoothed=null;lastValidAt=0;lastBankIndex=-1;lastPoseGate=null;pendingPoseGate=null;pendingPoseCount=0;lastMatch=0;frameCounter=0;\n  if(watchRoot)watchRoot.visible=false;\n}\n\n`;
html = replaceBetweenRequired(html, 'async function captureReference(){', 'function makeORB(gray){', sweepBlock, 'captura 3 vistas');

const matchAgainstV2 = `function matchAgainst(refEntry,sceneKp,sceneDesc){\n  let good=[];\n  try{\n    const vv=new cvx.DMatchVectorVector();matcher.knnMatch(refEntry.desc,sceneDesc,vv,2);\n    for(let i=0;i<vv.size();i++){\n      const mv=vv.get(i);\n      if(mv.size()>=2){\n        const m=mv.get(0),n=mv.get(1);\n        if(m.distance<.84*n.distance&&m.distance<86)good.push({q:m.queryIdx,t:m.trainIdx,d:m.distance});\n      }\n      mv.delete();\n    }\n    vv.delete();\n  }catch(e){\n    try{\n      const mv=new cvx.DMatchVector();matcher.match(refEntry.desc,sceneDesc,mv);\n      for(let i=0;i<mv.size();i++){const m=mv.get(i);if(m.distance<68)good.push({q:m.queryIdx,t:m.trainIdx,d:m.distance})}\n      mv.delete();\n    }catch(_){return{ok:false,reason:'ERROR ORB',good:0}}\n  }\n  good.sort((x,y)=>x.d-y.d);\n  const usedScene=new Set();\n  good=good.filter(m=>{if(usedScene.has(m.t))return false;usedScene.add(m.t);return true});\n  if(good.length>70)good=good.slice(0,70);\n  if(good.length<4)return{ok:false,reason:'POCAS COINCIDENCIAS · '+good.length,good:good.length};\n  const refPts=[],scenePts=[];\n  for(const m of good){const a=refEntry.kp.get(m.q).pt,b=sceneKp.get(m.t).pt;refPts.push({x:a.x/refEntry.scale,y:a.y/refEntry.scale});scenePts.push({x:b.x,y:b.y})}\n  const T=estimateSimilarityRansac(refPts,scenePts);\n  if(!T)return{ok:false,reason:'SIN TRANSFORMACIÓN 2D',good:good.length};\n  const bank=refEntry.bank;\n  const minRatio=bank.profileZone?.30:.34;\n  const maxErr=bank.profileZone?5.2:5.6;\n  if(T.inliers<4||T.ratio<minRatio||T.meanErr>maxErr)return{ok:false,reason:'2D DÉBIL · '+T.inliers+' INLIERS',good:good.length};\n  if(T.scale<.34||T.scale>3.1)return{ok:false,reason:'ZOOM FUERA DE RANGO',good:good.length};\n  const center=applySimilarity(T,bank.watchAnchor||{x:bank.rect.w/2,y:bank.rect.h/2});\n  if(center.x<-workCanvas.width*.20||center.x>workCanvas.width*1.20||center.y<-workCanvas.height*.20||center.y>workCanvas.height*1.20)return{ok:false,reason:'CENTRO FUERA',good:good.length};\n  return{ok:true,pose:{cx:center.x,cy:center.y,scaleRatio:T.scale,roll:T.roll,inliers:T.inliers,ratio:T.ratio,meanErr:T.meanErr,refScale:refEntry.scale,baseCasePx:bank.casePxWork,viewAngle:bank.viewAngle,viewLabel:bank.label,viewKey:bank.key,bankIndex:bank.bankIndex,profileZone:bank.profileZone},good:good.length,score:T.inliers*8+T.ratio*100-T.meanErr*3-(refEntry.scale!==1?1.0:0)};\n}\n\n`;
html = replaceBetweenRequired(html, 'function matchAgainst(refEntry,sceneKp,sceneDesc){', 'function matchFrame(){', matchAgainstV2, 'matchAgainst');

const matchFrameV2 = `function matchFrame(){\n  if(!banks.length||!cvx)return{ok:false,reason:'SIN REFERENCIA'};\n  frameCounter++;drawCoverToWork();\n  const src=cvx.imread(workCanvas),gray=new cvx.Mat();cvx.cvtColor(src,gray,cvx.COLOR_RGBA2GRAY);cvx.equalizeHist(gray,gray);src.delete();\n  const {kp:sceneKp,desc:sceneDesc}=makeORB(gray);gray.delete();\n  if(sceneDesc.empty()){sceneKp.delete();sceneDesc.delete();return{ok:false,reason:'SIN TEXTURA'}}\n  let candidates=[],lastReason='NO ENCONTRADA';\n  const tried=new Set();\n  const tryBank=(bank,withRescue=false)=>{\n    if(!bank||tried.has(bank.bankIndex))return;tried.add(bank.bankIndex);\n    const primary=bank.refs.find(r=>r.scale===1.0)||bank.refs[0];\n    let r=matchAgainst(primary,sceneKp,sceneDesc);\n    if(r.ok)candidates.push(r);else lastReason=r.reason;\n    if(!r.ok&&withRescue){for(const rr of bank.refs){if(rr===primary)continue;const c=matchAgainst(rr,sceneKp,sceneDesc);if(c.ok){candidates.push(c);break}else lastReason=c.reason}}\n  };\n\n  if(lastBankIndex>=0){for(let d=-2;d<=2;d++)tryBank(banks[lastBankIndex+d],true)}\n  if(!candidates.length||frameCounter%8===0){for(const b of banks)tryBank(b,false)}\n  if(!candidates.length){tried.clear();for(const b of banks)tryBank(b,true)}\n  sceneKp.delete();sceneDesc.delete();\n  if(!candidates.length){pendingPoseGate=null;pendingPoseCount=0;return{ok:false,reason:lastReason}}\n  candidates.sort((a,b)=>b.score-a.score);\n  let best=candidates[0];\n  const p=best.pose;\n\n  if(lastBankIndex>=0&&Math.abs(p.bankIndex-lastBankIndex)>3&&p.inliers<8)return{ok:false,reason:'SALTO DE KEYFRAME'};\n  if(lastPoseGate){\n    const jump=Math.hypot(p.cx-lastPoseGate.cx,p.cy-lastPoseGate.cy);\n    const zoomJump=Math.abs(Math.log(Math.max(p.scaleRatio,1e-6)/Math.max(lastPoseGate.scaleRatio,1e-6)));\n    const rollJump=Math.abs(Math.atan2(Math.sin(p.roll-lastPoseGate.roll),Math.cos(p.roll-lastPoseGate.roll)));\n    const indexJump=Math.abs(p.bankIndex-lastPoseGate.bankIndex);\n    const suspicious=jump>workCanvas.width*(p.profileZone?.10:.18)||zoomJump>(p.profileZone?.18:.30)||rollJump>(p.profileZone?.35:.60)||indexJump>2;\n    if(suspicious){\n      const close=pendingPoseGate&&pendingPoseGate.bankIndex===p.bankIndex&&Math.hypot(p.cx-pendingPoseGate.cx,p.cy-pendingPoseGate.cy)<workCanvas.width*.08;\n      if(close)pendingPoseCount++;else{pendingPoseGate={cx:p.cx,cy:p.cy,bankIndex:p.bankIndex};pendingPoseCount=1}\n      const needed=p.profileZone?3:2;\n      if(pendingPoseCount<needed)return{ok:false,reason:(p.profileZone?'PUENTE PERFIL':'CONFIRMANDO POSE')+' · '+pendingPoseCount+'/'+needed};\n      pendingPoseGate=null;pendingPoseCount=0;\n    }else{pendingPoseGate=null;pendingPoseCount=0}\n  }\n\n  const neighbor=candidates.find(c=>Math.abs(c.pose.bankIndex-p.bankIndex)===1&&c.score>best.score*.62);\n  if(neighbor){\n    const wb=Math.max(1,best.score),wn=Math.max(1,neighbor.score);\n    p.viewAngle=(p.viewAngle*wb+neighbor.pose.viewAngle*wn)/(wb+wn);\n    p.viewLabel=Math.round(Math.abs(p.viewAngle)*180/Math.PI)+'°';\n  }\n  lastPoseGate={cx:p.cx,cy:p.cy,scaleRatio:p.scaleRatio,roll:p.roll,bankIndex:p.bankIndex};\n  lastBankIndex=p.bankIndex;\n  return best;\n}\n\n`;
html = replaceBetweenRequired(html, 'function matchFrame(){', 'function drawWatch(p){', matchFrameV2, 'matchFrame');

html = replaceRequired(html, 'smoothed.x+=dx*aXY;smoothed.y+=dy*aXY;smoothed.scale+=(raw.scale-smoothed.scale)*aScale;smoothed.roll+=dr*aRoll;smoothed.viewAngle=raw.viewAngle;', `smoothed.x+=dx*aXY;smoothed.y+=dy*aXY;smoothed.scale+=(raw.scale-smoothed.scale)*aScale;smoothed.roll+=dr*aRoll;\n    const dv=raw.viewAngle-smoothed.viewAngle;smoothed.viewAngle+=dv*(Math.abs(dv)>.45?.30:.56);`, 'suavizado viewAngle');
html = replaceRequired(html, 'const qView=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),smoothed.viewAngle||0);', 'const qView=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),smoothed.viewAngle||0);', 'eje view X');

const tailV2 = `function resetLab(){\n  mode='ready';cleanupBanks();smoothed=null;lastValidAt=0;latestLandmarks=null;latestWorldLandmarks=null;handSeen=false;lastVideoTime=-1;lastScanSample=0;scanStart=0;frameCounter=0;\n  guideWrap.style.display='block';captureBtn.classList.remove('hidden');resetBtn.classList.add('hidden');captureBtn.disabled=false;camBtn.disabled=false;updateCaptureUI();if(watchRoot)watchRoot.visible=false;\n}\n\nfunction tick(now){\n  raf=requestAnimationFrame(tick);\n  if(mode==='ready'||mode==='scanning'){detectHand(now);drawLandmarks()}else{const r=stageRect();mpCtx.clearRect(0,0,r.width,r.height)}\n  if(mode==='scanning'){\n    if(now-lastScanSample>=SCAN_SAMPLE_MS){lastScanSample=now;captureSweepFrame(now)}\n    subtitle.textContent=handSeen?'ESCANEANDO · '+scanFrames.length+' frames · sigue girando':'ESCANEANDO · ZONA MUERTA · sigue girando';\n  }\n  if(mode==='tracking'&&now-lastMatch>=MATCH_MS){\n    lastMatch=now;const r=matchFrame();\n    if(r&&r.ok){drawWatch(r.pose);lastValidAt=now;subtitle.textContent='V2 · '+r.pose.viewLabel+' · KF '+(r.pose.bankIndex+1)+'/'+banks.length+' · '+r.pose.inliers+' INLIERS'}\n    else{\n      const reason=(r&&r.reason)?r.reason:'NO ENCONTRADA';\n      if(watchRoot&&watchRoot.visible&&lastValidAt&&(now-lastValidAt)<HOLD_VALID_MS)subtitle.textContent='MANTENIENDO · '+reason;\n      else{if(watchRoot)watchRoot.visible=false;subtitle.textContent=reason}\n    }\n  }\n  if(renderer3&&scene3&&camera3)renderer3.render(scene3,camera3);\n}\n\n`;
html = replaceBetweenRequired(html, 'function resetLab(){', 'openBtn.addEventListener', tailV2, 'reset/tick');
html = replaceRequired(html, "captureBtn.addEventListener('click',()=>captureReference().catch(e=>{console.error(e);subtitle.textContent='ERROR CAPTURA · '+(e?.message||String(e));captureBtn.disabled=false;camBtn.disabled=false;}));", "captureBtn.addEventListener('click',()=>{const job=mode==='scanning'?finishSweep():startSweep();job.catch(e=>{console.error(e);cleanupBanks();mode='ready';guideWrap.style.display='block';captureBtn.classList.remove('hidden');resetBtn.classList.add('hidden');captureBtn.disabled=false;camBtn.disabled=false;subtitle.textContent='ERROR V2 · '+(e?.message||String(e));updateCaptureUI()})});", 'listener captura');

await writeFile(indexPath, html);
await writeFile(`${DIST}/_headers`, `/*\n  Cache-Control: no-store, no-cache, must-revalidate\n\n/*.wasm\n  Content-Type: application/wasm\n  Cache-Control: public, max-age=31536000, immutable\n\n/*.glb\n  Cache-Control: public, max-age=31536000, immutable\n`);
await writeFile(`${DIST}/BUILD.txt`, `AMURA AR V2 SWEEP KEYFRAMES\nsource=${SOURCE}\ntime=${new Date().toISOString()}\n`);
console.log('Build V2 terminado: barrido continuo, keyframes automáticos y puente de perfil');
