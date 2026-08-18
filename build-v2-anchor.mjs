import { readFile, writeFile } from 'node:fs/promises';

const indexPath='dist/index.html';
let html=await readFile(indexPath,'utf8');

function replaceRequired(oldText,newText,label){
  if(!html.includes(oldText)) throw new Error(`V2.7: no se encontró ${label}`);
  html=html.replace(oldText,newText);
}

replaceRequired(
  '<div id="buildBadge">BUILD V2.6 · LOCAL KEYFRAMES · NO HAND GATE</div>',
  '<div id="buildBadge">BUILD V2.7 · FIXED WRIST ANCHOR · 0→180</div>',
  'badge V2.6'
);

replaceRequired(
  '<title>AMURA · ORB V2.6 · LOCAL KEYFRAMES</title>',
  '<title>AMURA · ORB V2.7 · FIXED WRIST ANCHOR</title>',
  'title V2.6'
);

replaceRequired(
  "const AMURA_BUILD='V2.6-LOCAL-KEYFRAMES-NO-HAND-GATE-20260818';",
  "const AMURA_BUILD='V2.7-FIXED-WRIST-ANCHOR-20260818';",
  'AMURA_BUILD V2.6'
);

replaceRequired(
  `  banks=[];\n  for(let i=0;i<selected.length;i++){`,
  `  banks=[];\n  const canonicalWatchAnchor={...selected[0].f.watchAnchor};\n  for(let i=0;i<selected.length;i++){`,
  'inicio creación banks'
);

replaceRequired(
  `watchAnchor:f.watchAnchor,refs:[]`,
  `watchAnchor:canonicalWatchAnchor,refs:[]`,
  'watchAnchor por keyframe'
);

replaceRequired(
  "subtitle.textContent='V2.6 · '+banks.length+' REFERENCIAS LOCALES · '+total+' PUNTOS';",
  "subtitle.textContent='V2.7 · ANCLA FIJA · '+banks.length+' REFERENCIAS · '+total+' PUNTOS';",
  'subtitle referencias V2.6'
);

replaceRequired(
  "subtitle.textContent='V2.6 · '+r.pose.viewLabel+' · KF '+(r.pose.bankIndex+1)+'/'+banks.length+' · '+r.pose.inliers+' INLIERS'",
  "subtitle.textContent='V2.7 · '+r.pose.viewLabel+' · KF '+(r.pose.bankIndex+1)+'/'+banks.length+' · '+r.pose.inliers+' INLIERS'",
  'subtitle tracking V2.6'
);

replaceRequired(
  "subtitle.textContent='ERROR V2.6 · '+(e?.message||String(e));",
  "subtitle.textContent='ERROR V2.7 · '+(e?.message||String(e));",
  'error V2.6'
);

await writeFile(indexPath,html);
await writeFile('dist/BUILD.txt',`AMURA AR V2.7 FIXED WRIST ANCHOR\nsource=v2.6-same-matcher-same-keyframes-fixed-anchor-only\ntime=${new Date().toISOString()}\n`);
console.log('V2.7 listo: todos los keyframes comparten el ancla DORSO; matcher/ángulos/escala sin cambios');
