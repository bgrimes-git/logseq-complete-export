import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { defaults, type DocumentData } from "../src/model";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
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
  return {
    fillStyle: "#000000",
    fillRect() {},
    getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
  } as any;
};
const { exportFile, filename } = await import("../src/export");
const { htmlDocument, inline, markdown } = await import("../src/render");
test("pinned containers preserve literal delimiters inside code", () => {
  const html = inline(
    "#+BEGIN_PINNED\nNote\n\n```text\n#+END_PINNED\n```\n#+END_PINNED",
    defaults,
  );
  assert.match(html, /class="pinned"/);
  assert.match(html, /<code class="language-text">#\+END_PINNED/);
  assert.equal((html.match(/class="pinned-icon"/g) || []).length, 1);
  assert.doesNotMatch(
    inline("```text\n#+BEGIN_PINNED\nExample\n#+END_PINNED\n```", defaults),
    /class="pinned"/,
  );
  const data: DocumentData = {
    title: "Pinned note",
    graph: "Demo",
    created: "2026-10-13",
    warnings: [],
    nodes: [
      {
        uuid: "pin",
        kind: "block",
        text: "#+BEGIN_PINNED\nExample **note**\n#+END_PINNED",
        collapsed: false,
        properties: {},
        children: [],
      },
    ],
  };
  assert.match(
    markdown(data, defaults),
    /\uD83D\uDCCC \| Example \*\*note\*\*/,
  );
  assert.doesNotMatch(markdown(data, defaults), /BEGIN_PINNED|END_PINNED/);
});
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
  assert.match(html, /<colgroup><col style="width:/);
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
test("branch labels preserve inline embeds and circular page notices in every format", async () => {
  const { Resolver } = await import("../src/model");
  const page = {
    uuid: "workshop-page",
    id: 30,
    name: "workshop",
    title: "Workshop",
  };
  const blocks: Record<string, any> = {
    "20": {
      id: 20,
      uuid: "branch-target",
      page: { id: 30 },
      title: "Before {{embed ((detail))}} middle {{embed [[Workshop]]}} after",
      children: [],
    },
    detail: { uuid: "detail", title: "Embedded detail", children: [] },
  };
  const resolver = new Resolver(
    {
      getBlock: async (id) => blocks[String(id)] ?? null,
      getPage: async () => page,
      getPageBlocksTree: async () => [
        { id: 10, uuid: "branch-alias", title: "", children: [] },
      ],
      getLinkedTarget: async (id) => (id === 10 ? 20 : undefined),
    },
    defaults,
  );
  const root = await resolver.page(page);
  const wrapper = root.children[0];
  assert.equal(wrapper.ordered, undefined);
  assert.ok(wrapper.children[0].ordered);
  assert.deepEqual(resolver.warnings, ["Circular page reference: Workshop"]);
  const data = {
    ...sample,
    title: "Workshop",
    nodes: [root],
    warnings: resolver.warnings,
  };
  assert.match(htmlDocument(data, defaults), /Embedded detail/);
  for (const format of ["docx", "pdf", "html", "markdown", "json"] as const) {
    let result: Blob | undefined;
    await exportFile(
      data,
      defaults,
      format,
      (s) => s,
      (blob) => {
        result = blob;
      },
    );
    assert.ok(
      result && result.size > 0,
      `${format} must export despite a reference cycle`,
    );
    if (["html", "markdown", "json"].includes(format)) {
      const text = await result.text();
      assert.match(text, /Embedded detail/);
      if (format === "json")
        assert.match(text, /Circular page reference: Workshop/);
      else assert.doesNotMatch(text, /Circular page reference: Workshop/);
    }
  }
});

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

test("DOCX text cannot introduce XML-invalid characters into the package", async () => {
  const data = structuredClone(sample);
  data.title = "Imported notes";
  data.nodes[0].text =
    "Pasted text\u0001 with emoji \ud83d\ude42 and an unpaired surrogate \ud800";
  let result: Blob | undefined;
  await exportFile(
    data,
    defaults,
    "docx",
    (s) => s,
    (blob) => {
      result = blob;
    },
  );
  const parts = unzipSync(new Uint8Array(await result!.arrayBuffer()));
  for (const [name, bytes] of Object.entries(parts)) {
    if (!/\.(xml|rels)$/.test(name)) continue;
    const xml = strFromU8(bytes);
    const parsed = new dom.window.DOMParser().parseFromString(
      xml,
      "application/xml",
    );
    assert.equal(
      parsed.querySelector("parsererror"),
      null,
      `${name} must be well-formed XML`,
    );
  }
});

test("all formats sanitize hidden control characters and reject invalid page dimensions", async () => {
  for (const format of ["docx", "pdf", "html", "markdown", "json"] as const) {
    const data = structuredClone(sample);
    data.nodes[0].text = "Clean\u0001 text\ud800";
    let result: Blob | undefined;
    await exportFile(
      data,
      defaults,
      format,
      (s) => s,
      (blob) => {
        result = blob;
      },
    );
    assert.ok(result?.size);
    assert.ok(data.warnings.some((w) => w.includes("control characters")));
    assert.equal(
      data.nodes[0].text,
      "Clean\u0001 text\ud800",
      "The source content must not be modified",
    );
    if (["html", "markdown", "json"].includes(format)) {
      const text = await result!.text();
      assert.doesNotMatch(text, /\u0001|\\u0001|\ud800|\\ud800/u);
      assert.match(text, /Clean text/);
    }
    let saved = false;
    await assert.rejects(
      exportFile(
        data,
        { ...defaults, margins: [NaN, 0, 0, 0] },
        format,
        (s) => s,
        () => {
          saved = true;
        },
      ),
      /Invalid paper size or margins/,
    );
    assert.equal(saved, false);
  }
});

test("Windows reserved filenames and truncated trailing periods are neutralized", () => {
  for (const name of ["CON", "nul.txt", "LPT1", "COM\u00b9"])
    assert.ok(filename(name).startsWith("_"));
  assert.equal(filename("a".repeat(119) + ".more"), "a".repeat(119));
  assert.equal(filename("\u202Ename\u0001"), "name");
});

test("DOCX validates safe bookmarks and refuses malformed XML or missing package relationships", async () => {
  const { validateDocx } = await import("../src/export-safety");
  const data = structuredClone(sample);
  data.nodes[0].uuid = "long-identifier-".repeat(8);
  data.nodes[0].text += "\n\n[Jump](logseq://graph/Research?block-id=child)";
  let result: Blob | undefined;
  await exportFile(
    data,
    defaults,
    "docx",
    (s) => s,
    (blob) => {
      result = blob;
    },
  );
  await validateDocx(result!);
  const parts = unzipSync(new Uint8Array(await result!.arrayBuffer()));
  const xml = strFromU8(parts["word/document.xml"]);
  assert.match(xml, /w:name="ls_b_\d+"/);
  assert.match(xml, /w:anchor="ls_b_\d+"/);
  parts["word/document.xml"] = strToU8(
    xml.replace("Clean", "Clean\u0001") + "\u0001",
  );
  await assert.rejects(
    validateDocx(new Blob([zipSync(parts)])),
    /malformed XML/,
  );
  delete parts["word/styles.xml"];
  parts["word/document.xml"] = strToU8(xml);
  await assert.rejects(
    validateDocx(new Blob([zipSync(parts)])),
    /missing relationship target/,
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

test("PDF internal links have destinations and malformed links are rejected", async () => {
  const data = structuredClone(sample);
  data.nodes[0].text += "\n\n[Jump](logseq://graph/Research?block-id=child)";
  let output: Blob | undefined;
  await exportFile(
    data,
    defaults,
    "pdf",
    (s) => s,
    (blob) => {
      output = blob;
    },
  );
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(await output!.arrayBuffer()),
  });
  const pdf = await task.promise;
  const destinations = await pdf.getDestinations();
  const annotations = await (await pdf.getPage(1)).getAnnotations();
  assert.ok(destinations.size > 0);
  for (const annotation of annotations)
    if (typeof annotation.dest === "string")
      assert.ok(
        destinations.has(annotation.dest),
        "Every internal link must resolve",
      );
  await task.destroy();
  const { PDFDocument, PDFName, PDFString } = await import("pdf-lib");
  const broken = await PDFDocument.create();
  const page = broken.addPage();
  const annotation = broken.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [0, 0, 10, 10],
    A: { S: "GoTo", D: PDFString.of("missing") },
  });
  page.node.set(
    PDFName.of("Annots"),
    broken.context.obj([broken.context.register(annotation)]),
  );
  const { validatePdf } = await import("../src/pdf-safety");
  await assert.rejects(
    validatePdf(new Blob([new Uint8Array(await broken.save())])),
    /internal link has no destination/,
  );
});

test("tags are inline and deduplicated instead of stacked metadata", async () => {
  const { Resolver } = await import("../src/model");
  const resolver = new Resolver(
    {
      getBlock: async () => null,
      getPage: async () => null,
      getPageBlocksTree: async () => [],
      getBlockProperties: async () => ({
        Tags: [{ title: "Workshop" }, { name: "Planning" }, { title: "Tag" }],
      }),
    },
    defaults,
  );
  const node = await resolver.block({
    uuid: "tagged",
    title: "Notes #Workshop",
  });
  const data = { ...sample, nodes: [node] };
  const html = htmlDocument(data, defaults);
  assert.match(html, /Notes #Workshop #Planning/);
  assert.doesNotMatch(html, /Tags:|\[object Object\]|#Tag\b/);
  assert.equal(html.match(/#Workshop/g)?.length, 1);
  for (const format of ["docx", "pdf", "markdown"] as const) {
    let output: Blob | undefined;
    await exportFile(
      data,
      defaults,
      format,
      (s) => s,
      (blob) => {
        output = blob;
      },
    );
    let text: string;
    if (format === "docx")
      text = strFromU8(
        unzipSync(new Uint8Array(await output!.arrayBuffer()))[
          "word/document.xml"
        ],
      );
    else if (format === "pdf") {
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const job = getDocument({
        data: new Uint8Array(await output!.arrayBuffer()),
      });
      const pdf = await job.promise;
      text = (await (await pdf.getPage(1)).getTextContent()).items
        .map((item: any) => item.str ?? "")
        .join(" ");
      await job.destroy();
    } else text = await output!.text();
    assert.match(text, /#Workshop/);
    assert.match(text, /#Planning/);
    assert.doesNotMatch(text, /Tags:|\[object Object\]/);
  }
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
