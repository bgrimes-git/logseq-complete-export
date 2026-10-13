export function tableSource(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];
  let fence = "";
  for (let i = 0; i < lines.length; i++) {
    const delimiter = lines[i].match(/^ {0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (
        delimiter[1][0] === fence[0] &&
        delimiter[1].length >= fence.length &&
        /^ {0,3}(`+|~+)\s*$/.test(lines[i])
      )
        fence = "";
    }
    if (fence || !/^ {0,3}\|/.test(lines[i])) {
      output.push(lines[i]);
      continue;
    }
    let row = lines[i],
      next = i;
    const depth = (s: string) =>
      (s.match(/<p\b[^>]*>/gi)?.length ?? 0) -
      (s.match(/<\/p\s*>/gi)?.length ?? 0);
    let open = depth(row);
    while ((open > 0 || !/\|\s*$/.test(row)) && next + 1 < lines.length) {
      if (
        /^\s*\|/.test(lines[next + 1]) ||
        /^\s*(`{3,}|~{3,})/.test(lines[next + 1]) ||
        (!open && !lines[next + 1].trim())
      )
        break;
      row += (open ? " " : "<br>") + lines[++next].trim();
      open += depth(lines[next]);
    }
    if (open !== 0 || !/\|\s*$/.test(row)) {
      output.push(lines[i]);
      continue;
    }
    i = next;
    // Block-level paragraphs must stay inside their Markdown cell, not become new blocks.
    row = row
      .replace(/<p(\s[^>]*)?>/gi, "<span$1>")
      .replace(/<\/p\s*>/gi, "</span>")
      .replace(/<\/span>\s*<span/gi, "</span><br><span");
    if (/^\s*\|?\s*[-+|:\s]+\|\s*$/.test(row) && row.includes("+"))
      row = row.replace(/\+/g, "|");
    output.push(row);
  }
  // Logseq accepts pipe tables without the separator MarkdownIt requires.
  // Only infer a table from complete, consecutive rows with matching cell counts.
  const result: string[] = [];
  let rows: string[] = [];
  const cellCount = (row: string) => {
    let pipes = 0,
      escaped = false;
    for (const character of row) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") escaped = true;
      else if (character === "|") pipes++;
    }
    return pipes - 1;
  };
  const separator = (row: string) => /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(row);
  function flush() {
    const count = rows.length ? cellCount(rows[0]) : 0;
    if (
      rows.length >= 2 &&
      count >= 2 &&
      rows.every((row) => cellCount(row) === count) &&
      !rows.some(separator)
    )
      rows.splice(1, 0, "|" + " --- |".repeat(count));
    result.push(...rows);
    rows = [];
  }
  fence = "";
  for (const row of output) {
    const delimiter = row.match(/^ {0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      flush();
      if (!fence) fence = delimiter[1];
      else if (
        delimiter[1][0] === fence[0] &&
        delimiter[1].length >= fence.length &&
        /^ {0,3}(`+|~+)\s*$/.test(row)
      )
        fence = "";
      result.push(row);
    } else if (!fence && /^ {0,3}\|.*\|\s*$/.test(row) && !/<\/?p\b/i.test(row))
      rows.push(row);
    else {
      flush();
      result.push(row);
    }
  }
  flush();
  return result.join("\n");
}
