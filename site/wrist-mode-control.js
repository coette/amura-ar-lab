import { tuning } from "./tuner.js?v=11.2";

// AR-03 · control mínimo de la muñeca virtual.
// Conserva todo el tuner antiguo oculto; aquí solo exponemos lo que usamos ahora.
const STORAGE_KEY = "amura.tuning.v112";
const MODES = ["OFF", "TRANSPARENTE", "SÓLIDA", "OCLUSIÓN"];

const button = document.getElementById("wristModeButton");
const value = document.getElementById("wristModeValue");

function readSavedMode() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (Number.isFinite(saved.occluderMode)) {
      tuning.occluderMode = Math.max(0, Math.min(3, Math.round(saved.occluderMode)));
    }
  } catch (error) {
    /* primera vez / modo privado */
  }
}

function persistMode() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    saved.occluderMode = tuning.occluderMode;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch (error) {
    /* modo privado */
  }
}

function syncButton() {
  const mode = Math.max(0, Math.min(3, Math.round(Number(tuning.occluderMode) || 0)));
  if (value) value.textContent = MODES[mode];
  if (button) {
    button.setAttribute("aria-pressed", mode === 0 ? "false" : "true");
    button.classList.toggle("primary-control", mode !== 0);
    button.setAttribute("aria-label", "Muñeca virtual: " + MODES[mode]);
  }
}

readSavedMode();
syncButton();

if (button) {
  button.addEventListener("click", () => {
    const current = Math.max(0, Math.min(3, Math.round(Number(tuning.occluderMode) || 0)));
    tuning.occluderMode = (current + 1) % 4;
    persistMode();
    syncButton();
  });
}
