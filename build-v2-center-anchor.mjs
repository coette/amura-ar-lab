import { readFile, writeFile } from 'node:fs/promises';

const indexPath='dist/index.html';
let html=await readFile(indexPath,'utf8');

function replaceRequired(oldText,newText,label){
  if(!html.includes(oldText)) throw new Error(`V2.8: no se encontró ${label}`);
  html=html.replace(oldText,newText);
}

replaceRequired(
  '<div id="buildBadge">BUILD V2.7 · FIXED WRIST ANCHOR · 0→180</div>',
  '<div id="buildBadge">BUILD V2.8 · ROI CENTER ANCHOR · 0→180</div>',
  'badge V2.7'
);

replaceRequired(
  '<title>AMURA · ORB V2.7 · FIXED WRIST ANCHOR</title>',
  '<title>AMURA · ORB V2.8 · ROI CENTER ANCHOR</title>',
  'title V2.7'
);

replaceRequired(
  "const AMURA_BUILD='V2.7-FIXED-WRIST-ANCHOR-20260818';",
  "const AMURA_BUILD='V2.8-ROI-CENTER-ANCHOR-20260818';",
  'AMURA_BUILD V2.7'
);

replaceRequired(
  '  const canonicalWatchAnchor={...selected[0].f.watchAnchor};\n',
  '',
  'ancla canónica V2.7'
);

replaceRequired(
  'watchAnchor:canonicalWatchAnchor,refs:[]',
  'watchAnchor:{x:f.rect.w/2,y:f.rect.h/2},refs:[]',
  'watchAnchor V2.7'
);

replaceRequired(
  "subtitle.textContent='V2.7 · ANCLA FIJA · '+banks.length+' REFERENCIAS · '+total+' PUNTOS';",
  "subtitle.textContent='V2.8 · CENTRO ROI · '+banks.length+' REFERENCIAS · '+total+' PUNTOS';",
  'subtitle referencias V2.7'
);

replaceRequired(
  "subtitle.textContent='V2.7 · '+r.pose.viewLabel+' · KF '+(r.pose.bankIndex+1)+'/'+banks.length+' · '+r.pose.inliers+' INLIERS'",
  "subtitle.textContent='V2.8 · '+r.pose.viewLabel+' · KF '+(r.pose.bankIndex+1)+'/'+banks.length+' · '+r.pose.inliers+' INLIERS'",
  'subtitle tracking V2.7'
);

replaceRequired(
  "subtitle.textContent='ERROR V2.7 · '+(e?.message||String(e));",
  "subtitle.textContent='ERROR V2.8 · '+(e?.message||String(e));",
  'error V2.7'
);

await writeFile(indexPath,html);
await writeFile('dist/BUILD.txt',`AMURA AR V2.8 ROI CENTER ANCHOR\nsource=v2.7-center-of-each-reference-roi-only\ntime=${new Date().toISOString()}\n`);
console.log('V2.8 listo: cada keyframe usa el centro geométrico de su propio ROI; sin MediaPipe ni ancla heredada para posición');
