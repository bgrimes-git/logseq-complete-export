(() => {
  const key = "complete-export:colors";
  if (window.__completeExportColors) return;
  window.__completeExportColors = true;
  window.addEventListener("message", (event) => {
    const request = event.data;
    const frame = document.getElementById("complete-export_iframe");
    if (
      !frame ||
      event.source !== frame.contentWindow ||
      request?.type !== key ||
      typeof request.id !== "string" ||
      !Array.isArray(request.classes)
    )
      return;
    const colors = {};
    const container = document.createElement("div");
    container.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none";
    container.className = "block-content";
    (
      document.querySelector(".ls-block .block-content") || document.body
    ).append(container);
    try {
      const sample = document.createElement("span");
      sample.textContent = "Export color sample";
      container.append(sample);
      const inherited = getComputedStyle(sample).color;
      for (const className of request.classes.slice(0, 256)) {
        if (typeof className !== "string" || className.length > 512) continue;
        sample.className = className;
        const color = getComputedStyle(sample).color;
        if (color !== inherited) colors[className] = color;
      }
      event.source.postMessage(
        { type: key, id: request.id, colors },
        event.origin === "null" ? "*" : event.origin,
      );
    } finally {
      container.remove();
    }
  });
})();
