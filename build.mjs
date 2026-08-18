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

async function ensureDir(path) {
  await mkdir(dirname(path), { recursive: true });
}

async function download(path) {
  const url = `${SOURCE}/${path}`;
  console.log('GET', url);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`No se pudo descargar ${url}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const out = `${DIST}/${path}`;
  await ensureDir(out);
  await writeFile(out, bytes);
}

await mkdir(DIST, { recursive: true });

for (const asset of assets) await download(asset);

try {
  await access('index.html');
  await copyFile('index.html', `${DIST}/index.html`);
  console.log('Usando index.html del repositorio');
} catch {
  const res = await fetch(`${SOURCE}/index.html`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`No se pudo descargar index.html actual: ${res.status}`);
  await writeFile(`${DIST}/index.html`, new Uint8Array(await res.arrayBuffer()));
  console.log('Bootstrap: usando index.html del despliegue actual');
}

// V3D — mantener el matcher con la gestión de DMatch de la última versión 2D estable.
const indexPath = `${DIST}/index.html`;
let html = await readFile(indexPath, 'utf8');
const brokenKnnLifetime = 'm1.delete(); if(m2)m2.delete(); v.delete();';
const fixedKnnLifetime = 'v.delete();';
const brokenFallbackLifetime = 'for(let i=0;i<mv.size();i++){const m=mv.get(i);good.push({q:m.queryIdx,t:m.trainIdx,d:m.distance});m.delete()}';
const fixedFallbackLifetime = 'for(let i=0;i<mv.size();i++){const m=mv.get(i);good.push({q:m.queryIdx,t:m.trainIdx,d:m.distance})}';

if (!html.includes(brokenKnnLifetime) || !html.includes(brokenFallbackLifetime)) {
  throw new Error('V3D: no se encontró el matcher esperado; se aborta para no parchear otra build por accidente');
}

html = html
  .replace(brokenKnnLifetime, fixedKnnLifetime)
  .replace(brokenFallbackLifetime, fixedFallbackLifetime)
  .replace('BUILD V3D V1 · DORSO 0/90/180 · 20260818-2015', 'BUILD V3D V1.1 · MATCHER FIX · 0/90/180')
  .replace("V3D-V1-DORSO-PERFIL-PALMA-20260818-2015", "V3D-V1.1-MATCHER-FIX-0-90-180");

// V3D V1.3 — la rotación DORSO/PERFIL/PALMA bascula el reloj sobre X.
const wrongViewAxis = 'new THREE.Vector3(0,1,0),smoothed.viewAngle||0';
const correctViewAxis = 'new THREE.Vector3(1,0,0),smoothed.viewAngle||0';

if (!html.includes(wrongViewAxis)) {
  throw new Error('V3D V1.3: no se encontró el eje Y de qView esperado; se aborta para no tocar otra build por accidente');
}

html = html
  .replace(wrongViewAxis, correctViewAxis)
  .replace('BUILD V3D V1.1 · MATCHER FIX · 0/90/180', 'BUILD V3D V1.3 · PROFILE AXIS X · 0/90/180')
  .replace('V3D-V1.1-MATCHER-FIX-0-90-180', 'V3D-V1.3-PROFILE-AXIS-X-0-90-180');

// V3D V1.4 — invertir el sentido de PERFIL 90°.
const wrongProfileAngle = "{key:'perfil',label:'PERFIL 90°',viewAngle:Math.PI/2}";
const correctProfileAngle = "{key:'perfil',label:'PERFIL 90°',viewAngle:-Math.PI/2}";

if (!html.includes(wrongProfileAngle)) {
  throw new Error('V3D V1.4: no se encontró PERFIL +90° esperado; se aborta para no tocar otra build por accidente');
}

html = html
  .replace(wrongProfileAngle, correctProfileAngle)
  .replace('BUILD V3D V1.3 · PROFILE AXIS X · 0/90/180', 'BUILD V3D V1.4 · PROFILE -90 · 0/90/180')
  .replace('V3D-V1.3-PROFILE-AXIS-X-0-90-180', 'V3D-V1.4-PROFILE-MINUS-90-0-90-180');

// V3D V1.5 — puerta de estabilidad para coincidencias débiles.
// Los movimientos normales siguen entrando; solo rechazamos saltos bruscos si ORB tiene poca evidencia.
const oldLastView = 'let lastViewKey=null;';
const newLastView = 'let lastViewKey=null;\nlet lastPoseGate=null;';
const oldCleanup = 'banks=[];\n  lastViewKey=null;';
const newCleanup = 'banks=[];\n  lastViewKey=null;\n  lastPoseGate=null;';
const oldBestReturn = `  candidates.sort((a,b)=>b.score-a.score);\n  let best=candidates[0];\n  if(lastViewKey&&best.pose.viewKey!==lastViewKey){const current=candidates.find(c=>c.pose.viewKey===lastViewKey);if(current&&current.score>best.score-1.8)best=current}\n  lastViewKey=best.pose.viewKey;\n  return best;`;
const newBestReturn = `  candidates.sort((a,b)=>b.score-a.score);\n  let best=candidates[0];\n  if(lastViewKey&&best.pose.viewKey!==lastViewKey){const current=candidates.find(c=>c.pose.viewKey===lastViewKey);if(current&&current.score>best.score-1.8)best=current}\n  const p=best.pose;\n  if(lastPoseGate){\n    const jump=Math.hypot(p.cx-lastPoseGate.cx,p.cy-lastPoseGate.cy);\n    const zoomJump=Math.abs(Math.log(Math.max(p.scaleRatio,1e-6)/Math.max(lastPoseGate.scaleRatio,1e-6)));\n    const rollJump=Math.abs(Math.atan2(Math.sin(p.roll-lastPoseGate.roll),Math.cos(p.roll-lastPoseGate.roll)));\n    const viewJump=p.viewKey!==lastPoseGate.viewKey;\n    const suspicious=jump>workCanvas.width*.16||zoomJump>.28||rollJump>.55||viewJump;\n    const strong=p.inliers>=6&&p.meanErr<=5.0;\n    if(suspicious&&!strong)return{ok:false,reason:'POSE INESTABLE · '+p.inliers+' INLIERS'};\n  }\n  lastPoseGate={cx:p.cx,cy:p.cy,scaleRatio:p.scaleRatio,roll:p.roll,viewKey:p.viewKey};\n  lastViewKey=p.viewKey;\n  return best;`;

if (!html.includes(oldLastView) || !html.includes(oldCleanup) || !html.includes(oldBestReturn)) {
  throw new Error('V3D V1.5: no se encontró el bloque esperado para la puerta de estabilidad');
}

html = html
  .replace(oldLastView, newLastView)
  .replace(oldCleanup, newCleanup)
  .replace(oldBestReturn, newBestReturn)
  .replace('BUILD V3D V1.4 · PROFILE -90 · 0/90/180', 'BUILD V3D V1.5 · STABILITY GATE · 0/90/180')
  .replace('V3D-V1.4-PROFILE-MINUS-90-0-90-180', 'V3D-V1.5-STABILITY-GATE-0-90-180');

await writeFile(indexPath, html);
console.log('Aplicado V3D V1.5: matcher estable + orientación corregida + puerta de estabilidad');

await writeFile(`${DIST}/_headers`, `/*\n  Cache-Control: no-store, no-cache, must-revalidate\n\n/*.wasm\n  Content-Type: application/wasm\n  Cache-Control: public, max-age=31536000, immutable\n\n/*.glb\n  Cache-Control: public, max-age=31536000, immutable\n`);

await writeFile(`${DIST}/BUILD.txt`, `AMURA AR V3D V1.5 STABILITY GATE\nsource=${SOURCE}\ntime=${new Date().toISOString()}\n`);
console.log('Build terminado en dist/');
