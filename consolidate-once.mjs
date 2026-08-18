import { readFile, writeFile, rm } from 'node:fs/promises';

const finalPath='dist/index.html';
let html=await readFile(finalPath,'utf8');

function replaceRequired(oldText,newText,label){
  if(!html.includes(oldText)) throw new Error(`Consolidación V2.9: no se encontró ${label}`);
  html=html.replace(oldText,newText);
}

replaceRequired('BUILD V2.8 · ROI CENTER ANCHOR · 0→180','BUILD V2.9 · PHYSICAL ANCHOR DIAGNOSTIC · TOP3','badge');
replaceRequired('<title>AMURA · ORB V2.8 · ROI CENTER ANCHOR</title>','<title>AMURA · ORB V2.9 · PHYSICAL ANCHOR DIAGNOSTIC</title>','title');
replaceRequired("const AMURA_BUILD='V2.8-ROI-CENTER-ANCHOR-20260818';","const AMURA_BUILD='V2.9-PHYSICAL-ANCHOR-TOP3-20260818';",'build id');
replaceRequired('<div id="top"><div id="brand">AMURA · ORB V2.3 · COVERAGE</div><div id="subtitle">DORSO arriba · pulsa ESCANEAR</div></div>','<div id="top"><div id="brand">AMURA · ORB V2.9 · ANCHOR DIAGNOSTIC</div><div id="subtitle">DORSO arriba · pulsa ESCANEAR</div></div>','brand');
replaceRequired('<h1>Relocalización 3D · V2.3</h1>','<h1>Diagnóstico de ancla física · V2.9</h1>','h1');
replaceRequired('<p>1 segundo DORSO quieto, 6 segundos siguiendo la barra hasta PALMA y 1 segundo PALMA quieta. Esta versión prioriza cobertura: 14 referencias garantizadas y el matcher estable de V1.6.</p>','<p>1 segundo DORSO, 6 segundos de giro y 1 segundo PALMA. Solo se aceptan keyframes con landmarks válidos. Al terminar se muestran los 3 mejores candidatos ORB; reloj y tríada permanecen ocultos.</p>','instructions');

replaceRequired(
  "  scanFrames.push({canvas:c,rect,t:Math.max(0,now-scanStart),handSeen,watchAnchor:computeWatchAnchorRef(rect),casePxWork:computeInitialCasePxWork(rect)});",
  "  const landmarksOk=!!(latestLandmarks&&latestLandmarks.length>=18&&handSeen);\n  scanFrames.push({canvas:c,rect,t:Math.max(0,now-scanStart),handSeen,landmarksOk,watchAnchor:computeWatchAnchorRef(rect),casePxWork:computeInitialCasePxWork(rect)});",
  'capture landmarksOk'
);
replaceRequired(
  "  const valid=x=>!used.has(x)&&x.ref.n>=10&&!x.ref.desc.empty();",
  "  const valid=x=>!used.has(x)&&x.landmarksOk&&x.ref.n>=10&&!x.ref.desc.empty();",
  'hard landmarks gate'
);
replaceRequired(
`  const used=new Set(),selected=[];
  for(const p of SWEEP_TARGETS){
    const f=pickTargetFrame(raw,p,used);
    if(!f)throw new Error('Falta referencia cerca de '+Math.round(p*180)+'°');
    used.add(f);selected.push({f,p});
  }`,
`  const used=new Set(),selected=[];
  for(const p of SWEEP_TARGETS){
    const f=pickTargetFrame(raw,p,used);
    if(!f)continue;
    used.add(f);selected.push({f,p});
  }
  if(selected.length<6)throw new Error('Solo '+selected.length+' keyframes con landmarks · mínimo 6');`,
  'selection min 6'
);
replaceRequired(
`  banks=[];
  for(let i=0;i<selected.length;i++){
    const {f,p}=selected[i];
    const deg=Math.round(p*180);
    banks.push({key:'kf'+i,label:deg+'°',viewAngle:-Math.PI*p,bankIndex:i,rect:f.rect,canvas:f.canvas,casePxWork:f.casePxWork,watchAnchor:{x:f.rect.w/2,y:f.rect.h/2},refs:[]});
  }`,
`  banks=[];
  const canonicalCasePxWork=selected[0].f.casePxWork;
  for(let i=0;i<selected.length;i++){
    const {f,p}=selected[i];
    const deg=Math.round(p*180);
    banks.push({key:'kf'+i,label:deg+'°',viewAngle:-Math.PI*p,bankIndex:i,rect:f.rect,canvas:f.canvas,casePxWork:canonicalCasePxWork,watchAnchor:f.watchAnchor,refs:[]});
  }`,
  'physical anchor + canonical scale'
);
replaceRequired("subtitle.textContent='V2.8 · CENTRO ROI · '+banks.length+' REFERENCIAS · '+total+' PUNTOS';","subtitle.textContent='V2.9 · DIAGNÓSTICO ANCLA · '+banks.length+' KEYFRAMES · '+total+' PUNTOS';",'finish subtitle');
replaceRequired("subtitle.textContent='ERROR V2.8 · '+(e?.message||String(e));","subtitle.textContent='ERROR V2.9 · '+(e?.message||String(e));",'error label');
replaceRequired('score:T.inliers*7+T.ratio*90-T.meanErr*2.2-(refEntry.scale!==1?0.8:0)','score:T.inliers*7-T.meanErr*2.2','score');
replaceRequired(
`  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0];
  lastBankIndex=best.pose.bankIndex;
  return best;
}`,
`  candidates.sort((a,b)=>b.score-a.score);
  const topCandidates=candidates.slice(0,3);
  lastBankIndex=topCandidates[0].pose.bankIndex;
  return{ok:true,candidates:topCandidates};
}`,
  'top3 matchFrame'
);
replaceRequired(
'function drawWatch(p){',
`function drawDiagnosticCandidates(candidates){
  const sr=stageRect();
  mpCtx.clearRect(0,0,sr.width,sr.height);
  const colors=['#ff3b30','#35e06f','#2997ff'];
  mpCtx.save();
  mpCtx.font='700 13px -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif';
  mpCtx.textBaseline='middle';
  for(let i=0;i<candidates.length;i++){
    const p=candidates[i].pose;
    const x=p.cx/workCanvas.width*sr.width;
    const y=p.cy/workCanvas.height*sr.height;
    const color=colors[i%colors.length];
    mpCtx.fillStyle=color;mpCtx.strokeStyle='#fff';mpCtx.lineWidth=2;
    mpCtx.beginPath();mpCtx.arc(x,y,8,0,Math.PI*2);mpCtx.fill();mpCtx.stroke();
    const label='KF '+(p.bankIndex+1)+' · '+p.inliers+' inliers';
    mpCtx.lineWidth=4;mpCtx.strokeStyle='rgba(0,0,0,.88)';mpCtx.strokeText(label,x+13,y);
    mpCtx.fillStyle=color;mpCtx.fillText(label,x+13,y);
  }
  mpCtx.restore();
}

function drawWatch(p){`,
  'diagnostic renderer'
);
replaceRequired(
  "  if(mode==='ready'||mode==='scanning'){detectHand(now);drawLandmarks()}else{const r=stageRect();mpCtx.clearRect(0,0,r.width,r.height)}",
  "  if(mode==='ready'||mode==='scanning'){detectHand(now);drawLandmarks()}else if(mode!=='tracking'){const r=stageRect();mpCtx.clearRect(0,0,r.width,r.height)}",
  'tracking canvas persistence'
);
replaceRequired(
`  if(mode==='tracking'&&now-lastMatch>=MATCH_MS){
    lastMatch=now;const r=matchFrame();
    if(r&&r.ok){drawWatch(r.pose);lastValidAt=now;subtitle.textContent='V2.8 · '+r.pose.viewLabel+' · KF '+(r.pose.bankIndex+1)+'/'+banks.length+' · '+r.pose.inliers+' INLIERS'}
    else{const reason=(r&&r.reason)?r.reason:'NO ENCONTRADA';if(watchRoot&&watchRoot.visible&&lastValidAt&&(now-lastValidAt)<HOLD_VALID_MS)subtitle.textContent='MANTENIENDO · '+reason;else{if(watchRoot)watchRoot.visible=false;subtitle.textContent=reason}}
  }`,
`  if(mode==='tracking'&&now-lastMatch>=MATCH_MS){
    lastMatch=now;const r=matchFrame();
    if(watchRoot)watchRoot.visible=false;
    if(r&&r.ok){
      drawDiagnosticCandidates(r.candidates);
      const b=r.candidates[0];
      subtitle.textContent='V2.9 · TOP3 · MEJOR KF '+(b.pose.bankIndex+1)+'/'+banks.length+' · '+b.pose.inliers+' INLIERS';
    }else{
      const sr=stageRect();mpCtx.clearRect(0,0,sr.width,sr.height);
      subtitle.textContent=(r&&r.reason)?r.reason:'NO ENCONTRADA';
    }
  }`,
  'diagnostic tick'
);

const assetSource='https://amura-assets-v272-coette.pages.dev';
const simpleBuild=`import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const SOURCE='${assetSource}';
const DIST='dist';
const assets=[
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
async function ensureDir(path){await mkdir(dirname(path),{recursive:true})}
async function download(path){
  const url=\`${assetSource}/\${path}\`;
  const res=await fetch(url,{cache:'no-store'});
  if(!res.ok)throw new Error(\`No se pudo descargar \${url}: \${res.status}\`);
  const out=\`\${DIST}/\${path}\`;await ensureDir(out);await writeFile(out,new Uint8Array(await res.arrayBuffer()));
}
await mkdir(DIST,{recursive:true});
await copyFile('index.html',\`\${DIST}/index.html\`);
for(const asset of assets)await download(asset);
await writeFile(\`\${DIST}/_headers\`,\`/*\\n  Cache-Control: no-store, no-cache, must-revalidate\\n\\n/*.wasm\\n  Content-Type: application/wasm\\n  Cache-Control: public, max-age=31536000, immutable\\n\\n/*.glb\\n  Cache-Control: public, max-age=31536000, immutable\\n\`);
await writeFile(\`\${DIST}/BUILD.txt\`,\`AMURA AR V2.9 PHYSICAL ANCHOR DIAGNOSTIC TOP3\\nassets=${assetSource}\\ntime=\${new Date().toISOString()}\\n\`);
console.log('Build consolidado: index.html + assets V272 desde origen fijo');
`;

const packageJson=`{
  "name": "amura-ar-lab",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "build": "node build.mjs"
  }
}
`;

const finalWorkflow=`name: Deploy AMURA AR to Cloudflare Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Build current lab
        run: npm run build

      - name: Deploy to existing Cloudflare Pages project
        run: npx --yes wrangler@latest pages deploy dist --project-name=amura-engine-2 --branch=main
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Remove old Cloudflare Pages deployments
        shell: bash
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          sleep 5
          prod_id=""
          while :; do
            ids=$(npx --yes wrangler@latest pages deployment list --project-name amura-engine-2 --json | jq -r '.[].Id')
            to_delete=$(echo "$ids" | grep -v -F -x "$prod_id" | grep . || true)
            [ -z "$to_delete" ] && { echo "Cleanup complete. Production kept: $prod_id"; break; }
            while IFS= read -r id; do
              [ -z "$id" ] && continue
              if ! npx --yes wrangler@latest pages deployment delete "$id" --project-name amura-engine-2 --force 2>&1 | tee /tmp/wrangler-del.log | grep -q "Successfully deleted"; then
                if grep -qi "active production deployment" /tmp/wrangler-del.log; then
                  prod_id="$id"; echo "Keeping active production deployment: $prod_id"
                else
                  echo "Could not delete deployment $id"; cat /tmp/wrangler-del.log
                fi
              else
                echo "Deleted old deployment: $id"
              fi
            done <<< "$to_delete"
          done
`;

await writeFile('index.html',html);
await writeFile('dist/index.html',html);
await writeFile('build.mjs',simpleBuild);
await writeFile('package.json',packageJson);
await writeFile('.github/workflows/deploy.yml',finalWorkflow);
for(const f of ['build-v2.mjs','build-v2-keyframes.mjs','build-v2-anchor.mjs','build-v2-center-anchor.mjs'])await rm(f,{force:true});
await rm('consolidate-once.mjs',{force:true});
console.log('Consolidación V2.9 preparada en el working tree');
