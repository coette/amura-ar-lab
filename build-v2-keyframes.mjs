import { readFile, writeFile } from 'node:fs/promises';

const indexPath='dist/index.html';
let html=await readFile(indexPath,'utf8');

function replaceRequired(oldText,newText,label){
  if(!html.includes(oldText)) throw new Error(`V2.5: no se encontró ${label}`);
  html=html.replace(oldText,newText);
}

replaceRequired(
  '<div id="buildBadge">BUILD V2.3 · COVERAGE TEST · 0→180</div>',
  '<div id="buildBadge">BUILD V2.5 · LOCAL KEYFRAMES · 0→180</div>',
  'badge V2.3'
);

replaceRequired(
  '<title>AMURA · ORB V2.3 · COVERAGE TEST</title>',
  '<title>AMURA · ORB V2.5 · LOCAL KEYFRAMES</title>',
  'title V2.3'
);

replaceRequired(
  "const AMURA_BUILD='V2.3-COVERAGE-STABLE-MATCHER-20260818';",
  "const AMURA_BUILD='V2.5-LOCAL-KEYFRAMES-20260818';",
  'AMURA_BUILD V2.3'
);

const oldPicker=`function pickTargetFrame(raw,p,used){
  const targetT=p<=0?650:p>=1?SCAN_HOLD_START_MS+SCAN_MOVE_MS+650:SCAN_HOLD_START_MS+p*SCAN_MOVE_MS;
  const profile=p>=.44&&p<=.56;
  const radius=profile?380:300;
  let pool=raw.filter(x=>!used.has(x)&&Math.abs(x.t-targetT)<=radius&&x.ref.n>=10&&!x.ref.desc.empty());
  if(!profile){const hand=pool.filter(x=>x.handSeen);if(hand.length)pool=hand}
  if(!pool.length)pool=raw.filter(x=>!used.has(x)&&x.ref.n>=10&&!x.ref.desc.empty()).sort((a,b)=>Math.abs(a.t-targetT)-Math.abs(b.t,targetT)).slice(0,6);
  pool.sort((a,b)=>{const dn=b.ref.n-a.ref.n;if(Math.abs(dn)>=4)return dn;return Math.abs(a.t-targetT)-Math.abs(b.t-targetT)});
  return pool[0]||null;
}`;

// build-v2.mjs emitted the fallback with Math.abs(b.t-targetT); accept that exact block too.
const oldPickerExact=`function pickTargetFrame(raw,p,used){
  const targetT=p<=0?650:p>=1?SCAN_HOLD_START_MS+SCAN_MOVE_MS+650:SCAN_HOLD_START_MS+p*SCAN_MOVE_MS;
  const profile=p>=.44&&p<=.56;
  const radius=profile?380:300;
  let pool=raw.filter(x=>!used.has(x)&&Math.abs(x.t-targetT)<=radius&&x.ref.n>=10&&!x.ref.desc.empty());
  if(!profile){const hand=pool.filter(x=>x.handSeen);if(hand.length)pool=hand}
  if(!pool.length)pool=raw.filter(x=>!used.has(x)&&x.ref.n>=10&&!x.ref.desc.empty()).sort((a,b)=>Math.abs(a.t-targetT)-Math.abs(b.t-targetT)).slice(0,6);
  pool.sort((a,b)=>{const dn=b.ref.n-a.ref.n;if(Math.abs(dn)>=4)return dn;return Math.abs(a.t-targetT)-Math.abs(b.t-targetT)});
  return pool[0]||null;
}`;

const newPicker=`function pickTargetFrame(raw,p,used){
  const targetT=p<=0?650:p>=1?SCAN_HOLD_START_MS+SCAN_MOVE_MS+650:SCAN_HOLD_START_MS+p*SCAN_MOVE_MS;
  const profile=p>=.44&&p<=.56;
  const needHand=!profile;
  const valid=x=>!used.has(x)&&x.ref.n>=10&&!x.ref.desc.empty()&&(!needHand||x.handSeen);
  const tightRadius=240;
  const maxRadius=profile?520:420;
  let pool=raw.filter(x=>valid(x)&&Math.abs(x.t-targetT)<=tightRadius);
  if(!pool.length)pool=raw.filter(x=>valid(x)&&Math.abs(x.t-targetT)<=maxRadius);
  if(!pool.length)return null;
  pool.sort((a,b)=>{
    const dtA=Math.abs(a.t-targetT),dtB=Math.abs(b.t-targetT);
    const scoreA=a.ref.n-dtA*.08,scoreB=b.ref.n-dtB*.08;
    return scoreB-scoreA;
  });
  return pool[0]||null;
}`;

if(html.includes(oldPickerExact)) html=html.replace(oldPickerExact,newPicker);
else if(html.includes(oldPicker)) html=html.replace(oldPicker,newPicker);
else throw new Error('V2.5: no se encontró pickTargetFrame V2.3');

replaceRequired(
  "subtitle.textContent='V2.3 · '+banks.length+' REFERENCIAS · '+total+' PUNTOS';",
  "subtitle.textContent='V2.5 · '+banks.length+' REFERENCIAS LOCALES · '+total+' PUNTOS';",
  'subtitle referencias'
);

replaceRequired(
  "subtitle.textContent='V2.3 · '+r.pose.viewLabel+' · KF '+(r.pose.bankIndex+1)+'/'+banks.length+' · '+r.pose.inliers+' INLIERS'",
  "subtitle.textContent='V2.5 · '+r.pose.viewLabel+' · KF '+(r.pose.bankIndex+1)+'/'+banks.length+' · '+r.pose.inliers+' INLIERS'",
  'subtitle tracking'
);

replaceRequired(
  "subtitle.textContent='ERROR V2.3 · '+(e?.message||String(e));",
  "subtitle.textContent='ERROR V2.5 · '+(e?.message||String(e));",
  'error V2.3'
);

await writeFile(indexPath,html);
await writeFile('dist/BUILD.txt',`AMURA AR V2.5 LOCAL KEYFRAMES\nsource=v2.3-without-global-scan-fallback\ntime=${new Date().toISOString()}\n`);
console.log('V2.5 listo: cada keyframe debe proceder de su ventana temporal real; sin fallback global');
