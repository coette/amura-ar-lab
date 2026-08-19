// AR-03 · control temporal de colocación X del reloj.
// P0, la tríada y la muñeca virtual no se mueven: solo watchAnchor.
const ZERO_X_MM = 0;
const FIT_X_MM = -24;

window.AmuraWatchPlacementXmm = ZERO_X_MM;

const button = document.getElementById("watchXButton");
const value = document.getElementById("watchXValue");

function syncWatchXButton() {
  const current = Number(window.AmuraWatchPlacementXmm) || 0;
  const fitted = current === FIT_X_MM;

  if (button) {
    button.setAttribute("aria-pressed", fitted ? "true" : "false");
    button.classList.toggle("primary-control", fitted);
    button.setAttribute(
      "aria-label",
      fitted ? "Volver reloj a X cero" : "Mover reloj menos 24 milímetros en X"
    );
  }

  // El texto indica la ACCIÓN del siguiente toque, no la posición actual.
  // Así, en cero se ve claramente el botón «−24 mm» que queremos probar.
  if (value) {
    value.textContent = fitted ? "0 mm" : "−24 mm";
  }

  if (window.AmuraTrackingDiagnostics) {
    window.AmuraTrackingDiagnostics["Posición X reloj"] =
      (current > 0 ? "+" : "") + current + " mm";
  }
}

if (button) {
  button.addEventListener("click", () => {
    window.AmuraWatchPlacementXmm =
      (Number(window.AmuraWatchPlacementXmm) || 0) === FIT_X_MM
        ? ZERO_X_MM
        : FIT_X_MM;
    syncWatchXButton();
  });
}

syncWatchXButton();