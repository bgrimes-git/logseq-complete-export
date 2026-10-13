import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ExternalHyperlink,
  InternalHyperlink,
  Bookmark,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ImageRun,
  TableLayoutType,
  BorderStyle,
  AlignmentType,
  VerticalAlign,
  LineRuleType,
} from "docx";
import pdfMake from "pdfmake/build/pdfmake";
import fonts from "pdfmake/build/vfs_fonts";
import htmlToPdfmake from "html-to-pdfmake";
import { body, htmlDocument, markdown } from "./render";
import { cleanText, type DocumentData, type Options } from "./model";
import {
  prepareExport,
  prepareDocxAnchors,
  validateDocx,
} from "./export-safety";
import { imageSize } from "image-size";
import {
  preparePdfAnchors,
  normalizePdfAnchors,
  validatePdf,
} from "./pdf-safety";
pdfMake.addVirtualFileSystem(fonts);
export type Format = "docx" | "pdf" | "html" | "markdown" | "json";
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export const filename = (title: string) => {
  let name =
    cleanText(title)
      .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .slice(0, 120)
      .replace(/[. ]+$/, "") || "Logseq export";
  if (
    /^(CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(
      name,
    )
  )
    name = `_${name}`;
  return name;
};
type Inline = TextRun | ExternalHyperlink | InternalHyperlink | ImageRun;
function bookmarked(element: HTMLElement, children: Inline[]) {
  const names: string[] = JSON.parse(element.dataset.docxBookmarks ?? "[]");
  return [
    ...names.map((id) => new Bookmark({ id, children: [] })),
    ...children,
  ];
}
function runs(node: globalThis.Node, marks: any = {}): Inline[] {
  if (node.nodeType === 3)
    return [new TextRun({ text: node.textContent ?? "", ...marks })];
  if (!(node instanceof HTMLElement)) return [];
  const tag = node.tagName;
  const style = {
    ...marks,
    bold: marks.bold || ["B", "STRONG", "TH"].includes(tag),
    italics: marks.italics || ["I", "EM"].includes(tag),
    strike: marks.strike || ["S", "DEL"].includes(tag),
    ...(tag === "CODE" ? { font: "Consolas" } : {}),
  };
  if (node.style.color) {
    const canvas = document.createElement("canvas").getContext("2d")!;
    canvas.fillStyle = node.style.color;
    if (canvas.fillStyle.startsWith("#"))
      style.color = canvas.fillStyle.slice(1);
  }
  if (tag === "MARK" && node.style.backgroundColor) {
    const canvas = document.createElement("canvas").getContext("2d")!;
    canvas.fillStyle = node.style.backgroundColor;
    if (canvas.fillStyle.startsWith("#"))
      style.shading = { fill: canvas.fillStyle.slice(1) };
  }
  if (tag === "BR") return [new TextRun({ break: 1 })];
  if (tag === "IMG") {
    const src = (node as HTMLImageElement).src;
    if (/^data:image\/(png|jpeg);base64,/.test(src)) {
      const data = Uint8Array.from(atob(src.split(",")[1]), (c) =>
        c.charCodeAt(0),
      );
      const requestedWidth = Math.min(
        Number(node.getAttribute("width")) ||
          (node as HTMLImageElement).naturalWidth ||
          Number(node.dataset.width) ||
          400,
        500,
      );
      const width =
        Number.isFinite(requestedWidth) && requestedWidth > 0
          ? requestedWidth
          : 250;
      const ratio =
        ((node as HTMLImageElement).naturalHeight ||
          Number(node.dataset.height) ||
          300) /
        ((node as HTMLImageElement).naturalWidth ||
          Number(node.dataset.width) ||
          400);
      return [
        new ImageRun({
          data,
          type: src.includes("image/png") ? "png" : "jpg",
          transformation: {
            width: width * Math.min(1, 700 / (width * ratio)),
            height: Math.min(width * ratio, 700),
          },
        }),
      ];
    }
    return [
      new TextRun({ text: `[Image: ${node.getAttribute("alt") || src}]` }),
    ];
  }
  const children = Array.from(node.childNodes).flatMap((n) => runs(n, style));
  if (tag === "A") {
    const href = node.getAttribute("href") || "";
    if (
      !href ||
      (!href.startsWith("#") && !/^(https?:|mailto:|logseq:)/i.test(href))
    )
      return children;
    // Hyperlink children must be runs; nested links are excluded by Markdown parsing.
    if (href.startsWith("#"))
      return [
        new InternalHyperlink({
          anchor: href.slice(1),
          children: children as TextRun[],
        }),
      ];
    return [
      new ExternalHyperlink({ link: href, children: children as TextRun[] }),
    ];
  }
  return children;
}
function docxContent(
  root: HTMLElement,
  indent = 0,
  available = 11232,
  bullet = false,
): (Paragraph | Table)[] {
  const output: (Paragraph | Table)[] = [];
  for (const el of Array.from(root.children) as HTMLElement[]) {
    const tag = el.tagName;
    if (tag === "IMG" && (bullet || root.classList.contains("block-title"))) {
      const width = Math.min(
        Number(el.getAttribute("width")) || 250,
        (available - indent - 180) / 15,
      );
      el.setAttribute("width", String(width));
      const border = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
      output.push(
        new Table({
          width: { size: Math.round(width * 15 + 180), type: WidthType.DXA },
          indent: { size: indent, type: WidthType.DXA },
          columnWidths: [180, Math.round(width * 15)],
          borders: {
            top: border,
            bottom: border,
            left: border,
            right: border,
            insideHorizontal: border,
            insideVertical: border,
          },
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  verticalAlign: VerticalAlign.TOP,
                  children: [
                    new Paragraph({
                      children: bookmarked(el, [
                        new TextRun({ text: "\u2022", color: "777777" }),
                      ]),
                      spacing: { before: 0, after: 0 },
                    }),
                  ],
                }),
                new TableCell({
                  children: [
                    new Paragraph({
                      children: runs(el),
                      spacing: { before: 0, after: 0 },
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      );
      continue;
    }
    if (tag === "TABLE") {
      const tableIndent =
        indent + (root.classList.contains("block-title") || bullet ? 180 : 0);
      const count = el.querySelector("tr")?.children.length || 1;
      output.push(
        new Table({
          width: { size: available - tableIndent, type: WidthType.DXA },
          indent: { size: tableIndent, type: WidthType.DXA },
          layout: TableLayoutType.FIXED,
          borders: Object.fromEntries(
            [
              "top",
              "bottom",
              "left",
              "right",
              "insideHorizontal",
              "insideVertical",
            ].map((side) => [
              side,
              { style: BorderStyle.SINGLE, size: 4, color: "B8B8B8" },
            ]),
          ),
          columnWidths:
            count === 2
              ? [
                  Math.round((available - tableIndent) * 0.22),
                  Math.round((available - tableIndent) * 0.78),
                ]
              : Array(count).fill(
                  Math.floor((available - tableIndent) / count),
                ),
          rows: Array.from(el.querySelectorAll("tr")).map(
            (row) =>
              new TableRow({
                children: Array.from(row.children).map(
                  (cell, index) =>
                    new TableCell({
                      width: {
                        size:
                          count === 2 ? (index === 0 ? 22 : 78) : 100 / count,
                        type: WidthType.PERCENTAGE,
                      },
                      margins: { top: 90, bottom: 90, left: 90, right: 90 },
                      verticalAlign: VerticalAlign.CENTER,
                      ...(cell.tagName === "TH"
                        ? { shading: { fill: "F2F2F2" } }
                        : {}),
                      children: [
                        new Paragraph({
                          children: bookmarked(cell as HTMLElement, runs(cell)),
                          spacing: {
                            before: 0,
                            after: 0,
                            line: 330,
                            lineRule: LineRuleType.EXACT,
                          },
                          alignment:
                            cell.tagName === "TH"
                              ? AlignmentType.CENTER
                              : AlignmentType.LEFT,
                        }),
                      ],
                    }),
                ),
              }),
          ),
        }),
      );
    } else if (["DIV", "SECTION", "UL", "OL", "FIGURE"].includes(tag)) {
      if (el.classList.contains("block-title")) {
        output.push(...docxContent(el, indent, available));
        continue;
      }
      if (el.id && el.firstElementChild) el.firstElementChild.id ||= el.id;
      output.push(
        ...docxContent(
          el,
          el.classList.contains("children")
            ? Math.min(indent + 180, 720)
            : indent,
          available,
          el.tagName === "FIGURE" &&
            (root.classList.contains("block-title") || bullet),
        ),
      );
    } else {
      if (el.classList.contains("empty-block") && !root.nextElementSibling)
        continue;
      const beforeTable =
        el.nextElementSibling?.tagName === "TABLE" ||
        root.parentElement?.querySelector(
          ":scope > .children > .table-block:first-child",
        );
      const afterTable =
        el.previousElementSibling?.tagName === "TABLE" ||
        root.parentElement?.previousElementSibling?.classList.contains(
          "table-block",
        );
      const isBullet =
        (root.classList.contains("block-title") || bullet || tag === "LI") &&
        tag !== "FIGCAPTION";
      const children = runs(
        el,
        tag === "FIGCAPTION" ? { size: 18, color: "555555" } : {},
      );
      const heading =
        tag === "H1"
          ? HeadingLevel.TITLE
          : tag === "H2"
            ? HeadingLevel.HEADING_1
            : /^H[3-6]$/.test(tag)
              ? HeadingLevel.HEADING_2
              : undefined;
      const outlineLevel =
        el === root.firstElementChild && root.dataset.outlineLevel
          ? Number(root.dataset.outlineLevel)
          : undefined;
      output.push(
        new Paragraph({
          children: bookmarked(el, children),
          heading,
          outlineLevel,
          indent: isBullet
            ? { left: indent + 180, hanging: 180 }
            : { left: indent + (tag === "FIGCAPTION" ? 180 : 0) },
          spacing: {
            before: tag === "H1" ? 0 : afterTable ? 200 : 0,
            after: tag === "H1" ? 600 : beforeTable ? 200 : 80,
            ...(el.querySelector("img") || tag === "IMG"
              ? {}
              : {
                  line: tag === "H1" ? 660 : tag === "FIGCAPTION" ? 240 : 330,
                  lineRule: LineRuleType.EXACT,
                }),
          },
          ...(isBullet ? { bullet: { level: 0 } } : {}),
        }),
      );
    }
  }
  return output;
}
export async function loadImages(
  root: HTMLElement,
  data: DocumentData,
  assetUrl: (s: string) => string | Promise<string>,
) {
  let totalBytes = 0;
  for (const img of root.querySelectorAll("img")) {
    const original = img.getAttribute("src") || "";
    try {
      const response = await fetch(await assetUrl(original), {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (blob.size > 16 * 1024 * 1024)
        throw new Error("Image exceeds the 16 MiB safety limit.");
      const dimensions = imageSize(new Uint8Array(await blob.arrayBuffer()));
      if (
        !dimensions.width ||
        !dimensions.height ||
        dimensions.width > 16384 ||
        dimensions.height > 16384 ||
        dimensions.width * dimensions.height > 16_000_000
      )
        throw new Error(
          "Image exceeds the 16-million-pixel safety limit or has invalid dimensions.",
        );
      const url = URL.createObjectURL(blob);
      try {
        const decoder = document.createElement("img");
        decoder.src = url;
        await decoder.decode();
        const canvas = document.createElement("canvas");
        canvas.width = decoder.naturalWidth;
        canvas.height = decoder.naturalHeight;
        canvas.getContext("2d")!.drawImage(decoder, 0, 0);
        const encoded = canvas.toDataURL("image/png");
        if (encoded === "data:," || encoded.length > (16 * 1024 * 1024 * 4) / 3)
          throw new Error("Normalized image exceeds the 16 MiB safety limit.");
        totalBytes += (encoded.length * 3) / 4;
        if (totalBytes > 64 * 1024 * 1024)
          throw new Error("Embedded images exceed the 64 MiB safety limit.");
        img.src = encoded;
        const requested = Number(img.getAttribute("width"));
        const width =
          requested > 0 && Number.isFinite(requested)
            ? Math.min(requested, 500)
            : Math.min(decoder.naturalWidth, 500);
        img.setAttribute(
          "width",
          String(
            Math.max(
              1,
              Math.round(
                width *
                  Math.min(
                    1,
                    700 /
                      ((width * decoder.naturalHeight) / decoder.naturalWidth),
                  ),
              ),
            ),
          ),
        );
        img.removeAttribute("height");
        img.dataset.width = String(decoder.naturalWidth);
        img.dataset.height = String(decoder.naturalHeight);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      data.warnings.push(
        `Image could not be embedded: ${original}: ${String(e)}`,
      );
      img.replaceWith(
        document.createTextNode(`[Image unavailable: ${img.alt || original}]`),
      );
    }
  }
}
export async function exportFile(
  data: DocumentData,
  options: Options,
  format: Format,
  assetUrl: (s: string) => string | Promise<string>,
  save = download,
) {
  if (
    options.margins.length !== 4 ||
    options.margins.some((n) => !Number.isFinite(n) || n < 0 || n > 2) ||
    !["LETTER", "A4"].includes(options.paper)
  )
    throw new Error("Invalid paper size or margins. No file was saved.");
  const writer = save;
  save = (blob, name) => {
    if (!blob.size || blob.size > 128 * 1024 * 1024)
      throw new Error(
        "Export is empty or exceeds the 128 MiB safety limit. No file was saved.",
      );
    writer(blob, name);
  };
  data = prepareExport(data);
  const name = filename(data.title);
  if (format === "json") {
    save(
      new Blob(
        [JSON.stringify({ schemaVersion: 1, ...data, options }, null, 2)],
        { type: "application/json" },
      ),
      `${name}.json`,
    );
    return;
  }
  if (format === "markdown") {
    const copy = structuredClone(data);
    async function embedImages(nodes: DocumentData["nodes"]) {
      for (const node of nodes) {
        if (/<img[ >]/i.test(node.text)) {
          const images = document.createElement("div");
          images.innerHTML = node.text;
          await loadImages(images, copy, assetUrl);
          node.text = images.innerHTML;
        }
        await embedImages(node.children);
      }
    }
    await embedImages(copy.nodes);
    data.warnings.push(
      ...copy.warnings.filter((warning) => !data.warnings.includes(warning)),
    );
    save(
      new Blob([markdown(copy, options)], {
        type: "text/markdown;charset=utf-8",
      }),
      `${name}.md`,
    );
    return;
  }
  const root = document.createElement("div");
  root.innerHTML =
    format === "html"
      ? htmlDocument(data, options)
      : body(data, options, false);
  // HTML documents need their head/style retained, so parse the complete document separately.
  const htmlDoc =
    format === "html"
      ? new DOMParser().parseFromString(
          htmlDocument(data, options),
          "text/html",
        )
      : null;
  const content = htmlDoc?.body ?? root;
  await loadImages(content, data, assetUrl);
  if (format === "html") {
    save(
      new Blob(["<!doctype html>\n" + htmlDoc!.documentElement.outerHTML], {
        type: "text/html;charset=utf-8",
      }),
      `${name}.html`,
    );
    return;
  }
  const [left, top, right, bottom] = options.margins;
  if (format === "docx") {
    prepareDocxAnchors(content);
    const doc = new Document({
      creator: "Complete Export",
      title: data.title,
      styles: {
        default: {
          document: {
            run: { font: "Arial", size: 22, color: "000000" },
            paragraph: { spacing: { after: 80 } },
          },
          title: { run: { color: "000000", size: 44 } },
          heading1: { run: { color: "000000", size: 32 } },
          heading2: { run: { color: "000000", size: 28 } },
        },
      },
      background: { color: "FFFFFF" },
      sections: [
        {
          properties: {
            page: {
              size:
                options.paper === "A4"
                  ? { width: 11906, height: 16838 }
                  : { width: 12240, height: 15840 },
              margin: {
                left: Math.round(left * 1440),
                top: Math.round(top * 1440),
                right: Math.round(right * 1440),
                bottom: Math.round(bottom * 1440),
              },
            },
          },
          children: docxContent(
            content,
            0,
            (options.paper === "A4" ? 11906 : 12240) -
              Math.round((left + right) * 1440),
          ),
        },
      ],
    });
    const blob = await Packer.toBlob(doc);
    await validateDocx(blob);
    save(blob, `${name}.docx`);
  } else {
    preparePdfAnchors(content);
    for (const table of content.querySelectorAll<HTMLElement>("table")) {
      const count = table.querySelector("tr")?.children.length || 1;
      table.dataset.pdfmake = JSON.stringify({
        widths: count === 2 ? ["22%", "78%"] : Array(count).fill("*"),
        margin: [0, 0, 0, 0],
      });
      for (const cell of table.querySelectorAll<HTMLElement>("td,th")) {
        cell.style.padding = "5pt";
        if (cell.tagName === "TH") cell.style.textAlign = "center";
      }
    }
    const convert = (html: string) =>
      htmlToPdfmake(html, {
        window,
        imagesByReference: false,
        removeExtraBlanks: true,
        defaultStyles: {
          div: { margin: [0, 0, 0, 0] },
          p: { margin: [0, 0, 0, 0] },
          h1: { fontSize: 22, margin: [0, 0, 0, 0], marginBottom: "" },
          h2: { fontSize: 16, margin: [0, 0, 0, 0], marginBottom: "" },
          ul: { marginLeft: 0, marginBottom: 0 },
          table: { marginBottom: 0 },
        },
        customTag: ({ element, ret }: any) => {
          if (element.tagName === "MARK" && element.style.backgroundColor) {
            // PDFMake flattens nested inline arrays; put the fill on their text runs too.
            const fill = (node: any) => {
              if (!node || typeof node !== "object") return;
              node.background ??= element.style.backgroundColor;
              if (Array.isArray(node.text)) node.text.forEach(fill);
            };
            fill(ret);
          }
          if (element.classList?.contains("pinned-lead")) {
            const image = element.querySelector("img.pinned-icon");
            if (image) {
              const copy = element.cloneNode(true);
              copy.querySelector("img.pinned-icon").remove();
              copy.classList.remove("pinned-lead");
              return {
                columns: [
                  { image: image.src, width: 12 },
                  { width: "*", stack: convert(copy.outerHTML) },
                ],
                columnGap: 3,
                margin: [0, 0, 0, 0],
              };
            }
          }
          if (element.classList?.contains("embed-title")) {
            return {
              columns: [
                {
                  width: 12,
                  canvas: [
                    {
                      type: "line",
                      x1: 0,
                      y1: 7,
                      x2: 8,
                      y2: 7,
                      lineWidth: 0.8,
                    },
                    {
                      type: "line",
                      x1: 5,
                      y1: 4,
                      x2: 8,
                      y2: 7,
                      lineWidth: 0.8,
                    },
                    {
                      type: "line",
                      x1: 5,
                      y1: 10,
                      x2: 8,
                      y2: 7,
                      lineWidth: 0.8,
                    },
                  ],
                },
                {
                  text: element.textContent.replace(/^\u2192\s*/, ""),
                  ...(element.id ? { id: element.id } : {}),
                },
              ],
              margin: [0, 0, 0, 0],
            };
          }
          return ret;
        },
      });
    // Convert leaf blocks separately so inherited list margins cannot accumulate around tables.
    function pdfContent(root: HTMLElement, indent = 0, bullet = false): any[] {
      const result: any[] = [];
      for (const el of Array.from(root.children) as HTMLElement[]) {
        if (["DIV", "SECTION", "FIGURE"].includes(el.tagName)) {
          const nested = pdfContent(
            el,
            el.classList.contains("children")
              ? Math.min(indent + 15, 60)
              : indent,
            el.classList.contains("block-title") ||
              (bullet && el.tagName === "FIGURE"),
          );
          result.push(...nested);
          continue;
        }
        if (el.classList.contains("empty-block") && !root.nextElementSibling)
          continue;
        const table = el.tagName === "TABLE";
        const title = el.tagName === "H1";
        const caption = el.tagName === "FIGCAPTION";
        const image = el.tagName === "IMG";
        const html =
          bullet && !caption && !image
            ? `<ul><li>${el.outerHTML}</li></ul>`
            : el.outerHTML;
        const stack = convert(html);
        stack.forEach((node: any) => normalizePdfAnchors(node));
        const applyTableLayout = (node: any) => {
          if (!node || typeof node !== "object") return;
          if (node.table)
            node.layout = {
              hLineWidth: () => 0.5,
              vLineWidth: () => 0.5,
              hLineColor: () => "#bbb",
              vLineColor: () => "#bbb",
              paddingLeft: () => 5,
              paddingRight: () => 5,
              paddingTop: () => 5,
              paddingBottom: () => 5,
            };
          for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(applyTableLayout);
          }
        };
        stack.forEach(applyTableLayout);
        result.push({
          ...(image && bullet
            ? {
                columns: [
                  { width: 10, text: "\u2022", color: "#777" },
                  { width: "*", stack },
                ],
              }
            : { stack }),
          margin: [
            indent + (caption ? 10 : 0),
            table ? 6 : 0,
            0,
            title ? 30 : table ? 10 : caption ? 6 : 4,
          ],
          ...(caption ? { fontSize: 9, color: "#555" } : {}),
        });
      }
      return result;
    }
    const definition = {
      version: "1.4",
      info: { title: data.title, creator: "Complete Export" },
      pageSize: options.paper,
      pageMargins: [left * 72, top * 72, right * 72, bottom * 72],
      defaultStyle: { fontSize: 11, lineHeight: 1.28, color: "#000000" },
      content: pdfContent(content),
      styles: { "html-h1": { fontSize: 22 }, "html-h2": { fontSize: 16 } },
    };
    const blob = await pdfMake.createPdf(definition).getBlob();
    await validatePdf(blob);
    save(blob, `${name}.pdf`);
  }
}
