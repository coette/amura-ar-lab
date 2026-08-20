// AMURA AR · R13 · reproductor estático del banco base.
// No abre cámara ni pide permisos. Las fotos están embebidas en site/test-bank/2026-08-20-banco-base/.

const BANK_BASE = "./test-bank/2026-08-20-banco-base/";
const BANK = [
  { file:"postura_01_000deg.jpg", target:0,   roi:173.9, pca:169.0, final:174.7 },
  { file:"postura_02_030deg.jpg", target:30,  roi:171.6, pca:170.5, final:170.8 },
  { file:"postura_03_060deg.jpg", target:60,  roi:172.2, pca:172.3, final:170.9, accumulated:true },
  { file:"postura_04_090deg.jpg", target:90,  roi:171.3, pca:169.4, final:169.7 },
  { file:"postura_05_135deg.jpg", target:135, roi:164.5, pca:163.4, final:168.0 },
  { file:"postura_06_150deg.jpg", target:150, roi:162.0, pca:149.7, final:159.5 },
  { file:"postura_07_165deg.jpg", target:165, roi:161.5, pca:151.6, final:162.4 },
  { file:"postura_08_180deg.jpg", target:180, roi:151.7, pca:129.3, final:138.3 }
];

let bankIndex = 0;
let bankOpen = false;

function ensureBankUi() {
  const startPanel = document.getElementById("startPanel");
  if (!startPanel) return;

  if (!document.getElementById("bankStartButton")) {
    const button = document.createElement("button");
    button.id = "bankStartButton";
    button.className = "primary-button";
    button.type = "button";
    button.textContent = "BANCO DE FOTOS";
    button.style.marginTop = "12px";
    button.style.background = "rgba(20,25,34,.96)";
    button.style.color = "#fff";
    button.style.border = "1px solid rgba(255,255,255,.32)";
    const cameraButton = document.getElementById("startButton");
    cameraButton?.insertAdjacentElement("afterend", button);
    button.addEventListener("click", openBank);
  }

  if (!document.getElementById("r13BankStyle")) {
    const style = document.createElement("style");
    style.id = "r13BankStyle";
    style.textContent = `
      #r13BankRoot { position:absolute; inset:0; z-index:200000; background:#000; color:#fff; font-family:Arial,sans-serif; }
      #r13BankRoot[hidden] { display:none !important; }
      #r13BankImageWrap { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; overflow:hidden; }
      #r13BankImage { max-width:100%; max-height:100%; width:auto; height:auto; object-fit:contain; display:block; }
      #r13BankOverlay { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
      #r13BankHud { position:absolute; top:calc(env(safe-area-inset-top,0px) + 10px); left:10px; right:10px; z-index:4; padding:10px 12px; border-radius:10px; background:rgba(4,8,14,.82); backdrop-filter:blur(8px); font:800 12px/1.45 Arial,sans-serif; }
      #r13BankTitle { font-size:12px; letter-spacing:.08em; opacity:.76; }
      #r13BankPose { margin-top:2px; font-size:24px; }
      #r13BankValues { margin-top:5px; font-size:13px; }
      #r13BankNote { margin-top:5px; opacity:.78; }
      #r13BankControls { position:absolute; left:10px; right:10px; bottom:calc(env(safe-area-inset-bottom,0px) + 16px); z-index:5; display:grid; grid-template-columns:1fr 1fr; gap:10px; }
      #r13BankControls button { min-height:50px; border-radius:999px; border:1px solid rgba(255,255,255,.35); background:rgba(5,10,17,.88); color:#fff; font:800 12px Arial,sans-serif; letter-spacing:.04em; }
      #r13BankClose { position:absolute; right:12px; top:calc(env(safe-area-inset-top,0px) + 118px); z-index:6; min-width:82px; min-height:42px; border-radius:999px; border:1px solid rgba(255,255,255,.35); background:rgba(5,10,17,.88); color:#fff; font:800 11px Arial,sans-serif; }
      body[data-amura-mode="bank"] #maskLabHud,
      body[data-amura-mode="bank"] #maskReadyButton,
      body[data-amura-mode="bank"] #maskResetButton,
      body[data-amura-mode="bank"] #maskPhotoButton,
      body[data-amura-mode="bank"] #r12BankHud,
      body[data-amura-mode="bank"] #r12BankCaptureButton,
      body[data-amura-mode="bank"] #r12BankExportButton,
      body[data-amura-mode="bank"] #trackingCanvas,
      body[data-amura-mode="bank"] #maskCanvas { display:none !important; }
    `;
    document.head.appendChild(style);
  }

  if (!document.getElementById("r13BankRoot")) {
    const root = document.createElement("section");
    root.id = "r13BankRoot";
    root.hidden = true;
    root.innerHTML = `
      <div id="r13BankImageWrap">
        <img id="r13BankImage" alt="Fotograma del banco de pruebas">
        <canvas id="r13BankOverlay"></canvas>
      </div>
      <aside id="r13BankHud">
        <div id="r13BankTitle">R13 · BANCO ESTÁTICO · REFERENCIA R12</div>
        <div id="r13BankPose"></div>
        <div id="r13BankValues"></div>
        <div id="r13BankNote"></div>
      </aside>
      <button id="r13BankClose" type="button">CÁMARA</button>
      <nav id="r13BankControls">
        <button id="r13BankPrev" type="button">← ANTERIOR</button>
        <button id="r13BankNext" type="button">SIGUIENTE →</button>
      </nav>`;
    (document.querySelector(".camera-lab") || document.body).appendChild(root);
    document.getElementById("r13BankPrev")?.addEventListener("click", () => showBank(bankIndex - 1));
    document.getElementById("r13BankNext")?.addEventListener("click", () => showBank(bankIndex + 1));
    document.getElementById("r13BankClose")?.addEventListener("click", closeBank);
    window.addEventListener("resize", drawReferenceOverlay);
  }
}

function openBank() {
  ensureBankUi();
  bankOpen = true;
  document.body.dataset.amuraMode = "bank";
  document.getElementById("startPanel")?.setAttribute("hidden", "");
  const root = document.getElementById("r13BankRoot");
  if (root) root.hidden = false;
  document.title = "AMURA · BANCO ESTÁTICO · R13";
  showBank(bankIndex);
}

function closeBank() {
  bankOpen = false;
  delete document.body.dataset.amuraMode;
  const root = document.getElementById("r13BankRoot");
  if (root) root.hidden = true;
  const startPanel = document.getElementById("startPanel");
  if (document.body.dataset.status === "idle" && startPanel) startPanel.hidden = false;
  document.title = "AMURA · BANCO DE PRUEBAS · R13";
}

function showBank(index) {
  bankIndex = (index + BANK.length) % BANK.length;
  const item = BANK[bankIndex];
  const img = document.getElementById("r13BankImage");
  const pose = document.getElementById("r13BankPose");
  const values = document.getElementById("r13BankValues");
  const note = document.getElementById("r13BankNote");
  if (!img || !pose || !values || !note) return;
  pose.textContent = `POSTURA ${bankIndex + 1}/8 · ${item.target}°`;
  values.textContent = `LIVE R12 · ROI ${item.roi.toFixed(1)}° · PCA ${item.pca.toFixed(1)}° · FINAL ${item.final.toFixed(1)}°`;
  note.textContent = item.accumulated
    ? "60° · captura con estado acumulado: no equivale a inicialización desde cero."
    : "Líneas de referencia = valores capturados en vivo. La foto es la entrada fija del banco.";
  img.onload = drawReferenceOverlay;
  img.src = `${BANK_BASE}${item.file}?v=r13.1`;
  document.getElementById("r13BankPrev").disabled = false;
  document.getElementById("r13BankNext").disabled = false;
}

function drawLine(ctx, cx, cy, angleDeg, length, stroke, width) {
  const rad = angleDeg * Math.PI / 180;
  const dx = Math.cos(rad) * length * 0.5;
  const dy = Math.sin(rad) * length * 0.5;
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(cx - dx, cy - dy);
  ctx.lineTo(cx + dx, cy + dy);
  ctx.stroke();
  ctx.restore();
}

function drawReferenceOverlay() {
  if (!bankOpen) return;
  const img = document.getElementById("r13BankImage");
  const canvas = document.getElementById("r13BankOverlay");
  const wrap = document.getElementById("r13BankImageWrap");
  if (!img || !canvas || !wrap || !img.naturalWidth) return;
  const rect = wrap.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * devicePixelRatio));
  canvas.height = Math.max(1, Math.round(rect.height * devicePixelRatio));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(devicePixelRatio, devicePixelRatio);

  const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const left = (rect.width - drawW) * 0.5;
  const top = (rect.height - drawH) * 0.5;
  const cx = left + drawW * 0.32;
  const cy = top + drawH * 0.49;
  const len = drawW * 0.30;
  const item = BANK[bankIndex];

  // Referencias capturadas en vivo: ROI=amarillo, PCA=cyan, final=blanco.
  drawLine(ctx, cx, cy, item.roi, len, "rgba(255,210,80,.95)", 3);
  drawLine(ctx, cx, cy, item.pca, len, "rgba(0,230,255,.95)", 3);
  drawLine(ctx, cx, cy, item.final, len, "rgba(255,255,255,.98)", 4);
}

function boot() {
  ensureBankUi();
  const eyebrow = document.querySelector("#startPanel .eyebrow");
  const title = document.getElementById("cameraTitle");
  const lead = document.getElementById("statusMessage");
  const privacy = document.querySelector("#startPanel .privacy");
  if (eyebrow) eyebrow.textContent = "LABORATORIO · R13";
  if (title) title.textContent = "CÁMARA O BANCO DE FOTOS";
  if (lead) lead.textContent = "Elige cámara para probar en vivo o banco para trabajar con las 8 fotos guardadas.";
  if (privacy) privacy.textContent = "BANCO DE FOTOS no abre la cámara ni pide permiso. Usa el lote fijo del 20-08-2026.";
  document.title = "AMURA · CÁMARA / BANCO · R13";
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once:true });
else boot();

window.AmuraStaticBank = { items:BANK, open:openBank, close:closeBank, show:showBank };
