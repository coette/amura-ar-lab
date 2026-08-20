import { tuning } from "./tuner.js?v=11.2";

// AR-03/04 · control mínimo de posición X del reloj.
// P0, tríada y muñeca virtual no se mueven nunca.
const STORAGE_KEY = "amura.tuning.v112";
const ZERO_X_MM = 0;
const FIT_X_MM = -24;
const STATES = [
  { x: ZERO_X_MM, visible: 1, label: "0 mm" },
  { x: FIT_X_MM, visible: 1, label: "−24 mm" },
  { x: FIT_X_MM, visible: 0, label: "OCULTO" }
];

// AR-04 parte de la colocación ya validada de −24 mm.
let stateIndex = 1;
window.AmuraWatchPlacementXmm = FIT_X_MM;

const button = document.getElementById("watchXButton");
const value = document.getElementById("watchXValue");

function persistWatchVisible() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    saved.watchVisible = Number(tuning.watchVisible) ? 1 : 0;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch (error) {
    /* modo privado */
  }
}

function applyState() {
  const state = STATES[stateIndex];
  window.AmuraWatchPlacementXmm = state.x;
  tuning.watchVisible = state.visible;
  persistWatchVisible();

  if (value) value.textContent = state.label;
  if (button) {
    button.setAttribute("aria-pressed", stateIndex === 0 ? "false" : "true");
    button.classList.toggle("primary-control", stateIndex !== 0);
    button.setAttribute(
      "aria-label",
      state.visible
        ? "Reloj visible en X " + state.label
        : "Reloj oculto"
    );
  }

  if (window.AmuraTrackingDiagnostics) {
    window.AmuraTrackingDiagnostics["Posición X reloj"] = state.visible
      ? state.x + " mm"
      : "oculto";
  }
}

applyState();

if (button) {
  button.addEventListener("click", () => {
    stateIndex = (stateIndex + 1) % STATES.length;
    applyState();
  });
}
