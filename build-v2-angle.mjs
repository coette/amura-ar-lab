import { readFile, writeFile } from 'node:fs/promises';

const indexPath='dist/index.html';
let html=await readFile(indexPath,'utf8');

function replaceRequired(oldText,newText,label){
  if(!html.includes(oldText))throw new Error(`V2.4: no se encontró ${label}`);
  html=html.replace(oldText,newText);
}

replaceRequired(
  '<div id="buildBadge">BUILD V2.3 · COVERAGE TEST · 0→180</div>',
  '<div id="buildBadge">BUILD V2.4 · THETA CONTINUITY · 0→180</div>',
  'badge V2.3'
);

replaceRequired(
  '<title>AMURA · ORB V2.3 · COVERAGE TEST</title>',
  '<title>AMURA · ORB V2.4 · THETA CONTINUITY</title>',
  'title V2.3'
);

replaceRequired(
  "const AMURA_BUILD='V2.3-COVERAGE-STABLE-MATCHER-20260818';",
  "const AMURA_BUILD='V2.4-THETA-CONTINUITY-20260818';",
  'AMURA_BUILD V2.3'
);

replaceRequired(
  'const SWEEP_TARGETS=[0,.10,.20,.30,.38,.44,.48,.52,.56,.62,.70,.80,.90,1];',
  'const SWEEP_TARGETS=[0,.10,.20,.30,.38,.44,.48,.52,.56,.62,.70,.80,.90,1];\nconst THETA_LOCAL_RAD=Math.PI*34/180;\nconst THETA_MAX_STEP_RAD=Math.PI*10/180;\nconst THETA_BLEND=.62;',
  'constantes theta'
);

replaceRequired(
  'let scanFrames=[],scanStart=0,lastScanSample=0,scanFinishing=false,lastBankIndex=-1;',
  'let scanFrames=[],scanStart=0,lastScanSample=0,scanFinishing=false,lastBankIndex=-1;\nlet thetaState=null;',
  'estado theta'
);

replaceRequired(
  `  candidates.sort((a,b)=>b.score-a.score);\n  const best=candidates[0];\n  lastBankIndex=best.pose.bankIndex;\n  return best;`,
  `  candidates.sort((a,b)=>b.score-a.score);\n  const best=candidates[0];\n  if(thetaState===null){\n    thetaState=best.pose.viewAngle||0;\n  }else{\n    const local=candidates.filter(c=>Math.abs((c.pose.viewAngle||0)-thetaState)<=THETA_LOCAL_RAD);\n    const thetaCandidate=local.length?local[0]:best;\n    const desired=thetaCandidate.pose.viewAngle||0;\n    const delta=desired-thetaState;\n    const limited=Math.max(-THETA_MAX_STEP_RAD,Math.min(THETA_MAX_STEP_RAD,delta));\n    thetaState+=limited*THETA_BLEND;\n  }\n  thetaState=Math.max(-Math.PI,Math.min(0,thetaState));\n  best.pose.viewAngle=thetaState;\n  best.pose.viewLabel='θ '+Math.round(Math.abs(thetaState)*180/Math.PI)+'°';\n  lastBankIndex=best.pose.bankIndex;\n  return best;`,
  'cola matchFrame V2.3'
);

replaceRequired(
  'smoothed=null;lastValidAt=0;lastViewKey=null;lastPoseGate=null;pendingPoseGate=null;pendingPoseCount=0;lastBankIndex=-1;lastMatch=0;',
  'smoothed=null;lastValidAt=0;lastViewKey=null;lastPoseGate=null;pendingPoseGate=null;pendingPoseCount=0;lastBankIndex=-1;thetaState=null;lastMatch=0;',
  'reset theta al terminar calibración'
);

replaceRequired(
  "mode='ready';cleanupBanks();captureStep=0;scanFrames=[];scanStart=0;lastScanSample=0;scanFinishing=false;lastBankIndex=-1;",
  "mode='ready';cleanupBanks();captureStep=0;scanFrames=[];scanStart=0;lastScanSample=0;scanFinishing=false;lastBankIndex=-1;thetaState=null;",
  'reset theta laboratorio'
);

replaceRequired(
  "subtitle.textContent='V2.3 · '+r.pose.viewLabel+' · KF '+(r.pose.bankIndex+1)+'/'+banks.length+' · '+r.pose.inliers+' INLIERS'",
  "subtitle.textContent='V2.4 · '+r.pose.viewLabel+' · KF '+(r.pose.bankIndex+1)+'/'+banks.length+' · '+r.pose.inliers+' INLIERS'",
  'subtitle tracking'
);

replaceRequired(
  "subtitle.textContent='ERROR V2.3 · '+(e?.message||String(e));",
  "subtitle.textContent='ERROR V2.4 · '+(e?.message||String(e));",
  'error V2.3'
);

await writeFile(indexPath,html);
await writeFile('dist/BUILD.txt',`AMURA AR V2.4 THETA CONTINUITY\nsource=v2.3-coverage-plus-theta-only\ntime=${new Date().toISOString()}\n`);
console.log('V2.4 listo: misma cobertura y matcher; solo continuidad temporal de theta');
