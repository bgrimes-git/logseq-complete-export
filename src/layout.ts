export function outlineStep(
  root: HTMLElement,
  width: number,
  normal = 15,
): number {
  let depth = 1;
  for (const child of root.querySelectorAll(".children")) {
    let level = 0;
    for (
      let node: Element | null = child;
      node && node !== root;
      node = node.parentElement
    )
      if (node.classList.contains("children")) level++;
    depth = Math.max(depth, level);
  }
  return Math.min(normal, (width * 0.4) / depth);
}

function textWidth(
  text: string,
  bold: boolean,
  canvas: CanvasRenderingContext2D | null,
): number {
  if (canvas?.measureText) {
    canvas.font = `${bold ? "bold " : ""}14.6667px Arial`;
    return canvas.measureText(text).width * 0.75;
  }
  return Array.from(text).reduce(
    (sum, char) =>
      sum + (/[ilI1., ]/.test(char) ? 3 : /[MW@]/.test(char) ? 9 : 6),
    0,
  );
}
function tableCanvas(): CanvasRenderingContext2D | null {
  return typeof document === "undefined"
    ? null
    : document.createElement("canvas").getContext("2d");
}

export function tableWidths(table: Element, available = 500): number[] {
  const canvas = tableCanvas();
  const rows = Array.from(table.querySelectorAll("tr"));
  const count = rows[0]?.children.length || 1;
  const minimums = Array(count).fill(22);
  const preferred = Array(count).fill(22);
  for (const row of rows)
    Array.from(row.children).forEach((cell, index) => {
      if (index >= count) return;
      const copy = cell.cloneNode(true) as Element;
      for (const br of copy.querySelectorAll("br"))
        br.replaceWith(cell.ownerDocument.createTextNode(" "));
      const text = copy.textContent?.replace(/\s+/g, " ").trim() || "";
      const header = cell.tagName === "TH";
      const longest = text
        .split(/\s+/)
        .reduce(
          (max, word) => Math.max(max, textWidth(word, header, canvas)),
          0,
        );
      // Reserve the longest header word plus padding before distributing flexible space.
      const minimum = (header ? longest : Math.min(longest, 70)) * 1.15 + 12;
      minimums[index] = Math.max(minimums[index], minimum);
      preferred[index] = Math.max(
        preferred[index],
        minimum,
        Math.min(
          240,
          textWidth(text, header, canvas) / (header ? 2.5 : 2) + 12,
        ),
      );
    });
  const reserved = minimums.reduce((sum, width) => sum + width, 0);
  if (reserved >= available)
    return minimums.map((width) => (width * 100) / reserved);
  const demand = preferred.map((width, index) =>
    Math.max(1, width - minimums[index]),
  );
  const total = demand.reduce((sum, width) => sum + width, 0);
  return minimums.map(
    (width, index) =>
      ((width + ((available - reserved) * demand[index]) / total) * 100) /
      available,
  );
}

export function tableAvailableWidth(
  table: Element,
  root: HTMLElement,
  width: number,
  step: number,
): number {
  let depth = 0;
  for (
    let node = table.parentElement;
    node && node !== root;
    node = node.parentElement
  )
    if (node.classList.contains("children")) depth++;
  return Math.max(60, width - depth * step - 10);
}

export function applyTableWidths(
  root: HTMLElement,
  width: number,
  step: number,
): void {
  for (const table of root.querySelectorAll("table")) {
    const group = document.createElement("colgroup");
    for (const percentage of tableWidths(
      table,
      tableAvailableWidth(table, root, width, step),
    )) {
      const col = document.createElement("col");
      col.style.width = `${percentage}%`;
      group.append(col);
    }
    table.querySelectorAll(":scope > colgroup").forEach((col) => col.remove());
    table.prepend(group);
  }
}
