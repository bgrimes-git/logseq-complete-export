import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { defaults, type DocumentData } from "../src/model";
import { unzipSync, strFromU8 } from "fflate";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  DOMParser: dom.window.DOMParser,
});
// Canvas color normalization is the only canvas operation in these text fixtures.
dom.window.HTMLCanvasElement.prototype.getContext = function () {
  return { fillStyle: "#000000" } as any;
};
const { exportFile } = await import("../src/export");
const { htmlDocument, inline } = await import("../src/render");
test("Synthetic collection has an embed heading, readable table and no system metadata", async () => {
  await mkdir(new URL("../test-results/", import.meta.url), {
    recursive: true,
  });
  const data = JSON.parse(
    await readFile(
      new URL("./collection.fixture.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(data.nodes[0].children[0].text, "Workshop planning");
  const html = htmlDocument(data, data.options);
  assert.match(html, /\u2192 Workshop planning/);
  assert.doesNotMatch(html, /:block\/tags|checksum|logseq.property.asset/);
  assert.match(html, /width:22%/);
  await writeFile(
    new URL("../test-results/collection.html", import.meta.url),
    html,
  );
  for (const format of ["docx", "pdf"] as const) {
    let output: Blob | undefined;
    await exportFile(
      data,
      data.options,
      format,
      (s) => s,
      (blob) => {
        output = blob;
      },
    );
    await writeFile(
      new URL(`../test-results/collection.${format}`, import.meta.url),
      new Uint8Array(await output!.arrayBuffer()),
    );
    if (format === "pdf") {
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const loading = getDocument({
        data: new Uint8Array(await output!.arrayBuffer()),
      });
      const pdf = await loading.promise;
      const text = await (await pdf.getPage(1)).getTextContent();
      const items = text.items.filter(
        (item): item is import("pdfjs-dist/types/src/display/api").TextItem =>
          "str" in item,
      );
      assert.ok(items.some((item) => item.str.includes("Workshop planning")));
      assert.ok(items.some((item) => item.str.includes("Activity")));
      const y = (text: string) =>
        items.find((item) => item.str === text)!.transform[5];
      assert.ok(
        Math.abs(
          y(
            "Collect the activities in a single page so everyone can review the plan:",
          ) -
            y("Activity") -
            (y("Discussion") - y("Next step:")),
        ) < 1,
        "Table spacing must be balanced above and below",
      );
      await loading.destroy();
    }
  }
});
const sample: DocumentData = {
  title: "Collected Notes",
  graph: "Research",
  created: "2026-10-04",
  warnings: [],
  nodes: [
    {
      uuid: "root",
      kind: "block",
      text: "**Bold** and [external](https://example.com)\n\n| Key | Value |\n| --- | --- |\n| A | B |",
      collapsed: true,
      properties: { status: "Ready" },
      children: [
        {
          uuid: "child",
          kind: "block",
          text: "Nested referenced content",
          collapsed: false,
          properties: {},
          children: [],
        },
      ],
    },
  ],
};
test("HTML preserves collapsible hierarchy, neutral colors and configurable margins", () => {
  const html = htmlDocument(sample, defaults);
  assert.match(html, /background:#fff;color:#000/);
  assert.match(html, /margin:0.35in 0.35in 0.35in 0.35in/);
  assert.match(html, /<details id="b-root">/);
  assert.match(html, /Nested referenced content/);
  assert.doesNotMatch(
    inline(
      '<script>alert(1)</script><span style="margin-left:4in;background:brown;color:#abc">Text</span>',
      defaults,
    ),
    /script|margin-left|background/,
  );
});
test("DOCX contains expanded content, editable table, links and 0.35-inch margins", async () => {
  let result: Blob | undefined;
  await exportFile(
    structuredClone(sample),
    defaults,
    "docx",
    (s) => s,
    (blob) => {
      result = blob;
    },
  );
  const files = unzipSync(new Uint8Array(await result!.arrayBuffer()));
  const xml = strFromU8(files["word/document.xml"]);
  assert.match(xml, /Nested referenced content/);
  assert.match(xml, /<w:tbl>/);
  assert.match(xml, /w:left="504"/);
  assert.match(xml, /w:top="504"/);
  assert.match(xml, /w:b/);
  assert.match(xml, /w:hanging="180"/);
  assert.match(xml, /w:after="600"/);
  assert.match(xml, /w:tblInd/);
  assert.doesNotMatch(xml, /<w:t[^>]*><\/w:t>/);
  assert.match(
    strFromU8(files["word/_rels/document.xml.rels"]),
    /https:\/\/example.com/,
  );
});
test("PDF creates a valid text-based document", async () => {
  let result: Blob | undefined;
  await exportFile(
    structuredClone(sample),
    defaults,
    "pdf",
    (s) => s,
    (blob) => {
      result = blob;
    },
  );
  const bytes = new Uint8Array(await result!.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  assert.ok(bytes.length > 3000);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  const doc = await loading.promise;
  const page = await doc.getPage(1),
    content = await page.getTextContent();
  const items = content.items.filter(
    (item): item is import("pdfjs-dist/types/src/display/api").TextItem =>
      "str" in item,
  );
  assert.ok(
    items.some((item) => item.str.includes("Nested referenced content")),
  );
  const title = items.find((item) => item.str === "Collected Notes")!;
  assert.ok(
    Math.abs(title.transform[4] - 25.2) < 1,
    "PDF title must begin at the 0.35-inch left margin",
  );
  await loading.destroy();
});
test("Markdown and JSON retain nested content and UUID metadata", async () => {
  for (const format of ["markdown", "json"] as const) {
    let result: Blob | undefined;
    await exportFile(
      sample,
      defaults,
      format,
      (s) => s,
      (blob) => {
        result = blob;
      },
    );
    const text = await result!.text();
    assert.match(text, /Nested referenced content/);
    if (format === "json") assert.equal(JSON.parse(text).nodes[0].uuid, "root");
  }
});
test("embedded content stays between the surrounding text", async () => {
  const { Resolver } = await import("../src/model");
  const r = new Resolver(
    {
      async getBlock() {
        return { uuid: "embed", title: "Embedded middle" };
      },
      async getPage() {
        return null;
      },
      async getPageBlocksTree() {
        return [];
      },
    },
    defaults,
  );
  const node = await r.block({
    uuid: "root",
    title: "Before {{embed ((embed))}} After",
  });
  const html = htmlDocument({ ...sample, nodes: [node] }, defaults);
  assert.ok(html.indexOf("Embedded middle</p>") < html.indexOf("After</p>"));
  assert.ok(html.indexOf("Before") < html.indexOf("Embedded middle</p>"));
});
