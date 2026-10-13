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
    while (open > 0 && next + 1 < lines.length) {
      if (
        /^\s*\|/.test(lines[next + 1]) ||
        /^\s*(`{3,}|~{3,})/.test(lines[next + 1])
      )
        break;
      row += " " + lines[++next].trim();
      open += depth(lines[next]);
    }
    if (open !== 0) {
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
  return output.join("\n");
}
