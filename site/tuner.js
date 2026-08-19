/**
 * AMURA · Panel de ajuste
 *
 * Un solo grupo visible cada vez. Tocas AJUSTES, eliges grupo, y aparecen
 * únicamente esos dos o tres sliders, grandes. Vuelves a tocar y desaparece.
 * Nada permanece en pantalla salvo un botón.
 */

const STORAGE_KEY = "amura.tuning.v112";

export const tuning = {
  // POSICIÓN
  offsetMm: 6,          // desplazamiento desde el landmark 0 hacia el codo
  lateralMm: -2,        // corrección transversal fina
  // GIRO
  dialDegrees: 0,       // el GLB ya trae su tríada; solo ajuste fino
  flexionFix: 1,         // 0 = como estaba, 1 = corrige el falso giro al doblar
  liftMm: 2,            // pequeña holgura de diagnóstico sobre el contacto
  // CÁMARA
  fovDiagonal: 73,      // aproximación estable al rotar el dispositivo
  // FILTRO
  smoothing: 1,          // 0 = crudo (como v9.2), 1 = estabilizador conectado
  orientationCutoff: 0.55,
  orientationBeta: 1.8
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

function displayValue(field) {
  const value = tuning[field.key];
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

    const input = document.createElement("input");
    input.type = "range";
    input.min = field.min; input.max = field.max; input.step = field.step;
    input.value = tuning[field.key];
    input.addEventListener("input", () => {
      tuning[field.key] = Number(input.value);
      value.textContent = displayValue(field);
      save();
      if (onChange) onChange(field.key);
    });

    row.append(head, input);
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
  root = document.createElement("div");
  root.id = "tunerRoot";
  document.body.appendChild(root);
  render();
  return tuning;
}
