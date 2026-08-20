import { analyzeBankImage, analysisPoint, directionAngle, axisErrorDegrees } from "./static-bank-analyzer.js?v=r14.1";

const BANK_BASE = "./test-bank/2026-08-20-banco-base/";
const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const BANK = [
  {file:"postura_01_000deg.jpg",target:0,live:{roi:173.94,pca:169.12,final:174.67},p0:[169.20,250.24],finalMid:[76.52,247.25]},
  {file:"postura_02_030deg.jpg",target:30,live:{roi:171.55,pca:170.44,final:170.78},p0:[195.84,273.28],finalMid:[80.54,288.24]},
  {file:"postura_03_060deg.jpg",target:60,live:{roi:172.21,pca:172.30,final:170.35},p0:null,finalMid:[88.42,279.01],accumulated:true},
  {file:"postura_04_090deg.jpg",target:90,live:{roi:171.32,pca:169.36,final:169.47},p0:[127.80,288.00],finalMid:[69.59,282.98]},
  {file:"postura_05_135deg.jpg",target:135,live:{roi:164.49,pca:163.16,final:168.42},p0:[140.04,282.88],finalMid:[69.40,287.02]},
  {file:"postura_06_150deg.jpg",target:150,live:{roi:162.00,pca:149.71,final:159.52},p0:[148.68,271.36],finalMid:[64.11,287.46]},
  {file:"postura_07_165deg.jpg",target:165,live:{roi:161.51,pca:150.89,final:162.38},p0:[147.24,281.60],finalMid:[65.21,297.59]},
  {file:"postura_08_180deg.jpg",target:180,live:{roi:151.71,pca:130.07,final:138.75},p0:[120.96,277.12],finalMid:[55.89,318.66]}
];

let bankIndex=0,bankOpen=false,runToken=0,current=null,marking=false,manualDraft=[];
const selectedCaptures=new Map();
const manualRefs=new Map();

function fmt(v){return Number.isFinite(v)?v.toFixed(1)+"°":"—";}
function setStatus(t){const e=document.getElementById("r13BankStatus");if(e)e.textContent=t;}
function setBusy(v){
  document.getElementById("r13BankPrev")?.toggleAttribute("disabled",v);
  document.getElementById("r13BankNext")?.toggleAttribute("disabled",v);
  document.getElementById("r13CaptureToggle")?.toggleAttribute("disabled",v||!current);
  document.getElementById("r13CaptureUpdate")?.toggleAttribute("disabled",v||!current);
  document.getElementById("r14ManualMark")?.toggleAttribute("disabled",v||!current);
}
function resetAllState(){
  runToken+=1;current=null;marking=false;manualDraft=[];
  const c=document.getElementById("r13BankCanvas");if(c)c.getContext("2d")?.clearRect(0,0,c.width,c.height);
  setStatus("RESET TOTAL · ESTA FOTO NO HEREDA ESTADO DE LA ANTERIOR");
  updateCaptureUi();updateManualUi();
}

function jpeg(bytes){return bytes?.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;}
function b64bytes(text){const bin=atob(text),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;}
async function loadPhoto(file){
  const r=await fetch(`${BANK_BASE}${file}?v=r14.1`,{cache:"no-store"});if(!r.ok)throw new Error(`foto HTTP ${r.status}`);let bytes=new Uint8Array(await r.arrayBuffer());
  for(let depth=0;depth<4&&!jpeg(bytes);depth++){const text=new TextDecoder().decode(bytes).replace(/\s+/g,"");if(!text||!/^[A-Za-z0-9+/=]+$/.test(text))break;bytes=b64bytes(text);}
  if(!jpeg(bytes))throw new Error("la foto guardada no contiene un JPEG válido");
  const url=URL.createObjectURL(new Blob([bytes],{type:"image/jpeg"}));
  try{const image=new Image();image.decoding="async";await new Promise((ok,no)=>{image.onload=ok;image.onerror=()=>no(new Error("JPEG no decodificable"));image.src=url;});return image;}
  finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
}

function drawLine(ctx,o,d,len,color,width,dash=[]){if(!o||!d)return;ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap="round";ctx.setLineDash(dash);ctx.beginPath();ctx.moveTo(o.x,o.y);ctx.lineTo(o.x+d.x*len,o.y+d.y*len);ctx.stroke();ctx.restore();}
function drawMp(ctx,mp,w,h){const lm=mp?.landmarks?.[0];if(!lm)return;ctx.save();ctx.strokeStyle="rgba(202,117,255,.9)";ctx.fillStyle="rgba(222,161,255,.98)";ctx.lineWidth=1.5;for(const [a,b] of CONNECTIONS){if(!lm[a]||!lm[b])continue;ctx.beginPath();ctx.moveTo(lm[a].x*w,lm[a].y*h);ctx.lineTo(lm[b].x*w,lm[b].y*h);ctx.stroke();}for(const p of lm){ctx.beginPath();ctx.arc(p.x*w,p.y*h,2.5,0,Math.PI*2);ctx.fill();}ctx.restore();}
function manualAngle(points){if(!points||points.length<2)return null;return Math.atan2(points[1].y-points[0].y,points[1].x-points[0].x)*180/Math.PI;}
function drawManual(ctx,points){if(!points?.length)return;ctx.save();ctx.strokeStyle="#ff5b5b";ctx.fillStyle="#ff5b5b";ctx.lineWidth=4;if(points.length>1){ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);ctx.lineTo(points[1].x,points[1].y);ctx.stroke();}for(const [i,p] of points.entries()){ctx.beginPath();ctx.arc(p.x,p.y,7,0,Math.PI*2);ctx.fill();ctx.fillStyle="#fff";ctx.font="700 10px Arial";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(String(i+1),p.x,p.y);ctx.fillStyle="#ff5b5b";}ctx.restore();}

function render(){
  if(!current)return;
  const {item,result}=current,canvas=document.getElementById("r13BankCanvas"),ctx=canvas.getContext("2d");
  canvas.width=result.width;canvas.height=result.height;ctx.putImageData(result.clean,0,0);
  const over=document.createElement("canvas");over.width=result.width;over.height=result.height;const oc=over.getContext("2d"),id=oc.createImageData(result.width,result.height);
  for(let i=0;i<result.mask.length;i++)if(result.mask[i]){const j=i*4;id.data[j]=0;id.data[j+1]=229;id.data[j+2]=255;id.data[j+3]=92;}
  oc.putImageData(id,0,0);ctx.drawImage(over,0,0);drawMp(ctx,result.mp,result.width,result.height);

  const g=result.geometry;
  if(g){const corners=[analysisPoint(g,g.roiStart,-g.roiHalfWidth),analysisPoint(g,g.roiEnd,-g.roiHalfWidth),analysisPoint(g,g.roiEnd,g.roiHalfWidth),analysisPoint(g,g.roiStart,g.roiHalfWidth)];ctx.save();ctx.strokeStyle="rgba(255,210,80,.8)";ctx.lineWidth=1.5;ctx.setLineDash([6,5]);ctx.beginPath();ctx.moveTo(corners[0].x,corners[0].y);for(const p of corners.slice(1))ctx.lineTo(p.x,p.y);ctx.closePath();ctx.stroke();ctx.restore();drawLine(ctx,g.origin,g.elbow,g.roiEnd,"rgba(255,210,80,.98)",2.5);}
  if(result.p0){ctx.save();ctx.strokeStyle="#ffd54f";ctx.lineWidth=2;ctx.beginPath();ctx.arc(result.p0.x,result.p0.y,6,0,Math.PI*2);ctx.stroke();ctx.restore();}

  // PCA actual, sin tocar.
  if(result.pca.geometry)drawLine(ctx,result.pca.geometry.origin,result.pca.geometry.elbow,result.pca.geometry.roiEnd,"rgba(0,229,255,.98)",3);
  // PCA experimental por secciones, misma nube.
  if(result.sections?.geometry)drawLine(ctx,result.sections.geometry.origin,result.sections.geometry.elbow,result.sections.geometry.roiEnd,"rgba(99,255,124,.98)",4,[8,4]);
  for(const p of result.sections?.centers||[]){ctx.save();ctx.fillStyle="rgba(99,255,124,.98)";ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,Math.PI*2);ctx.fill();ctx.restore();}

  for(const [i,p] of (result.final.centers||[]).entries()){ctx.save();ctx.fillStyle=i===0?"rgba(255,255,255,.35)":"#fff";ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill();ctx.restore();}
  if(result.final.metric){ctx.save();ctx.strokeStyle="#fff";ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(result.final.metric.start.x,result.final.metric.start.y);ctx.lineTo(result.final.metric.end.x,result.final.metric.end.y);ctx.stroke();ctx.restore();}

  const savedRef=manualRefs.get(bankIndex),points=marking?manualDraft:(savedRef?.points||[]);drawManual(ctx,points);
  const refAngle=savedRef?.angle;
  const errActual=axisErrorDegrees(result.pca.angle,refAngle),errSections=axisErrorDegrees(result.sections?.angle,refAngle);
  const values=document.getElementById("r13BankValues");
  if(values)values.innerHTML=`REPROCESADO · ROI ${fmt(directionAngle(result.geometry?.elbow))}<br>PCA ACTUAL ${fmt(result.pca.angle)} · PCA SECCIONES ${fmt(result.sections?.angle)} · FINAL ${fmt(result.final.metric?.angle)}<br>REFERENCIA ${fmt(refAngle)} · ERROR ACTUAL ${fmt(errActual)} · ERROR SECCIONES ${fmt(errSections)}<br>LIVE R12 · PCA ${item.live.pca.toFixed(1)}° · FINAL ${item.live.final.toFixed(1)}°`;
  const note=document.getElementById("r13BankNote");
  if(note)note.textContent=`MP IMAGE: ${result.mp?.landmarks?.length?"SÍ":"NO"} · P0: ${result.p0Source} · NUBE: ${result.pca.pixelCount} puntos${item.accumulated?" · 60°: NO USAR PARA DECIDIR":""}`;
  if(!marking)setStatus("CYAN PCA ACTUAL · VERDE PCA SECCIONES · ROJO REFERENCIA · BLANCO FINAL");
  updateCaptureUi();updateManualUi();
}

function updateManualUi(){
  const mark=document.getElementById("r14ManualMark"),clear=document.getElementById("r14ManualClear"),ref=manualRefs.get(bankIndex);
  if(mark){mark.disabled=!current;mark.textContent=marking?(manualDraft.length?"TOCA PUNTO 2":"TOCA PUNTO 1"):(ref?"REHACER REFERENCIA":"MARCAR EJE MANUAL");mark.classList.toggle("active",marking);}
  if(clear){clear.disabled=!ref&&!manualDraft.length;}
}
function startManualReference(){
  if(!current)return;manualRefs.delete(bankIndex);manualDraft=[];marking=true;updateManualUi();render();
  setStatus("PUNTO 1: toca el centro del antebrazo en el PRIMER TERCIO visible · evita la muñeca");
}
function clearManualReference(){manualRefs.delete(bankIndex);manualDraft=[];marking=false;render();setStatus("REFERENCIA MANUAL BORRADA");}
function canvasPoint(event){const canvas=document.getElementById("r13BankCanvas"),r=canvas.getBoundingClientRect();if(!r.width||!r.height)return null;return{x:(event.clientX-r.left)*canvas.width/r.width,y:(event.clientY-r.top)*canvas.height/r.height};}
function handleCanvasPointer(event){
  if(!marking||!current)return;event.preventDefault();const p=canvasPoint(event);if(!p)return;manualDraft.push(p);
  if(manualDraft.length===1){render();setStatus("PUNTO 2: toca el centro del antebrazo en el ÚLTIMO TERCIO visible · evita la muñeca");return;}
  const points=manualDraft.slice(0,2),a=manualAngle(points);manualRefs.set(bankIndex,{points,angle:a});manualDraft=[];marking=false;render();
  setStatus(`REFERENCIA ${fmt(a)} GUARDADA · errores calculados módulo 180°`);
}

function captureFilename(item){return `AMURA_R14_${String(item.target).padStart(3,"0")}deg.png`;}
function canvasToBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("No se pudo crear PNG")),"image/png"));}
async function makeCapture(){
  if(!current)throw new Error("La foto todavía no ha terminado de calcular");
  const source=document.getElementById("r13BankCanvas"),item=current.item,scale=2,panel=290,out=document.createElement("canvas");
  out.width=source.width*scale;out.height=source.height*scale+panel;
  const ctx=out.getContext("2d");ctx.fillStyle="#05080e";ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(source,0,panel,source.width*scale,source.height*scale);
  const values=document.getElementById("r13BankValues")?.innerText||"",note=document.getElementById("r13BankNote")?.innerText||"";
  ctx.fillStyle="#fff";ctx.font="700 28px Arial";ctx.fillText(`AMURA · R14 · POSTURA ${item.target}°`,24,40);
  ctx.font="700 19px Arial";let y=78;for(const line of values.split(/\n+/)){ctx.fillText(line,24,y);y+=29;}
  ctx.font="600 16px Arial";ctx.fillStyle="rgba(255,255,255,.82)";ctx.fillText(note.slice(0,110),24,y+8);
  const blob=await canvasToBlob(out);return{blob,fileName:captureFilename(item),target:item.target,capturedAt:Date.now()};
}
async function saveCurrentCapture(){const cap=await makeCapture();selectedCaptures.set(bankIndex,cap);updateCaptureUi();setStatus(`✓ CAPTURA ${cap.target}° GUARDADA`);}
function removeCurrentCapture(){selectedCaptures.delete(bankIndex);updateCaptureUi();setStatus(`CAPTURA ${BANK[bankIndex].target}° QUITADA`);}
async function toggleCapture(){if(selectedCaptures.has(bankIndex)){removeCurrentCapture();return;}try{await saveCurrentCapture();}catch(e){setStatus(e.message);}}
async function updateCurrentCapture(){try{await saveCurrentCapture();setStatus(`✓ CAPTURA ${BANK[bankIndex].target}° ACTUALIZADA`);}catch(e){setStatus(e.message);}}
function updateCaptureUi(){
  const saved=selectedCaptures.has(bankIndex),count=selectedCaptures.size,toggle=document.getElementById("r13CaptureToggle"),update=document.getElementById("r13CaptureUpdate"),exportBtn=document.getElementById("r13CaptureExport"),counter=document.getElementById("r13CaptureCounter");
  if(toggle){toggle.textContent=saved?"✓ GUARDADA · QUITAR":"✓ GUARDAR CAPTURA";toggle.classList.toggle("saved",saved);toggle.disabled=!current;}
  if(update){update.hidden=!saved;update.disabled=!current;}
  if(exportBtn){exportBtn.textContent=`EXPORTAR CAPTURAS (${count})`;exportBtn.disabled=count===0;}
  if(counter)counter.textContent=`SELECCIONADAS: ${count} / ${BANK.length}`;
}
async function exportCaptures(){
  const ordered=[...selectedCaptures.entries()].sort((a,b)=>a[0]-b[0]).map(([,c])=>c);if(!ordered.length)return;
  const files=ordered.map(c=>new File([c.blob],c.fileName,{type:"image/png",lastModified:c.capturedAt}));
  try{if(navigator.share&&(!navigator.canShare||navigator.canShare({files}))){await navigator.share({files,title:"AMURA · experimento R14",text:`${files.length} capturas PCA actual vs secciones`});setStatus(`${files.length} CAPTURAS EXPORTADAS`);return;}}
  catch(e){if(e?.name==="AbortError")return;console.warn("Web Share no disponible",e);}
  for(const file of files){const url=URL.createObjectURL(file),a=document.createElement("a");a.href=url;a.download=file.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);await new Promise(r=>setTimeout(r,180));}
  setStatus(`${files.length} CAPTURAS DESCARGADAS`);
}

function ensureUi(){
  const start=document.getElementById("startPanel");if(!start)return;
  if(!document.getElementById("bankStartButton")){const b=document.createElement("button");b.id="bankStartButton";b.className="primary-button";b.type="button";b.textContent="BANCO DE FOTOS";b.style.cssText="margin-top:12px;background:rgba(20,25,34,.96);color:#fff;border:1px solid rgba(255,255,255,.32)";document.getElementById("startButton")?.insertAdjacentElement("afterend",b);b.addEventListener("click",openBank);}
  if(!document.getElementById("r13BankStyle")){
    const s=document.createElement("style");s.id="r13BankStyle";s.textContent=`
      #r13BankRoot{position:absolute;inset:0;z-index:200000;background:#000;color:#fff;font-family:Arial,sans-serif}
      #r13BankRoot[hidden]{display:none!important}
      #r13BankStage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:285px 0 150px;box-sizing:border-box}
      #r13BankCanvas{display:block;max-width:100%;max-height:100%;width:auto;height:auto;touch-action:none}
      #r13BankHud{position:absolute;top:calc(env(safe-area-inset-top,0px) + 10px);left:10px;right:10px;z-index:4;padding:10px 12px;border-radius:10px;background:rgba(4,8,14,.89);backdrop-filter:blur(8px);font:800 12px/1.42 Arial,sans-serif}
      #r13BankTitle{font-size:12px;letter-spacing:.08em;opacity:.76}#r13BankPose{margin-top:2px;font-size:23px}#r13BankValues{margin-top:5px;font-size:12px}#r13BankNote,#r13BankStatus,#r13CaptureCounter{margin-top:4px;opacity:.82}
      #r14ManualControls{display:grid;grid-template-columns:1.7fr 1fr;gap:7px;margin-top:7px;padding-top:7px;border-top:1px solid rgba(255,255,255,.18)}
      #r14ManualControls button{min-height:38px;border-radius:999px;border:1px solid rgba(255,255,255,.32);background:rgba(20,25,34,.94);color:#fff;font:800 10px Arial,sans-serif}#r14ManualMark.active{background:rgba(155,45,45,.96)}
      #r13CaptureBar{position:absolute;left:10px;right:10px;bottom:calc(env(safe-area-inset-bottom,0px) + 80px);z-index:6;display:grid;grid-template-columns:1.35fr 1fr 1.35fr;gap:8px}
      #r13CaptureBar button,#r13BankControls button,#r13BankClose{min-height:48px;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(5,10,17,.92);color:#fff;font:800 11px Arial,sans-serif;letter-spacing:.03em}
      #r13CaptureToggle.saved{background:rgba(0,126,89,.92)}#r13CaptureUpdate[hidden]{display:none!important}button:disabled{opacity:.42}
      #r13BankControls{position:absolute;left:10px;right:10px;bottom:calc(env(safe-area-inset-bottom,0px) + 16px);z-index:5;display:grid;grid-template-columns:1fr 1fr;gap:10px}
      #r13BankClose{position:absolute;right:12px;top:calc(env(safe-area-inset-top,0px) + 252px);z-index:6;min-width:88px;min-height:40px}
      body[data-amura-mode="bank"] #maskLabHud,body[data-amura-mode="bank"] #maskReadyButton,body[data-amura-mode="bank"] #maskResetButton,body[data-amura-mode="bank"] #maskPhotoButton,body[data-amura-mode="bank"] #r12BankHud,body[data-amura-mode="bank"] #r12BankCaptureButton,body[data-amura-mode="bank"] #r12BankExportButton,body[data-amura-mode="bank"] #trackingCanvas,body[data-amura-mode="bank"] #maskCanvas{display:none!important}`;
    document.head.appendChild(s);
  }
  if(!document.getElementById("r13BankRoot")){
    const root=document.createElement("section");root.id="r13BankRoot";root.hidden=true;
    root.innerHTML=`<div id="r13BankStage"><canvas id="r13BankCanvas"></canvas></div><aside id="r13BankHud"><div id="r13BankTitle">R14 · A/B PCA · MISMA NUBE</div><div id="r13BankPose"></div><div id="r13BankValues"></div><div id="r13BankNote"></div><div id="r13BankStatus"></div><div id="r13CaptureCounter">SELECCIONADAS: 0 / 8</div><div id="r14ManualControls"><button id="r14ManualMark" type="button">MARCAR EJE MANUAL</button><button id="r14ManualClear" type="button">BORRAR REF</button></div></aside><button id="r13BankClose" type="button">CÁMARA</button><div id="r13CaptureBar"><button id="r13CaptureToggle" type="button">✓ GUARDAR CAPTURA</button><button id="r13CaptureUpdate" type="button" hidden>ACTUALIZAR</button><button id="r13CaptureExport" type="button" disabled>EXPORTAR CAPTURAS (0)</button></div><nav id="r13BankControls"><button id="r13BankPrev" type="button">← ANTERIOR</button><button id="r13BankNext" type="button">SIGUIENTE →</button></nav>`;
    (document.querySelector(".camera-lab")||document.body).appendChild(root);
    document.getElementById("r13BankPrev")?.addEventListener("click",()=>showBank(bankIndex-1));
    document.getElementById("r13BankNext")?.addEventListener("click",()=>showBank(bankIndex+1));
    document.getElementById("r13BankClose")?.addEventListener("click",closeBank);
    document.getElementById("r13CaptureToggle")?.addEventListener("click",toggleCapture);
    document.getElementById("r13CaptureUpdate")?.addEventListener("click",updateCurrentCapture);
    document.getElementById("r13CaptureExport")?.addEventListener("click",exportCaptures);
    document.getElementById("r14ManualMark")?.addEventListener("click",startManualReference);
    document.getElementById("r14ManualClear")?.addEventListener("click",clearManualReference);
    document.getElementById("r13BankCanvas")?.addEventListener("pointerdown",handleCanvasPointer);
  }
  updateCaptureUi();updateManualUi();
}

async function showBank(index){
  bankIndex=(index+BANK.length)%BANK.length;const item=BANK[bankIndex];resetAllState();const token=runToken;setBusy(true);
  const pose=document.getElementById("r13BankPose"),values=document.getElementById("r13BankValues"),note=document.getElementById("r13BankNote");
  if(pose)pose.textContent=`POSTURA ${bankIndex+1}/8 · ${item.target}°`;if(values)values.textContent="CARGANDO FOTO…";if(note)note.textContent="misma foto + misma nube · dos algoritmos en paralelo";
  try{const image=await loadPhoto(item.file);if(token!==runToken)return;if(values)values.textContent="MEDIAPIPE IMAGE → MÁSCARA → PCA ACTUAL + PCA SECCIONES…";const result=await analyzeBankImage(image,item,()=>token===runToken);if(!result||token!==runToken)return;current={item,result};render();}
  catch(e){console.error("R14 banco",e);if(token===runToken){if(values)values.textContent="ERROR AL REPROCESAR";setStatus(e.message);}}
  finally{if(token===runToken){setBusy(false);updateCaptureUi();updateManualUi();}}
}
function openBank(){ensureUi();bankOpen=true;document.body.dataset.amuraMode="bank";document.getElementById("startPanel")?.setAttribute("hidden","");document.getElementById("r13BankRoot").hidden=false;document.title="AMURA · EXPERIMENTO PCA · R14";showBank(bankIndex);}
function closeBank(){resetAllState();bankOpen=false;delete document.body.dataset.amuraMode;document.getElementById("r13BankRoot").hidden=true;const start=document.getElementById("startPanel");if(document.body.dataset.status==="idle"&&start)start.hidden=false;document.title="AMURA · CÁMARA / BANCO · R14";}
function boot(){ensureUi();const e=document.querySelector("#startPanel .eyebrow"),t=document.getElementById("cameraTitle"),l=document.getElementById("statusMessage"),p=document.querySelector("#startPanel .privacy");if(e)e.textContent="LABORATORIO · R14";if(t)t.textContent="PCA ACTUAL VS PCA POR SECCIONES";if(l)l.textContent="Misma foto y misma nube. Dos métodos calculados a la vez.";if(p)p.textContent="Pulsa MARCAR EJE MANUAL y toca dos puntos: centro del primer tercio y centro del último tercio del antebrazo.";document.title="AMURA · EXPERIMENTO PCA · R14";}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
window.AmuraStaticBank={items:BANK,open:openBank,close:closeBank,show:showBank,resetAllState,selectedCaptures,manualRefs};
