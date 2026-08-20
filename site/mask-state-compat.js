const maskState = document.getElementById("maskStateValue");

if (maskState) {
  let rewriting = false;
  const keepRawPrefix = () => {
    if (rewriting) return;
    const text = String(maskState.textContent || "");
    if (!text.startsWith("NUBE AUTÓNOMA")) return;
    rewriting = true;
    maskState.textContent = "CRUDO · " + text;
    rewriting = false;
  };

  new MutationObserver(keepRawPrefix).observe(maskState, {
    childList: true,
    characterData: true,
    subtree: true
  });
  keepRawPrefix();
}