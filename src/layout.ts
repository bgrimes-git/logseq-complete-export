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

export function tableWidths(table: Element): number[] {
  const rows = Array.from(table.querySelectorAll("tr"));
  const count = rows[0]?.children.length || 1;
  const weights = Array(count).fill(8);
  for (const row of rows)
    Array.from(row.children).forEach((cell, index) => {
      if (index >= count) return;
      const text = cell.textContent?.replace(/\s+/g, " ").trim() || "";
      weights[index] = Math.max(
        weights[index],
        Math.min(60, Array.from(text).length),
      );
    });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => (weight * 100) / total);
}

export function applyTableWidths(root: HTMLElement): void {
  for (const table of root.querySelectorAll("table")) {
    const group = document.createElement("colgroup");
    for (const width of tableWidths(table)) {
      const col = document.createElement("col");
      col.style.width = `${width}%`;
      group.append(col);
    }
    table.querySelectorAll(":scope > colgroup").forEach((col) => col.remove());
    table.prepend(group);
  }
}
