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

// Mientras no exista un index.html propio en GitHub, clonamos el que ya está
// funcionando en producción. En las siguientes iteraciones ChatGPT actualizará
// index.html directamente en el repositorio y éste pasará a ser la fuente.
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

// V3D V1.1 — cambio único de laboratorio:
// recuperar la gestión de DMatch de la última versión 2D que funcionaba en iPhone.
// La V3D V1 empezó a borrar individualmente los DMatch devueltos por los vectores
// de OpenCV.js. En el build que usamos eso puede romper el matcher antes de generar
// una pose. No tocamos bancos, RANSAC, X/Y, zoom, roll ni ángulos 0/90/180.
const indexPath = `${DIST}/index.html`;
let html = await readFile(indexPath, 'utf8');
const brokenKnnLifetime = 'm1.delete(); if(m2)m2.delete(); v.delete();';
const fixedKnnLifetime = 'v.delete();';
const brokenFallbackLifetime = 'for(let i=0;i<mv.size();i++){const m=mv.get(i);good.push({q:m.queryIdx,t:m.trainIdx,d:m.distance});m.delete()}';
const fixedFallbackLifetime = 'for(let i=0;i<mv.size();i++){const m=mv.get(i);good.push({q:m.queryIdx,t:m.trainIdx,d:m.distance})}';

if (!html.includes(brokenKnnLifetime) || !html.includes(brokenFallbackLifetime)) {
  throw new Error('Hotfix V3D V1.1: no se encontró el matcher esperado; se aborta para no parchear otra build por accidente');
}

html = html
  .replace(brokenKnnLifetime, fixedKnnLifetime)
  .replace(brokenFallbackLifetime, fixedFallbackLifetime)
  .replace('BUILD V3D V1 · DORSO 0/90/180 · 20260818-2015', 'BUILD V3D V1.1 · MATCHER FIX · 0/90/180')
  .replace("V3D-V1-DORSO-PERFIL-PALMA-20260818-2015", "V3D-V1.1-MATCHER-FIX-0-90-180");

await writeFile(indexPath, html);
console.log('Aplicado V3D V1.1: matcher DMatch restaurado al comportamiento 2D estable');

await writeFile(`${DIST}/_headers`, `/*\n  Cache-Control: no-store, no-cache, must-revalidate\n\n/*.wasm\n  Content-Type: application/wasm\n  Cache-Control: public, max-age=31536000, immutable\n\n/*.glb\n  Cache-Control: public, max-age=31536000, immutable\n`);

await writeFile(`${DIST}/BUILD.txt`, `AMURA AR V3D V1.1 MATCHER FIX\nsource=${SOURCE}\ntime=${new Date().toISOString()}\n`);
console.log('Build terminado en dist/');
