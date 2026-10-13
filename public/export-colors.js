(() => {
  const key = "complete-export:styles-v2";
  const pluginId = document.currentScript?.dataset.ref || "complete-export";
  window.__completeExportColorHelpers ||= new Set();
  const helperKey = `${pluginId}:highlights-v1`;
  if (window.__completeExportColorHelpers.has(helperKey)) return;
  window.__completeExportColorHelpers.add(helperKey);
  window.addEventListener("message", (event) => {
    const request = event.data;
    const frame = document.getElementById(`${pluginId}_iframe`);
    if (
      !frame ||
      event.source !== frame.contentWindow ||
      request?.type !== key ||
      typeof request.id !== "string" ||
      !Array.isArray(request.classes)
    )
      return;
    const colors = {};
    const highlights = {};
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
      const mark = document.createElement("mark");
      mark.textContent = "Export highlight sample";
      container.append(mark);
      for (const className of (request.marks || []).slice(0, 256)) {
        if (typeof className !== "string" || className.length > 512) continue;
        mark.className = className;
        const style = getComputedStyle(mark);
        highlights[className] = style.backgroundColor;
        if (style.color !== inherited)
          colors[`mark:${className}`] = style.color;
      }
      event.source.postMessage(
        { type: key, id: request.id, colors, highlights },
        event.origin === "null" ? "*" : event.origin,
      );
    } finally {
      container.remove();
    }
  });
})();
