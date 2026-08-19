/**
 * AMURA · Panel de ajuste
 *
 * Un solo grupo visible cada vez. MUÑECA dispone además de un modo de
 * calibración limpio para hacer coincidir la muñeca virtual con la real.
 */

const STORAGE_KEY = "amura.tuning.v112";

export const tuning = {
  // POSICIÓN
  offsetMm: 6,
  lateralMm: -2,
  // GIRO
  dialDegrees: 0,
  flexionFix: 1,
  liftMm: 2,
  // CÁMARA
  fovDiagonal: 73,
  // FILTRO
  smoothing: 1,
  orientationCutoff: 0.55,
  orientationBeta: 1.8,
  // MUÑECA / OCCLUDER PROCEDURAL
  occluderMode: 1,      // 0 OFF · 1 TRANSPARENTE · 2 SÓLIDA · 3 OCLUSIÓN
  occluderWidthMm: 62,
  occluderThicknessMm: 44,
  occluderLengthMm: 150,
  occluderXmm: 0,
  occluderYmm: 0,
  occluderZmm: -20,
  occluderRotX: 0,
  occluderRotY: 0,
  occluderRotZ: 0,
  watchVisible: 1
};

const GROUPS = [
  {
    id: "pos", label: "POSICIÓN", fields: [
      { key: "offsetMm", label: "Hacia el codo", min: 0, max: 90, step: 1, unit: " mm" },
      { key: "lateralMm", label: "Lateral", min: -30, max: 30, step: 1, unit: " mm" },
      { key: "liftMm", label: "Separar de la piel", min: -5, max: 15, step: 1, unit: " mm" }
    ]
  },
  {
    id: "rot", label: "GIRO", fields: [
      { key: "dialDegrees", label: "Dónde caen las 12", min: -180, max: 180, step: 5, unit: "°" },
      { key: "flexionFix", label: "Corregir falso giro", min: 0, max: 1, step: 1, unit: "", toggle: ["NO", "SÍ"] }
    ]
  },
  {
    id: "wrist", label: "MUÑECA", fields: [
      { key: "occluderWidthMm", label: "Ancho", min: 30, max: 100, step: 1, unit: " mm" },
      { key: "occluderThicknessMm", label: "Grosor", min: 20, max: 80, step: 1, unit: " mm" },
      { key: "occluderLengthMm", label: "Largo", min: 70, max: 240, step: 2, unit: " mm" },
      { key: "occluderXmm", label: "Mover X", min: -100, max: 100, step: 1, unit: " mm" },
      { key: "occluderYmm", label: "Mover Y", min: -120, max: 120, step: 1, unit: " mm" },
      { key: "occluderZmm", label: "Mover Z", min: -100, max: 100, step: 1, unit: " mm" },
      { key: "occluderRotX", label: "Giro X", min: -90, max: 90, step: 1, unit: "°" },
      { key: "occluderRotY", label: "Giro Y", min: -90, max: 90, step: 1, unit: "°" },
      { key: "occluderRotZ", label: "Giro Z", min: -90, max: 90, step: 1, unit: "°" },
      { key: "occluderMode", label: "Aspecto / función", choices: ["OFF", "TRANSPARENTE", "SÓLIDA", "OCLUSIÓN"] },
      { key: "watchVisible", label: "Reloj", choices: ["OCULTAR RELOJ", "MOSTRAR RELOJ"] }
    ]
  },
  {
    id: "cam", label: "CÁMARA", fields: [
      { key: "fovDiagonal", label: "FOV diagonal", min: 55, max: 100, step: 1, unit: "°" }
    ]
  },
  {
    id: "filter", label: "FILTRO", fields: [
      { key: "smoothing", label: "Estabilizador", min: 0, max: 1, step: 1, unit: "", toggle: ["CRUDO", "ON"] },
      { key: "orientationCutoff", label: "Quieto = más bajo", min: 0.05, max: 4, step: 0.05, unit: "" },
      { key: "orientationBeta", label: "Rápido = más alto", min: 0.2, max: 8, step: 0.05, unit: "" }
    ]
  }
];

const WRIST_CALIBRATION = [
  {
    id: "position", label: "POSICIÓN", fields: [
      { key: "occluderXmm", label: "X", min: -100, max: 100, step: 1, unit: " mm" },
      { key: "occluderYmm", label: "Y", min: -120, max: 120, step: 1, unit: " mm" },
      { key: "occluderZmm", label: "Z", min: -100, max: 100, step: 1, unit: " mm" }
    ]
  },
  {
    id: "size", label: "TAMAÑO", fields: [
      { key: "occluderWidthMm", label: "ANCHO", min: 30, max: 100, step: 1, unit: " mm" },
      { key: "occluderThicknessMm", label: "GROSOR", min: 20, max: 80, step: 1, unit: " mm" },
      { key: "occluderLengthMm", label: "LARGO", min: 70, max: 240, step: 2, unit: " mm" }
    ]
  },
  {
    id: "rotation", label: "GIRO", fields: [
      { key: "occluderRotX", label: "X", min: -90, max: 90, step: 1, unit: "°" },
      { key: "occluderRotY", label: "Y", min: -90, max: 90, step: 1, unit: "°" },
      { key: "occluderRotZ", label: "Z", min: -90, max: 90, step: 1, unit: "°" }
    ]
  }
];

let openGroup = "";
let root = null;
let onChange = null;
let wristView = "calibration";
let calibrationSection = "position";
let calibrationFieldKey = "occluderXmm";
let calibrationActive = false;
let cleanView = false;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    Object.keys(tuning).forEach((k) => {
      if (Number.isFinite(saved[k])) tuning[k] = saved[k];
    });
  } catch (e) { /* primera vez */ }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tuning)); } catch (e) { /* modo privado */ }
}

function notify(key) {
  save();
  if (onChange) onChange(key);
}

function ensureRuntimeStyles() {
  if (document.getElementById("amuraTunerRuntimeStyles")) return;
  const style = document.createElement("style");
  style.id = "amuraTunerRuntimeStyles";
  style.textContent = `
    body.wrist-tuning-open .topbar,
    body.wrist-tuning-open .tracking-hud,
    body.wrist-tuning-open .axis-legend,
    body.wrist-tuning-open .controls,
    body.wrist-tuning-open .rotation-modes,
    body.wrist-tuning-open .diagnostics {
      display: none !important;
    }
    body.wrist-calibration-open .tracking-canvas {
      opacity: 0 !important;
    }
    body.wrist-calibration-open #tunerRoot {
      bottom: calc(env(safe-area-inset-bottom) + 16px) !important;
      gap: 0 !important;
    }
    body.wrist-clean-view #tunerRoot {
      display: none !important;
    }
    .tuner-choice-row {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }
    .tuner-choice {
      min-height: 40px;
      padding: 8px 6px;
      border: 1px solid #3d3160;
      border-radius: 4px;
      background: rgba(13,10,22,.92);
      color: #9b8bc4;
      font: 700 10px/1 ui-monospace, Menlo, monospace;
      letter-spacing: .8px;
    }
    .tuner-choice.on {
      border-color: #a992ff;
      background: #2a2145;
      color: #fff;
      box-shadow: inset 0 -3px 0 #a992ff;
    }
    .wrist-calibration-panel {
      width: min(94vw, 520px);
      display: flex;
      flex-direction: column;
      gap: 7px;
      padding: 8px;
      border: 1px solid rgba(106,85,176,.72);
      border-radius: 6px;
      background: rgba(13,10,22,.76);
      -webkit-backdrop-filter: blur(10px);
      backdrop-filter: blur(10px);
    }
    .wrist-calibration-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: #e3dcff;
      font: 700 11px/1 ui-monospace, Menlo, monospace;
      letter-spacing: 1.1px;
    }
    .wrist-calibration-title b {
      color: #a992ff;
      font-size: 12px;
    }
    .wrist-calibration-tabs,
    .wrist-calibration-fields,
    .wrist-calibration-actions {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 5px;
    }
    .wrist-calibration-tabs button,
    .wrist-calibration-fields button,
    .wrist-calibration-actions button,
    .wrist-advanced-button {
      min-height: 36px;
      padding: 7px 5px;
      border: 1px solid #3d3160;
      border-radius: 4px;
      background: rgba(13,10,22,.9);
      color: #9b8bc4;
      font: 700 10px/1 ui-monospace, Menlo, monospace;
      letter-spacing: .8px;
    }
    .wrist-calibration-tabs button.on,
    .wrist-calibration-fields button.on {
      border-color: #a992ff;
      background: #2a2145;
      color: #fff;
    }
    .wrist-calibration-actions .done {
      border-color: #a992ff;
      color: #fff;
      background: #2a2145;
    }
    .wrist-calibration-slider {
      padding-top: 1px;
    }
    .wrist-calibration-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      color: #e3dcff;
      font: 700 12px/1 ui-monospace, Menlo, monospace;
      text-shadow: 0 1px 3px #000, 0 0 8px #000;
    }
    .wrist-calibration-head b {
      color: #fff;
      font-size: 18px;
    }
    .wrist-calibration-slider input[type=range] {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 38px;
      margin: 0;
      background: transparent;
    }
    .wrist-calibration-slider input[type=range]::-webkit-slider-runnable-track {
      height: 6px;
      border-radius: 4px;
      background: rgba(160,140,230,.68);
      box-shadow: 0 0 0 1px rgba(0,0,0,.7);
    }
    .wrist-calibration-slider input[type=range]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 34px;
      height: 34px;
      margin-top: -14px;
      border: 3px solid #0d0a16;
      border-radius: 50%;
      background: #a992ff;
    }
    .wrist-advanced-wrap {
      width: min(94vw, 460px);
      display: flex;
      flex-direction: column;
      gap: 7px;
    }
    .wrist-advanced-button {
      width: 100%;
      color: #cbb6ff;
      border-color: #6a55b0;
    }
  `;
  document.head.appendChild(style);
}

function displayValue(field) {
  const value = tuning[field.key];
  if (field.choices) return field.choices[Math.max(0, Math.min(field.choices.length - 1, Math.round(value)))] || "";
  if (field.toggle) return field.toggle[value ? 1 : 0];
  const decimals = field.step < 1 ? 2 : 0;
  return value.toFixed(decimals) + field.unit;
}

function renderGroup(group) {
  const panel = document.createElement("div");
  panel.className = "tuner-panel";

  group.fields.forEach((field) => {
    const row = document.createElement("div");
    row.className = "tuner-row";

    const head = document.createElement("div");
    head.className = "tuner-head";
    const name = document.createElement("span");
    name.textContent = field.label;
    const value = document.createElement("b");
    value.textContent = displayValue(field);
    head.append(name, value);

    if (field.choices) {
      const choiceRow = document.createElement("div");
      choiceRow.className = "tuner-choice-row";
      const buttons = [];

      field.choices.forEach((label, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tuner-choice" + (Math.round(tuning[field.key]) === index ? " on" : "");
        button.textContent = label;
        button.addEventListener("click", () => {
          tuning[field.key] = index;
          value.textContent = displayValue(field);
          buttons.forEach((item, itemIndex) => item.classList.toggle("on", itemIndex === index));
          notify(field.key);
        });
        buttons.push(button);
        choiceRow.appendChild(button);
      });

      row.append(head, choiceRow);
    } else {
      const input = document.createElement("input");
      input.type = "range";
      input.min = field.min;
      input.max = field.max;
      input.step = field.step;
      input.value = tuning[field.key];
      input.addEventListener("input", () => {
        tuning[field.key] = Number(input.value);
        value.textContent = displayValue(field);
        notify(field.key);
      });
      row.append(head, input);
    }

    panel.appendChild(row);
  });

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "tuner-reset";
  reset.textContent = "COPIAR VALORES";
  reset.addEventListener("click", () => {
    const text = JSON.stringify(tuning, null, 1);
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    reset.textContent = "COPIADO";
    setTimeout(() => { reset.textContent = "COPIAR VALORES"; }, 1400);
  });
  panel.appendChild(reset);

  return panel;
}

function currentCalibrationSection() {
  return WRIST_CALIBRATION.find((section) => section.id === calibrationSection) || WRIST_CALIBRATION[0];
}

function currentCalibrationField() {
  const section = currentCalibrationSection();
  return section.fields.find((field) => field.key === calibrationFieldKey) || section.fields[0];
}

function enterWristCalibration() {
  calibrationActive = true;
  cleanView = false;
  wristView = "calibration";
  tuning.watchVisible = 0;
  tuning.occluderMode = 2;
  notify("watchVisible");
  notify("occluderMode");
}

function finishWristCalibration() {
  calibrationActive = false;
  cleanView = false;
  tuning.watchVisible = 1;
  tuning.occluderMode = 3;
  notify("watchVisible");
  notify("occluderMode");
  document.body.classList.remove("wrist-clean-view");
}

function restoreCleanView() {
  if (!cleanView) return;
  cleanView = false;
  document.body.classList.remove("wrist-clean-view");
  render();
}

function showCleanView(event) {
  if (event) event.stopPropagation();
  cleanView = true;
  document.body.classList.add("wrist-clean-view");
  root.innerHTML = "";
  setTimeout(() => {
    document.addEventListener("pointerdown", restoreCleanView, { once: true });
  }, 80);
}

function renderWristCalibration() {
  const panel = document.createElement("div");
  panel.className = "wrist-calibration-panel";

  const title = document.createElement("div");
  title.className = "wrist-calibration-title";
  const left = document.createElement("span");
  left.textContent = "MUÑECA · AJUSTE";
  const state = document.createElement("b");
  state.textContent = "RELOJ OCULTO · SÓLIDA";
  title.append(left, state);
  panel.appendChild(title);

  const sectionTabs = document.createElement("div");
  sectionTabs.className = "wrist-calibration-tabs";
  WRIST_CALIBRATION.forEach((section) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = section.label;
    button.className = section.id === calibrationSection ? "on" : "";
    button.addEventListener("click", () => {
      calibrationSection = section.id;
      calibrationFieldKey = section.fields[0].key;
      render();
    });
    sectionTabs.appendChild(button);
  });
  panel.appendChild(sectionTabs);

  const section = currentCalibrationSection();
  const fieldTabs = document.createElement("div");
  fieldTabs.className = "wrist-calibration-fields";
  section.fields.forEach((field) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = field.label;
    button.className = field.key === calibrationFieldKey ? "on" : "";
    button.addEventListener("click", () => {
      calibrationFieldKey = field.key;
      render();
    });
    fieldTabs.appendChild(button);
  });
  panel.appendChild(fieldTabs);

  const field = currentCalibrationField();
  const sliderWrap = document.createElement("div");
  sliderWrap.className = "wrist-calibration-slider";
  const head = document.createElement("div");
  head.className = "wrist-calibration-head";
  const name = document.createElement("span");
  name.textContent = `${section.label} · ${field.label}`;
  const value = document.createElement("b");
  value.textContent = displayValue(field);
  head.append(name, value);

  const input = document.createElement("input");
  input.type = "range";
  input.min = field.min;
  input.max = field.max;
  input.step = field.step;
  input.value = tuning[field.key];
  input.addEventListener("input", () => {
    tuning[field.key] = Number(input.value);
    value.textContent = displayValue(field);
    notify(field.key);
  });
  sliderWrap.append(head, input);
  panel.appendChild(sliderWrap);

  const actions = document.createElement("div");
  actions.className = "wrist-calibration-actions";

  const clean = document.createElement("button");
  clean.type = "button";
  clean.textContent = "VER LIMPIO";
  clean.addEventListener("click", showCleanView);

  const advanced = document.createElement("button");
  advanced.type = "button";
  advanced.textContent = "AVANZADO";
  advanced.addEventListener("click", () => {
    wristView = "advanced";
    document.body.classList.remove("wrist-clean-view");
    render();
  });

  const done = document.createElement("button");
  done.type = "button";
  done.className = "done";
  done.textContent = "LISTO";
  done.addEventListener("click", () => {
    finishWristCalibration();
    openGroup = "menu";
    wristView = "calibration";
    render();
  });

  actions.append(clean, advanced, done);
  panel.appendChild(actions);
  return panel;
}

function renderAdvancedWrist(group) {
  const wrap = document.createElement("div");
  wrap.className = "wrist-advanced-wrap";

  const back = document.createElement("button");
  back.type = "button";
  back.className = "wrist-advanced-button";
  back.textContent = "VOLVER A MODO AJUSTE";
  back.addEventListener("click", () => {
    wristView = "calibration";
    tuning.watchVisible = 0;
    tuning.occluderMode = 2;
    notify("watchVisible");
    notify("occluderMode");
    render();
  });

  wrap.append(back, renderGroup(group));
  return wrap;
}

function render() {
  root.innerHTML = "";
  const wristOpen = openGroup === "wrist";
  const calibrationOpen = wristOpen && wristView === "calibration";
  document.body.classList.toggle("wrist-tuning-open", wristOpen);
  document.body.classList.toggle("wrist-calibration-open", calibrationOpen);
  document.body.classList.toggle("wrist-clean-view", calibrationOpen && cleanView);

  if (calibrationOpen) {
    root.appendChild(renderWristCalibration());
    return;
  }

  if (!openGroup) {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "tuner-toggle";
    open.textContent = "AJUSTES";
    open.addEventListener("click", () => { openGroup = "menu"; render(); });
    root.appendChild(open);
    return;
  }

  const bar = document.createElement("div");
  bar.className = "tuner-bar";

  GROUPS.forEach((group) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tuner-tab" + (openGroup === group.id ? " on" : "");
    button.textContent = group.label;
    button.addEventListener("click", () => {
      if (group.id === "wrist" && openGroup !== "wrist") {
        openGroup = "wrist";
        enterWristCalibration();
      } else if (openGroup === "wrist") {
        finishWristCalibration();
        openGroup = group.id === "wrist" ? "menu" : group.id;
      } else {
        openGroup = openGroup === group.id ? "menu" : group.id;
      }
      render();
    });
    bar.appendChild(button);
  });

  const close = document.createElement("button");
  close.type = "button";
  close.className = "tuner-tab close";
  close.textContent = "×";
  close.addEventListener("click", () => {
    if (openGroup === "wrist" && calibrationActive) finishWristCalibration();
    openGroup = "";
    render();
  });
  bar.appendChild(close);

  const active = GROUPS.find((group) => group.id === openGroup);
  if (active) {
    if (active.id === "wrist" && wristView === "advanced") {
      root.appendChild(renderAdvancedWrist(active));
    } else {
      root.appendChild(renderGroup(active));
    }
  }
  root.appendChild(bar);
}

export function initTuner(changeHandler) {
  onChange = changeHandler;
  load();
  ensureRuntimeStyles();
  root = document.createElement("div");
  root.id = "tunerRoot";
  document.body.appendChild(root);
  render();
  return tuning;
}
