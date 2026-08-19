/**
 * AMURA · Panel de ajuste
 *
 * Un solo grupo visible cada vez. Tocas AJUSTES, eliges grupo, y aparecen
 * únicamente esos controles. Vuelves a tocar y desaparece.
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
      { key: "occluderXmm", label: "Mover X", min: -50, max: 50, step: 1, unit: " mm" },
      { key: "occluderYmm", label: "Mover Y", min: -80, max: 80, step: 1, unit: " mm" },
      { key: "occluderZmm", label: "Mover Z", min: -60, max: 30, step: 1, unit: " mm" },
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

let openGroup = "";
let root = null;
let onChange = null;

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
          save();
          if (onChange) onChange(field.key);
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
        save();
        if (onChange) onChange(field.key);
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

function render() {
  root.innerHTML = "";
  document.body.classList.toggle("wrist-tuning-open", openGroup === "wrist");

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
      openGroup = openGroup === group.id ? "menu" : group.id;
      render();
    });
    bar.appendChild(button);
  });

  const close = document.createElement("button");
  close.type = "button";
  close.className = "tuner-tab close";
  close.textContent = "×";
  close.addEventListener("click", () => { openGroup = ""; render(); });
  bar.appendChild(close);

  const active = GROUPS.find((group) => group.id === openGroup);
  if (active) root.appendChild(renderGroup(active));
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
