import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { createElement, Pin } from "lucide";
import { tableSource } from "./table-source";
import { applyTableWidths, outlineStep } from "./layout";
import {
  darken,
  escape,
  cleanText,
  type DocumentData,
  type Node,
  type Options,
} from "./model";
const md = new MarkdownIt({ html: true, linkify: true, breaks: true });
function pinImage() {
  const svg = createElement(Pin, { width: 16, height: 16, stroke: "#444444" });
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return `<img class="pinned-icon" alt="Pinned" width="16" height="16" src="data:image/svg+xml;base64,${btoa(svg.outerHTML)}">`;
}
md.block.ruler.before("fence", "pinned", (state, start, end, silent) => {
  const line = (n: number) =>
    state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
  if (!/^#\+BEGIN_PINNED\s*$/i.test(line(start))) return false;
  let closing = start + 1,
    nesting = 1,
    fence = "";
  for (; closing < end; closing++) {
    const delimiter = line(closing).match(/^(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (
        delimiter[1][0] === fence[0] &&
        delimiter[1].length >= fence.length &&
        /^(`+|~+)\s*$/.test(line(closing))
      )
        fence = "";
      continue;
    }
    if (fence) continue;
    if (/^#\+BEGIN_PINNED\s*$/i.test(line(closing))) nesting++;
    if (/^#\+END_PINNED\s*$/i.test(line(closing)) && --nesting === 0) break;
  }
  if (closing === end) return false;
  if (silent) return true;
  const open = state.push("pinned_open", "div", 1);
  open.attrSet("class", "pinned");
  open.map = [start, closing + 1];
  const index = state.tokens.length;
  const oldMax = state.lineMax,
    oldParent = state.parentType;
  state.lineMax = closing;
  state.parentType = "blockquote";
  state.md.block.tokenize(state, start + 1, closing);
  const first = state.tokens.slice(index).findIndex((t) => t.type === "inline");
  if (first >= 0 && /^(p|h[1-6])$/.test(state.tokens[index + first - 1]?.tag)) {
    state.tokens[index + first - 1].attrJoin("class", "pinned-lead");
    state.tokens[index + first].content =
      `${pinImage()} | ${state.tokens[index + first].content}`;
    open.meta = { lead: true };
  }
  state.push("pinned_close", "div", -1);
  state.lineMax = oldMax;
  state.parentType = oldParent;
  state.line = closing + 1;
  return true;
});
md.renderer.rules.pinned_open = (tokens, index) =>
  `<div class="pinned">${tokens[index].meta?.lead ? "" : `<p class="pinned-lead">${pinImage()} |</p>`}`;
md.renderer.rules.pinned_close = () => "</div>\n";
const validateLink = md.validateLink.bind(md);
md.validateLink = (url) => url.startsWith("logseq://") || validateLink(url);
function normalizedColor(color: string, options: Options): string | undefined {
  let resolved = color;
  for (let depth = 0; depth < 8 && resolved.includes("var("); depth++)
    resolved = resolved.replace(
      /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]+))?\)/g,
      (_, key, fallback) => options.colorVars?.[key] || fallback || "",
    );
  if (
    !resolved ||
    resolved.includes("var(") ||
    /^(inherit|initial|unset|currentcolor)$/i.test(resolved)
  )
    return;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.fillStyle = "#ffffff";
  probe.fillRect(0, 0, 1, 1);
  probe.fillStyle = resolved;
  probe.fillRect(0, 0, 1, 1);
  return (
    "#" +
    Array.from(probe.getImageData(0, 0, 1, 1).data.slice(0, 3))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}
export function inline(text: string, options: Options): string {
  const html = DOMPurify.sanitize(md.render(tableSource(cleanText(text))), {
    ADD_ATTR: ["style"],
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|logseq|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    FORBID_TAGS: [
      "script",
      "iframe",
      "form",
      "input",
      "style",
      "button",
      "object",
      "embed",
    ],
  });
  const root = document.createElement("div");
  root.innerHTML = html;
  for (const el of root.querySelectorAll<HTMLElement>(
    "[style], span[class], mark",
  )) {
    const color =
      el.style.color ||
      options.classColors?.[
        el.tagName === "MARK"
          ? `mark:${el.className.trim()}`
          : el.className.trim()
      ];
    const highlight =
      el.tagName === "MARK"
        ? el.style.backgroundColor ||
          options.classHighlights?.[el.className.trim()] ||
          "#ffff00"
        : "";
    el.removeAttribute("style");
    // Explicit colors are intentional; inherited theme colors are not copied.
    if (color) {
      const normalized = normalizedColor(color, options);
      if (normalized) el.style.color = darken(normalized, options.darken);
    }
    if (highlight) {
      const normalized = normalizedColor(highlight, options);
      if (normalized) el.style.backgroundColor = normalized;
    }
  }
  for (const a of root.querySelectorAll("a"))
    a.style.color = darken(options.accent, options.darken);
  return root.innerHTML;
}
function visibleProperties(node: Node) {
  return Object.entries(node.properties).flatMap(
    ([key, value]): [string, unknown][] => {
      if (/^:?block\/tags$/.test(key) && Array.isArray(value)) {
        return [];
      }
      if (/^:?(?:logseq\.property\/tags|tags)$/i.test(key)) return [];
      return /^:?(logseq\.|block\/)/.test(key) ? [] : [[key, value]];
    },
  );
}
function textWithTags(node: Node): string {
  const plain = node.text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1");
  const tags = Object.entries(node.properties)
    .filter(([key]) =>
      /^:?(?:block\/tags|logseq\.property\/tags|tags)$/i.test(key),
    )
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]));
  const additions = [
    ...new Set(tags.filter((tag): tag is string => typeof tag === "string")),
  ]
    .filter((tag) => !["Page", "Asset", "Tag"].includes(tag))
    .map((tag) => (tag.includes(" ") ? `#[[${tag}]]` : `#${tag}`))
    .filter(
      (tag) =>
        !new RegExp(
          `${tag.replace(/\[\[|\]\]/g, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`,
        ).test(plain),
    );
  return [node.text, ...additions].filter(Boolean).join(" ");
}
function isCycle(node: Node): boolean {
  return (
    node.kind === "notice" &&
    /^Circular (page|block) reference:/.test(node.text)
  );
}
function propertyHtml(node: Node, options: Options) {
  if (!options.properties || !Object.keys(node.properties).length) return "";
  const entries = visibleProperties(node);
  if (!entries.length) return "";
  return `<div class="properties">${entries
    .map(
      ([k, v]) =>
        `<p><strong>${escape(k)}:</strong> ${escape(typeof v === "string" ? v : JSON.stringify(v))}</p>`,
    )
    .join("")}</div>`;
}
export function body(
  data: DocumentData,
  options: Options,
  interactive = true,
): string {
  const used = new Set<string>();
  function render(node: Node, level: number): string {
    if (isCycle(node)) return "";
    const id =
      node.uuid && !used.has(node.uuid) ? ` id="b-${escape(node.uuid)}"` : "";
    used.add(node.uuid);
    if (node.ordered) {
      const parts = node.ordered.map((part, i) =>
        typeof part === "number"
          ? `<div class="children">${render(node.children[part], level + 1)}</div>`
          : inline(
              part +
                (i === 0 ? textWithTags(node).slice(node.text.length) : ""),
              options,
            ),
      );
      if (interactive)
        return `<details${id}${node.collapsed ? "" : " open"}><summary>${parts[0] || escape(node.text)}</summary>${parts.slice(1).join("")}${propertyHtml(node, options)}</details>`;
      return `<div class="block"${id} data-outline-level="${Math.min(level + 1, 8)}">${parts.join("")}${propertyHtml(node, options)}</div>`;
    }
    const title = inline(textWithTags(node), options),
      props = propertyHtml(node, options);
    const kids = node.children.map((n) => render(n, level + 1)).join("");
    if (node.embedded)
      return `<div class="embedded"${id}><p class="embed-title">&#8594; ${escape(textWithTags(node))}</p><div class="children">${kids}</div></div>`;
    if (node.kind === "page")
      return `<section${id}>${level === 0 && data.nodes.length === 1 && node.text === data.title ? "" : `<h2>${escape(node.text)}</h2>`}${textWithTags(node) !== node.text ? `<p>${escape(textWithTags({ ...node, text: "" }))}</p>` : ""}${props}${kids}</section>`;
    if (interactive && node.children.length)
      return `<details${id}${node.collapsed ? "" : " open"}><summary>${title}</summary>${props}<div class="children">${kids}</div></details>`;
    return `<div class="block${/<table[ >]/.test(title) ? " table-block" : ""}${node.kind === "notice" ? " notice" : ""}"${id}${node.children.length ? ` data-outline-level="${Math.min(level + 1, 8)}"` : ""}>${title ? `<div class="block-title">${title}</div>` : '<p class="empty-block">&nbsp;</p>'}${props}${kids ? `<div class="children">${kids}</div>` : ""}</div>`;
  }
  let result = `<h1>${escape(data.title)}</h1>${data.nodes.map((n) => render(n, 0)).join("")}`;
  const root = document.createElement("div");
  root.innerHTML = result;
  const width =
    (options.paper === "LETTER" ? 612 : 595.3) -
    (options.margins[0] + options.margins[2]) * 72;
  const step = outlineStep(root, width);
  applyTableWidths(root, width, step);
  for (const child of root.querySelectorAll<HTMLElement>(".children"))
    child.style.paddingLeft = `${step}pt`;
  for (const a of root.querySelectorAll<HTMLAnchorElement>(
    'a[href^="logseq://"]',
  )) {
    const uuid = new URL(a.href).searchParams.get("block-id");
    if (uuid && used.has(uuid)) {
      a.dataset.source = a.href;
      a.href = `#b-${uuid}`;
    }
  }
  return root.innerHTML;
}
export function htmlDocument(data: DocumentData, options: Options): string {
  const [left, top, right, bottom] = options.margins;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(data.title)}</title><style>
  @page{size:${options.paper === "LETTER" ? "letter" : "A4"};margin:${top}in ${right}in ${bottom}in ${left}in}
  *{box-sizing:border-box}html,body{background:#fff;color:#000;font:11pt/1.5 Arial,sans-serif;letter-spacing:0}body{margin:0;padding:${top}in ${right}in ${bottom}in ${left}in}h1{font-size:22pt}h2{font-size:16pt}p{margin:0 0 6pt}section{margin-top:14pt}.block,details{margin:5pt 0;overflow-wrap:anywhere}.children{padding-left:12pt;border-left:1px solid #ddd}summary{cursor:pointer}summary p{display:inline}img{max-width:100%;height:auto}pre{white-space:pre-wrap;background:#f3f4f5;padding:8pt}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #bbb;padding:4pt}dl{font-size:9pt;display:grid;grid-template-columns:max-content 1fr;gap:2pt 8pt}dd{margin:0}.notice{color:#8a230d}a{color:${darken(options.accent, options.darken)}}@media print{body{padding:0}details:not([open])>.children{display:block}summary{list-style:none}a{color:inherit}}
  h1{margin:0 0 20pt}section{margin-top:0}h2{margin:10pt 0}p{margin:0}dl:empty{display:none}.children{border:0;padding-left:15pt}.block,details{margin:4pt 0}.block-title{position:relative;padding-left:10pt}.block-title:before{content:'\u2022';position:absolute;left:0;color:#777}summary{list-style:none;position:relative;padding-left:10pt}summary:before{content:'\u2022';position:absolute;left:0;color:#777}summary::marker{content:''}summary::-webkit-details-marker{display:none}details:not([open])>summary:before{content:'\u25b8'}.embed-title{margin:0 0 6pt}.embedded{margin:6pt 0}table{width:100%;table-layout:auto}th,td{padding:5pt;text-align:left;vertical-align:middle;overflow-wrap:break-word}th{background:#f2f2f2}img{display:block;max-width:100%;height:auto}.empty-block{height:12pt}
  h1{margin-bottom:30pt}.table-block{margin:10pt 0}figure{margin:0}figcaption{font-size:9pt;color:#555;margin-top:3pt}th{text-align:center}.block:last-child>.empty-block{display:none}.pinned-icon{display:inline-block;width:12pt;height:12pt;vertical-align:middle}th:first-child,td:first-child{width:auto}th{overflow-wrap:normal;word-break:normal}
  </style></head><body>${body(data, options)}<script>document.addEventListener('click',function(e){const a=e.target.closest('a[href^="#b-"]');if(!a)return;const n=document.getElementById(a.hash.slice(1));if(n){let p=n;while(p){if(p.tagName==='DETAILS')p.open=true;p=p.parentElement;}n.scrollIntoView();}});</script></body></html>`;
}
export function markdown(data: DocumentData, options: Options): string {
  function source(text: string): string {
    const normalized = tableSource(text);
    const lines = normalized.split("\n");
    for (const token of md.parse(normalized, {})) {
      if (token.type !== "pinned_open" || !token.map) continue;
      const [start, end] = token.map;
      lines[start] = "";
      lines[end - 1] = "";
      const first = lines.findIndex(
        (line, index) => index > start && index < end - 1 && line.trim(),
      );
      if (first >= 0) lines[first] = `\uD83D\uDCCC | ${lines[first]}`;
    }
    return lines.join("\n").trim();
  }
  function render(n: Node, depth: number): string {
    if (isCycle(n)) return "";
    const indent = "  ".repeat(depth);
    const props = options.properties
      ? visibleProperties(n)
          .map(
            ([k, v]) =>
              `${indent}  ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}\n`,
          )
          .join("")
      : "";
    if (n.ordered)
      return (
        n.ordered
          .map((part, i) =>
            typeof part === "number"
              ? render(n.children[part], depth + 1)
              : `${indent}${i === 0 ? "- " : "  "}${source(part + (i === 0 ? textWithTags(n).slice(n.text.length) : "")).replace(/\n/g, `\n${indent}  `)}\n`,
          )
          .join("") + props
      );
    if (n.embedded)
      return `${indent}- \u2192 ${textWithTags(n)}\n\n${n.children.map((c) => render(c, depth + 1)).join("")}`;
    if (n.kind === "page")
      return `${depth === 0 && data.nodes.length === 1 && n.text === data.title ? "" : `\n## ${n.text}\n\n`}${textWithTags(n) !== n.text ? `${textWithTags({ ...n, text: "" })}\n\n` : ""}${props}${n.children.map((c) => render(c, depth)).join("")}`;
    return `${indent}- ${source(textWithTags(n)).replace(/\n/g, `\n${indent}  `)}\n\n${props}${n.children.map((c) => render(c, depth + 1)).join("")}`;
  }
  return `# ${data.title}\n\n${data.nodes.map((n) => render(n, 0)).join("")}`;
}
