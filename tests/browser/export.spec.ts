import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
test("synthetic workshop preview preserves the table and embed heading", async ({
  page,
}) => {
  const fixture = JSON.parse(
    await readFile(
      new URL("../collection.fixture.json", import.meta.url),
      "utf8",
    ),
  );
  await page.setViewportSize({ width: 660, height: 1150 });
  await page.evaluate((fixture) => {
    const ls = (window as any).logseq;
    const section = fixture.nodes[0].children[0];
    function raw(node: any): any {
      return { ...node, title: node.text, children: node.children.map(raw) };
    }
    ls.Editor.getBlock = async () => raw(section);
    ls.Editor.getPageBlocksTree = async () => [
      { id: 50, uuid: "demo-wrapper", title: "", children: [] },
    ];
    const oldQuery = ls.DB.datascriptQuery;
    ls.DB.datascriptQuery = async (q: string) =>
      q.includes(":find ?b ?target") ? [[50, 60]] : oldQuery(q);
  }, fixture);
  await page.locator("#preview").click();
  await expect(page.locator("#status")).toHaveText("Preview ready.");
  await expect(
    page.frameLocator("#previewFrame").locator("table"),
  ).toBeVisible();
  await expect(
    page.frameLocator("#previewFrame").locator(".embed-title"),
  ).toContainText("Workshop planning");
  if (process.env.CAPTURE_DEMO) {
    await mkdir("docs", { recursive: true });
    await page.screenshot({ path: "docs/complete-export.png", fullPage: true });
  }
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.__LSP__HOST__ = true;
    const section = {
      id: 2,
      uuid: "22222222-2222-2222-2222-222222222222",
      title: "Embedded section",
      page: { id: 1 },
      children: [
        {
          id: 4,
          uuid: "44444444-4444-4444-4444-444444444444",
          title: "Nested referenced content",
          children: [],
        },
      ],
    };
    const query = {
      id: 3,
      uuid: "33333333-3333-3333-3333-333333333333",
      title: "Query collection",
      page: { id: 1 },
      children: [],
    };
    const root = {
      id: 1,
      uuid: "11111111-1111-1111-1111-111111111111",
      title: "Collected Page",
      name: "collected page",
      type: "page",
    };
    const blocks = [section, query, ...section.children];
    w.logseq = {
      baseInfo: { id: "complete-export" },
      resolveResourceFullUrl: (path: string) => {
        if (path !== "dist/export-colors.js")
          throw new Error("Helper must resolve from the plugin package root");
        return "/export-colors.js";
      },
      _execCallableAPIAsync: async () => {
        if (window.parent !== window) return;
        const frame = document.createElement("iframe");
        frame.id = "complete-export_iframe";
        frame.hidden = true;
        Object.defineProperty(frame, "contentWindow", { value: window });
        document.body.append(frame);
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "/export-colors.js";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Host helper did not load"));
          document.head.append(script);
        });
      },
      settings: { exportOptions: { expandPages: true } },
      ready: async (fn: any) => fn(),
      updateSettings: () => {},
      setMainUIInlineStyle: (style: any) => {
        document.body.style.width = style.width;
      },
      showMainUI: () => {},
      hideMainUI: () => {},
      provideModel: (model: any) => {
        w.exportModel = model;
      },
      UI: {
        resolveThemeCssPropsVals: async () => ({
          "--ls-primary-text-color": "rgb(180, 140, 100)",
        }),
      },
      App: {
        registerUIItem: (_type: string, item: any) => {
          w.toolbarTemplate = item.template;
        },
        registerCommandPalette: () => {},
        registerPageMenuItem: () => {},
        getCurrentGraph: async () => ({ name: "Test Graph" }),
        checkCurrentIsDbGraph: async () => true,
        getCurrentGraphConfigs: async () => ({}),
      },
      Editor: {
        getPageLinkedReferences: () => {
          throw new Error("Backlink panels must not be exported");
        },
        getPageUnlinkedReferences: () => {
          throw new Error("Unlinked reference panels must not be exported");
        },
        registerBlockContextMenuItem: () => {},
        getCurrentPage: async () => root,
        getAllPages: async () => [root],
        getPage: async (id: any) => {
          if (typeof id === "object")
            throw new Error("DB 2.0.1 does not accept object page identities");
          return id === 1 || id === root.name || id === root.uuid
            ? root
            : (blocks.find((b) => b.id === id || b.uuid === id) ?? null);
        },
        getPageBlocksTree: async (id: any) => {
          if (id !== root.uuid)
            throw new Error("Expected the page UUID string for the tree");
          return [
            {
              id: 5,
              uuid: "55555555-5555-5555-5555-555555555555",
              title: `{{embed [[${section.uuid}]]}}`,
              children: [],
            },
            query,
          ];
        },
        getBlock: async (id: any) =>
          blocks.find((b) => b.id === id || b.uuid === id),
        getPageProperties: async (id: any) => {
          if (typeof id === "object")
            throw new Error("Expected scalar page properties identity");
          return {};
        },
        getBlockProperties: async () => ({}),
      },
      DB: {
        datascriptQuery: async (q: string) =>
          q.includes(":block/link")
            ? []
            : q.includes(":find ?b ?title")
              ? [
                  [
                    3,
                    '{:query [:find (pull ?b [*]) :where [?b :block/title "Nested referenced content"]]}',
                  ],
                ]
              : [[{ id: 4 }]],
        q: async () => [{ id: 4 }],
      },
      Assets: { makeUrl: async (s: string) => s },
    };
  });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).exportModel);
  await page.evaluate(() => (window as any).exportModel.openExporter());
  await expect(page.locator("#export")).toBeVisible();
});
test("toolbar icon stays centered within the host button", async ({ page }) => {
  await expect(page.locator("#pages")).toHaveCount(0);
  const dimensions = await page.evaluate(() => {
    const host = document.createElement("div");
    host.style.cssText =
      "font-size:40px;line-height:50px;height:28px;overflow:hidden";
    host.innerHTML = (window as any).toolbarTemplate;
    document.body.append(host);
    const button = host.querySelector("a")!.getBoundingClientRect();
    const icon = host.querySelector("svg")!.getBoundingClientRect();
    return {
      buttonHeight: button.height,
      iconHeight: icon.height,
      top: icon.top - button.top,
      bottom: button.bottom - icon.bottom,
    };
  });
  expect(dimensions).toEqual({
    buttonHeight: 28,
    iconHeight: 18,
    top: 5,
    bottom: 5,
  });
});

test("whole-page DB embed omitted by the SDK tree exports in every format", async ({
  page,
}) => {
  await page.evaluate(() => {
    const ls = (window as any).logseq;
    const embedded = {
      id: 20,
      uuid: "embedded-page",
      title: "Embedded workshop",
    };
    const oldPage = ls.Editor.getPage;
    const oldQuery = ls.DB.datascriptQuery;
    ls.Editor.getBlock = async () => embedded;
    ls.Editor.getPage = async (id: any) =>
      id === embedded.uuid || id === 20 ? embedded : oldPage(id);
    ls.Editor.getPageBlocksTree = async () => [];
    ls.DB.datascriptQuery = async (query: string, parents?: string) =>
      query.includes(":logseq.class/Page")
        ? [[20, embedded.uuid]]
        : query.includes("(pull ?b") && query.includes(":in $ [?parent")
          ? parents === "[20]"
            ? [
                [
                  {
                    id: 21,
                    uuid: "inside",
                    title: "Whole page content",
                    parent: { id: 20 },
                  },
                ],
              ]
            : parents === "[1]"
              ? [[{ id: 10, uuid: "page-alias", title: "", parent: { id: 1 } }]]
              : []
          : query.includes(":find ?b ?target")
            ? [[10, 20]]
            : oldQuery(query);
  });
  await page.locator("#preview").click();
  await expect(
    page.frameLocator("#previewFrame").getByText("Whole page content"),
  ).toHaveCount(1);
  for (const format of ["docx", "pdf", "html", "markdown", "json"]) {
    await page.locator("#format").selectOption(format);
    const extension = format === "markdown" ? "md" : format;
    const download = page.waitForEvent("download", {
      predicate: (d) => d.suggestedFilename().endsWith(`.${extension}`),
    });
    await page.locator("#export").click();
    const file = await download;
    await expect(page.locator("#status")).toHaveText("Export created.");
    if (["html", "markdown", "json"].includes(format))
      expect(await readFile((await file.path())!, "utf8")).toContain(
        "Whole page content",
      );
  }
});

test("theme class colors work across an inaccessible host iframe boundary", async ({
  page,
}) => {
  const hostUrl = new URL("/color-host", page.url());
  const childUrl = new URL("/", hostUrl);
  childUrl.hostname = "export-child.test";
  await page.route("http://export-child.test:47813/**", async (route) => {
    const url = new URL(route.request().url());
    url.hostname = hostUrl.hostname;
    const response = await route.fetch({ url: url.href });
    await route.fulfill({ response });
  });
  await page.route("**/color-host", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<style>.grey{color:rgb(128,128,128)}</style><script src="/export-colors.js" data-ref="marketplace-export"></script><iframe id="marketplace-export_iframe" src="${childUrl.href}" style="width:800px;height:900px"></iframe>`,
    }),
  );
  await page.goto(hostUrl.href);
  const frame = page.frameLocator("#marketplace-export_iframe");
  await expect(frame.locator("#app")).toBeAttached();
  const child = page.frames().find((f) => f.url() === childUrl.href)!;
  await child.waitForFunction(() => !!(window as any).exportModel);
  await child.evaluate(() => {
    let blocked = false;
    try {
      void parent.document;
    } catch {
      blocked = true;
    }
    if (!blocked) throw new Error("The test must exercise a cross-origin host");
    const ls = (window as any).logseq;
    ls.Editor.getPageBlocksTree = async () => [
      {
        uuid: "color",
        title: "<span class='grey'>Class-colored sample</span>",
        children: [],
      },
    ];
    (window as any).exportModel.openExporter();
  });
  await frame.locator("#preview").click();
  await expect(frame.locator("#status")).toHaveText("Preview ready.");
  await expect(frame.locator("#warnings")).toBeEmpty();
  await expect(
    frame.frameLocator("#previewFrame").locator("span.grey"),
  ).toHaveCSS("color", "rgb(96, 96, 96)");
  await expect(frame.locator("#warnings")).toBeEmpty();
  for (const format of ["docx", "pdf", "html"]) {
    await frame.locator("#format").selectOption(format);
    const downloaded = page.waitForEvent("download");
    await frame.locator("#export").click();
    const file = await downloaded;
    await expect(frame.locator("#status")).toHaveText("Export created.");
    if (format === "docx")
      expect(
        strFromU8(
          unzipSync(await readFile((await file.path())!))["word/document.xml"],
        ),
      ).toContain('w:val="606060"');
    if (format === "html")
      expect(await readFile((await file.path())!, "utf8")).toContain(
        "rgb(96, 96, 96)",
      );
  }
});

test("large embedded page between two blocks retains both tables and the next embed", async ({
  page,
}) => {
  await page.evaluate(() => {
    const ls = (window as any).logseq;
    const root = { id: 1, uuid: "root", title: "Assembly", name: "assembly" };
    const heavy = {
      id: 20,
      uuid: "large-page",
      title: "Large embedded page",
      type: "page",
    };
    const other = {
      id: 30,
      uuid: "other-page",
      title: "Other embedded page",
      type: "page",
    };
    const table = (n: number) =>
      "| Item | Value |\n| --- | --- |\n" +
      Array.from(
        { length: n },
        (_, i) => `| Row ${i + 1} | Value ${i + 1} |`,
      ).join("\n");
    const records = [
      {
        id: 2,
        uuid: "before",
        title: "Plain-text section label",
        parent: { id: 1 },
        order: "a",
      },
      { id: 10, uuid: "heavy-alias", title: "", parent: { id: 2 }, order: "b" },
      { id: 11, uuid: "other-alias", title: "", parent: { id: 1 }, order: "c" },
      {
        id: 12,
        uuid: "after",
        title: "After the embeds",
        parent: { id: 1 },
        order: "d",
      },
      {
        id: 26,
        uuid: "first-row",
        title: "First embedded row",
        parent: { id: 20 },
        order: "a",
      },
      {
        id: 25,
        uuid: "blank-intermediate",
        title: "",
        parent: { id: 20 },
        order: "b",
      },
      {
        id: 21,
        uuid: "branch-a",
        title: "First branch \u{1F4CC}",
        parent: { id: 20 },
        order: "c",
      },
      {
        id: 22,
        uuid: "branch-b",
        title: "Second branch \u{1F4CC}",
        parent: { id: 20 },
        order: "d",
      },
      { id: 23, uuid: "large-table", title: table(118), parent: { id: 21 } },
      { id: 24, uuid: "small-table", title: table(5), parent: { id: 22 } },
      {
        id: 31,
        uuid: "other-content",
        title: "Other page content",
        parent: { id: 30 },
      },
    ];
    ls.Editor.getCurrentPage = async () => root;
    ls.Editor.getAllPages = async () => [root];
    ls.Editor.getPage = async (id: any) =>
      [root, heavy, other].find((p) => p.id === id || p.uuid === id);
    ls.Editor.getBlock = async (id: any, options: any) => {
      const target = [heavy, other].find((p) => p.id === id || p.uuid === id);
      if (!target || !options?.includeChildren) return target;
      // Match Logseq's expanded-page SDK response: the first child, not the root.
      return records.find((row) => row.parent.id === target.id);
    };
    ls.Editor.getPageBlocksTree = async () => [];
    ls.DB.datascriptQuery = async (q: string, input?: any) => {
      if (q.includes(":logseq.class/Page"))
        return [
          [20, heavy.uuid],
          [30, other.uuid],
        ];
      if (q.includes(":find ?b ?target"))
        return [
          [10, 20],
          [11, 30],
        ];
      if (q.includes(":in $ [?parent")) {
        const parents = String(input).slice(1, -1).split(" ").map(Number);
        return records
          .filter((r) => parents.includes(r.parent.id))
          .map((r) => [r]);
      }
      if (q.includes(":in $ ?page")) {
        const parents = input === 20 ? [20, 21, 22] : [input];
        return records
          .filter((r) => parents.includes(r.parent.id))
          .map((r) => [r]);
      }
      return [];
    };
  });
  await page.locator("#preview").click();
  await expect(page.locator("#status")).toHaveText("Preview ready.");
  await expect(
    page.frameLocator("#previewFrame").locator("tbody tr"),
  ).toHaveCount(123);
  await expect(page.locator("#integrationDetails")).toContainText(
    "page; direct children: 4",
  );
  await expect(page.locator("#integrationDetails")).not.toContainText(
    "Large embedded page",
  );
  await expect(page.locator("#integrationDetails")).not.toContainText(
    "large-page",
  );
  await expect(
    page.frameLocator("#previewFrame").getByText("Other page content"),
  ).toHaveCount(1);
  await expect(
    page.frameLocator("#previewFrame").getByText("After the embeds"),
  ).toHaveCount(1);
  for (const format of ["docx", "pdf", "html", "markdown", "json"]) {
    await page.locator("#format").selectOption(format);
    const downloaded = page.waitForEvent("download");
    await page.locator("#export").click();
    const file = await downloaded;
    await expect(page.locator("#status")).toHaveText("Export created.");
    if (["html", "markdown", "json"].includes(format))
      expect(await readFile((await file.path())!, "utf8")).toContain("Row 118");
  }
});

test("explicit span colors, alpha colors and CSS variables survive preview and export", async ({
  page,
}) => {
  await page.evaluate(() => {
    const ls = (window as any).logseq;
    const loadHelper = ls._execCallableAPIAsync;
    let attempts = 0;
    ls._execCallableAPIAsync = async (...args: any[]) => {
      if (++attempts === 1) throw new Error("Synthetic startup failure");
      return loadHelper(...args);
    };
    ls.UI.resolveThemeCssPropsVals = async () => ({
      "--demo-accent": "#008000",
      "--ls-primary-text-color": "rgb(180, 140, 100)",
    });
    const style = document.createElement("style");
    style.textContent =
      ".grey { color: rgb(128, 128, 128); } mark.orange { background-color: rgb(255, 180, 90); color: inherit; }";
    document.head.append(style);
    ls.Editor.getPageBlocksTree = async () => [
      {
        uuid: "colors",
        title:
          '<span id="red" style="color:red">Red text</span> <span id="alpha" style="color:rgba(255,0,0,.5)">Alpha text</span> <span id="theme" style="color:rgb(180,140,100)">Explicit theme text</span> <span id="variable" style="color:var(--demo-accent)">Variable text</span> <span id="class-color" class="grey">Class-colored text</span> <mark>Marked text</mark>',
        children: [
          {
            uuid: "highlight",
            title: "<mark class='orange'>Highlighted **bold** text</mark>",
            children: [],
          },
        ],
      },
    ];
  });
  await page.locator("#preview").click();
  await expect(
    page.frameLocator("#previewFrame").locator("mark.orange"),
  ).toHaveCSS("background-color", "rgb(255, 180, 90)");
  await expect(page.frameLocator("#previewFrame").locator("#red")).toHaveCSS(
    "color",
    "rgb(191, 0, 0)",
  );
  await expect(page.locator("#warnings")).toBeEmpty();
  await expect(
    page.frameLocator("#previewFrame").locator("#class-color"),
  ).toHaveCSS("color", "rgb(96, 96, 96)");
  await expect(page.frameLocator("#previewFrame").locator("#theme")).toHaveCSS(
    "color",
    "rgb(135, 105, 75)",
  );
  await expect(
    page.frameLocator("#previewFrame").locator("#variable"),
  ).toHaveCSS("color", "rgb(0, 96, 0)");
  await expect(
    page.frameLocator("#previewFrame").locator("#alpha"),
  ).not.toHaveCSS("color", "rgb(0, 0, 0)");
  for (const format of ["docx", "pdf", "html"]) {
    await page.locator("#format").selectOption(format);
    const download = page.waitForEvent("download");
    await page.locator("#export").click();
    const file = await download;
    await mkdir("qa-results/colors", { recursive: true });
    await file.saveAs(`qa-results/colors/Colors.${format}`);
    if (format === "docx") {
      const entries = unzipSync(await readFile((await file.path())!));
      expect(strFromU8(entries["word/document.xml"])).toContain(
        'w:val="606060"',
      );
      expect(strFromU8(entries["word/document.xml"])).toContain(
        'w:fill="ffb45a"',
      );
    }
    if (format === "pdf") {
      const { getDocument, OPS } =
        await import("pdfjs-dist/legacy/build/pdf.mjs");
      const loading = getDocument({
        data: new Uint8Array(await readFile((await file.path())!)),
      });
      const pdf = await loading.promise;
      const ops = await (await pdf.getPage(1)).getOperatorList();
      const fills = ops.argsArray
        .filter((_, i) => ops.fnArray[i] === OPS.setFillRGBColor)
        .flat();
      expect(fills).toContain("#ffff00");
      expect(fills).toContain("#ffb45a");
      await loading.destroy();
    }
    if (format === "html")
      expect(await readFile((await file.path())!, "utf8")).toContain(
        "rgb(96, 96, 96)",
      );
    await expect(page.locator("#status")).toHaveText("Export created.");
  }
});

test("pinned blocks and paragraph table cells remain formatted", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).logseq.Editor.getPageBlocksTree = async () => [
      {
        uuid: "pinned",
        title: "#+BEGIN_PINNED\nKeep **this note**\n#+END_PINNED",
        children: [],
      },
      {
        uuid: "paragraph-table",
        title:
          "| Control | Detail |\n| --- | --- |\n| A | <p>First\nparagraph</p><p>Second<br>line</p> |\n| B | Last |",
        children: [],
      },
    ];
  });
  await page.locator("#preview").click();
  const preview = page.frameLocator("#previewFrame");
  await expect(preview.locator(".pinned-icon")).toHaveCount(1);
  await expect(preview.locator("table tbody tr")).toHaveCount(2);
  await expect(preview.locator("body")).not.toContainText("BEGIN_PINNED");
  for (const format of ["docx", "pdf", "html"]) {
    await page.locator("#format").selectOption(format);
    const downloaded = page.waitForEvent("download");
    await page.locator("#export").click();
    const file = await downloaded;
    await mkdir("qa-results/pinned", { recursive: true });
    await file.saveAs(`qa-results/pinned/Pinned.${format}`);
    if (format === "docx") {
      const entries = unzipSync(await readFile((await file.path())!));
      const xml = strFromU8(entries["word/document.xml"]);
      expect(xml).toContain("<w:tbl>");
      expect(xml).toContain("<w:drawing>");
      expect(xml).not.toContain("BEGIN_PINNED");
    }
    await expect(page.locator("#status")).toHaveText("Export created.");
  }
});

test("separator-free six-column tables export as real tables", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).logseq.Editor.getPageBlocksTree = async () => [
      {
        uuid: "separator-free",
        title:
          "| Item | Category | Owner | State | Next step | Notes |\n| A | Supplies | Team | Ready | Review | <p>First<br>second</p> |\n| B | Tools | Group | Waiting | Check | <p>Another\nparagraph</p> |",
        children: [],
      },
    ];
  });
  await page.locator("#preview").click();
  const preview = page.frameLocator("#previewFrame");
  await expect(preview.locator("table th")).toHaveCount(6);
  await expect(preview.locator("table td")).toHaveCount(12);
  await mkdir("qa-results/tables", { recursive: true });
  await preview
    .locator("body")
    .screenshot({ path: "qa-results/tables/preview.png" });
  for (const format of ["docx", "pdf", "html", "markdown"]) {
    await page.locator("#format").selectOption(format);
    const downloaded = page.waitForEvent("download");
    await page.locator("#export").click();
    const file = await downloaded;
    await file.saveAs(
      `qa-results/tables/Table.${format === "markdown" ? "md" : format}`,
    );
    const bytes = await readFile((await file.path())!);
    if (format === "docx") {
      const xml = strFromU8(unzipSync(bytes)["word/document.xml"]);
      expect(xml.match(/<w:tbl>/g)).toHaveLength(1);
      expect(xml.match(/<w:tr>/g)).toHaveLength(3);
      expect(xml.match(/<w:tc>/g)).toHaveLength(18);
    }
    if (format === "html") expect(bytes.toString()).toContain("<table>");
    if (format === "markdown")
      expect(bytes.toString()).toContain(
        "| --- | --- | --- | --- | --- | --- |",
      );
    await expect(page.locator("#status")).toHaveText("Export created.");
  }
});

test("deep embedded outlines keep indenting and narrow columns share less width", async ({
  page,
}) => {
  await page.evaluate(() => {
    const ls = (window as any).logseq;
    let nested: any = {
      id: 80,
      uuid: "deep-table",
      title:
        "| ID | State | Notes |\n| 1 | Ready | A longer explanation of the next steps for the team. |",
      children: [],
    };
    for (let i = 8; i >= 1; i--)
      nested = {
        id: 60 + i,
        uuid: `layer-${i}`,
        title: `Tier ${i}`,
        children: [nested],
      };
    ls.Editor.getBlock = async () => nested;
    ls.Editor.getPageBlocksTree = async () => [
      { id: 50, uuid: "outline-wrapper", title: "", children: [] },
    ];
    const oldQuery = ls.DB.datascriptQuery;
    ls.DB.datascriptQuery = async (q: string) =>
      q.includes(":find ?b ?target") ? [[50, 60]] : oldQuery(q);
  });
  await page.locator("#preview").click();
  const frame = page.frameLocator("#previewFrame");
  let previous = -1;
  for (let i = 2; i <= 8; i++) {
    const bounds = await frame.locator(`#b-layer-${i} > summary`).boundingBox();
    expect(bounds!.x).toBeGreaterThan(previous);
    previous = bounds!.x;
  }
  const widths = await frame
    .locator("col")
    .evaluateAll((elements) =>
      elements.map((el) => parseFloat((el as HTMLElement).style.width)),
    );
  expect(widths[0]).toBeLessThan(widths[2] / 3);
  await mkdir("qa-results/deep-outline", { recursive: true });
  for (const format of ["docx", "pdf", "html"]) {
    await page.locator("#format").selectOption(format);
    const downloaded = page.waitForEvent("download");
    await page.locator("#export").click();
    const file = await downloaded;
    await file.saveAs(`qa-results/deep-outline/Outline.${format}`);
    const bytes = await readFile((await file.path())!);
    if (format === "docx") {
      const xml = strFromU8(unzipSync(bytes)["word/document.xml"]);
      let previousIndent = -1;
      for (let i = 2; i <= 8; i++) {
        const paragraph = xml
          .match(/<w:p[ >][\s\S]*?<\/w:p>/g)!
          .find((p) => p.includes(`Tier ${i}`))!;
        const indent = Number(paragraph.match(/w:left="(\d+)"/)![1]);
        expect(indent).toBeGreaterThan(previousIndent);
        previousIndent = indent;
      }
    }
    if (format === "pdf") {
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const loading = getDocument({ data: new Uint8Array(bytes) });
      const pdf = await loading.promise;
      const text = await (await pdf.getPage(1)).getTextContent();
      let x = -1;
      for (let i = 2; i <= 8; i++) {
        const item: any = text.items.find((t: any) => t.str === `Tier ${i}`);
        expect(item.transform[4]).toBeGreaterThan(x);
        x = item.transform[4];
      }
      await loading.destroy();
    }
    await expect(page.locator("#status")).toHaveText("Export created.");
  }
});

test("header words fit narrow columns without wasting short-column space", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).logseq.Editor.getPageBlocksTree = async () => [
      {
        uuid: "header-table",
        title:
          "| Record # | Task description | Policy alignment | Delivery<br>Readiness | Implementation notes |\n| 1 | Review a draft | Yes | Possible | " +
          "Several steps need explanation. ".repeat(15) +
          " |",
        children: [],
      },
    ];
  });
  await page.locator("#preview").click();
  const frame = page.frameLocator("#previewFrame");
  const metrics = await frame.locator("table").evaluate((table) => {
    const cells = Array.from(table.querySelectorAll("th"));
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = getComputedStyle(cells[0]).font;
    return {
      first: cells[0].getBoundingClientRect().width,
      record: ctx.measureText("Record").width,
      delivery: cells[3].getBoundingClientRect().width,
      notes: cells[4].getBoundingClientRect().width,
    };
  });
  expect(metrics.first).toBeGreaterThan(metrics.record + 12);
  expect(metrics.delivery).toBeLessThan(metrics.notes);
  await mkdir("qa-results/header-widths", { recursive: true });
  for (const format of ["docx", "pdf", "html"]) {
    await page.locator("#format").selectOption(format);
    const downloaded = page.waitForEvent("download");
    await page.locator("#export").click();
    const file = await downloaded;
    await file.saveAs(`qa-results/header-widths/Headers.${format}`);
    if (format === "pdf") {
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const loading = getDocument({
        data: new Uint8Array(await readFile((await file.path())!)),
      });
      const pdf = await loading.promise;
      const text = await (await pdf.getPage(1)).getTextContent();
      expect(
        text.items.some((item: any) => /\bRecord\b/.test(item.str || "")),
      ).toBeTruthy();
      await loading.destroy();
    }
    await expect(page.locator("#status")).toHaveText("Export created.");
  }
});

for (const paper of ["LETTER", "A4"] as const) {
  test(`multipage indented PDF tables and paragraphs stay inside the right margin (${paper})`, async ({
    page,
  }) => {
    await page.evaluate(() => {
      const ls = (window as any).logseq;
      const prose =
        "Review the next steps with the group and record the outcome. ";
      const table =
        "| Record # | Task | Status | Details |\n" +
        Array.from(
          { length: 52 },
          (_, i) => `| ${i + 1} | Review item | Ready | ${prose.repeat(5)} |`,
        ).join("\n");
      let nested: any = {
        id: 80,
        uuid: "pdf-fit-section",
        title: "Collected details",
        children: [
          { uuid: "pdf-first-table", title: table, children: [] },
          { uuid: "pdf-long-text", title: prose.repeat(180), children: [] },
          { uuid: "pdf-last-table", title: table, children: [] },
          {
            uuid: "pdf-ending",
            title: prose.repeat(100) + "End of collection.",
            children: [],
          },
        ],
      };
      for (let i = 6; i >= 1; i--)
        nested = {
          id: 60 + i,
          uuid: `pdf-layer-${i}`,
          title: `Tier ${i}`,
          children: [nested],
        };
      ls.Editor.getBlock = async () => nested;
      ls.Editor.getPageBlocksTree = async () => [
        { id: 50, uuid: "pdf-fit-wrapper", title: "", children: [] },
      ];
      const oldQuery = ls.DB.datascriptQuery;
      ls.DB.datascriptQuery = async (q: string) =>
        q.includes(":find ?b ?target") ? [[50, 60]] : oldQuery(q);
    });
    await page.locator("#paper").selectOption(paper);
    if (paper === "A4") {
      await page.locator("#margin0").fill("0.6");
      await page.locator("#margin2").fill("1.1");
    }
    await page.locator("#format").selectOption("pdf");
    const downloaded = page.waitForEvent("download");
    await page.locator("#export").click();
    const file = await downloaded;
    await mkdir("qa-results/pdf-fit", { recursive: true });
    await file.saveAs(
      `qa-results/pdf-fit/Multipage${paper === "A4" ? "-A4" : ""}.pdf`,
    );
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = getDocument({
      data: new Uint8Array(await readFile((await file.path())!)),
    });
    const pdf = await loading.promise;
    expect(pdf.numPages).toBeGreaterThan(3);
    const overflow: string[] = [];
    const allText: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const sheet = await pdf.getPage(i);
      const right =
        sheet.getViewport({ scale: 1 }).width -
        (paper === "A4" ? 1.1 : 0.35) * 72;
      const text = await sheet.getTextContent();
      for (const item of text.items as any[]) {
        if (item.str) allText.push(item.str);
        if (item.str?.trim() && item.transform[4] + item.width > right + 1)
          overflow.push(`Page ${i}: right=${item.transform[4] + item.width}`);
      }
    }
    await loading.destroy();
    expect(allText.join(" ")).toContain("End of collection.");
    expect(overflow).toEqual([]);
  });
}

test("rich synthetic exports are readable and safely packaged in all five formats", async ({
  page,
}) => {
  await page.evaluate(() => {
    const ls = (window as any).logseq;
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 160;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#d6f1e4";
    ctx.fillRect(0, 0, 300, 160);
    ctx.fillStyle = "#27634c";
    ctx.fillRect(20, 90, 70, 50);
    ctx.fillStyle = "#b44444";
    ctx.fillRect(110, 60, 70, 80);
    ctx.fillStyle = "#181b20";
    ctx.font = "18px Arial";
    ctx.fillText("Synthetic image", 20, 30);
    const picture = canvas.toDataURL("image/png");
    const blocks = [
      {
        id: 101,
        uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        title:
          "Imported\u0001 notes with [[cccccccc-cccc-cccc-cccc-cccccccccccc]] and [a website](https://example.com)",
        children: [],
      },
      {
        id: 102,
        uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        title:
          "| Item | Detail |\n| --- | --- |\n| Paper | Several sheets |\n| Tools | A shared set |",
        children: [],
      },
      {
        id: 103,
        uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        title: "Referenced detail #Workshop",
        children: [],
      },
      {
        id: 104,
        uuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        title: `<figure><img src="${picture}" width="250" alt="Synthetic image"><figcaption>Synthetic image</figcaption></figure>`,
        children: [],
      },
      {
        id: 105,
        uuid: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        title: `<img src="${picture}" width="-200" alt="Another synthetic image">`,
        children: [],
      },
    ];
    const oldPage = ls.Editor.getPage;
    ls.Editor.getPage = async (id: any) =>
      blocks.find((b) => b.uuid === id || b.id === id) ?? oldPage(id);
    ls.Editor.getBlock = async (id: any) =>
      blocks.find((b) => b.uuid === id || b.id === id);
    ls.Editor.getPageBlocksTree = async () => blocks;
    ls.Editor.getBlockProperties = async () => ({
      ":block/tags": ["Workshop"],
    });
  });
  await mkdir("qa-results/safety", { recursive: true });
  for (const format of ["docx", "pdf", "html", "markdown", "json"]) {
    const extension = format === "markdown" ? "md" : format;
    await page.locator("#format").selectOption(format);
    const download = page.waitForEvent("download", {
      predicate: (d) => d.suggestedFilename().endsWith(`.${extension}`),
    });
    await page.locator("#export").click();
    const file = await download;
    await file.saveAs(`qa-results/safety/Export.${extension}`);
    await expect(page.locator("#status")).toHaveText(
      "Export created with notices.",
    );
    await expect(page.locator("#warnings")).not.toContainText(
      "Image could not be embedded",
    );
    if (["html", "markdown", "json"].includes(format)) {
      const output = await readFile((await file.path())!, "utf8");
      expect(output).toContain("Referenced detail");
      expect(output).not.toContain("\u0001");
      if (format !== "json") expect(output).toContain("data:image/png;base64,");
    }
  }
});
test("hidden DB linked node preserves its title and outline in preview", async ({
  page,
}) => {
  await page.evaluate(() => {
    const ls = (window as any).logseq;
    const oldQuery = ls.DB.datascriptQuery;
    ls.DB.datascriptQuery = (q: string) =>
      q.includes(":find ?b ?target") ? [[5, 2]] : oldQuery(q);
    ls.Editor.getPageBlocksTree = async () => [
      { id: 5, uuid: "alias", title: "", children: [] },
    ];
  });
  await page.locator("#preview").click();
  await expect(page.locator("#status")).toHaveText("Preview ready.");
  await expect(
    page.frameLocator("#previewFrame").locator(".embed-title"),
  ).toHaveText("\u2192 Collected Page");
  await expect(
    page.frameLocator("#previewFrame").getByText("Nested referenced content"),
  ).toHaveCount(1);
});
test("DB image decodes in detached preview and downloaded HTML", async ({
  page,
}) => {
  await page.evaluate(() => {
    const ls = (window as any).logseq;
    ls.Editor.getPageBlocksTree = async () => [
      { id: 90, uuid: "image", title: "Picture" },
    ];
    ls.Editor.getBlockProperties = async () => ({
      ":logseq.property.asset/type": "png",
    });
    ls.Assets.makeUrl = async () =>
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=";
  });
  await page.locator("#preview").click();
  await expect(page.locator("#status")).toHaveText("Preview ready.");
  await expect(page.locator("#warnings")).toBeEmpty();
  await expect(
    page.frameLocator("#previewFrame").locator("img"),
  ).toHaveAttribute("src", /^data:image\/png;base64,/);
  await page.locator("#format").selectOption("html");
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const html = await readFile((await (await download).path())!, "utf8");
  expect(html).toContain("data:image/png;base64,");
  expect(html).not.toContain("Image unavailable");
  await page.locator("#format").selectOption("markdown");
  const markdownDownload = page.waitForEvent("download");
  await page.locator("#export").click();
  const markdown = await readFile(
    (await (await markdownDownload).path())!,
    "utf8",
  );
  expect(markdown).toContain("data:image/png;base64,");
  expect(markdown).toContain("<figcaption>Picture</figcaption>");
  expect(markdown).not.toContain("../assets/");
});

test("oversized image headers are rejected before decoding in document formats", async ({
  page,
}) => {
  await page.evaluate(() => {
    const ls = (window as any).logseq;
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    );
    new DataView(bytes.buffer).setUint32(16, 500000);
    const src = "data:image/png;base64," + btoa(String.fromCharCode(...bytes));
    ls.Editor.getPageBlocksTree = async () => [
      {
        uuid: "oversized",
        title: `<img src="${src}" alt="Oversized test image">`,
        children: [],
      },
    ];
    (window as any).imageDecodes = 0;
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      (window as any).imageDecodes++;
      return decode.call(this);
    };
  });
  for (const format of ["docx", "pdf", "html", "markdown"]) {
    await page.locator("#format").selectOption(format);
    const extension = format === "markdown" ? "md" : format;
    const download = page.waitForEvent("download", {
      predicate: (d) => d.suggestedFilename().endsWith(`.${extension}`),
    });
    await page.locator("#export").click();
    await download;
    await expect(page.locator("#warnings")).toContainText("safety limit");
    expect(await page.evaluate(() => (window as any).imageDecodes)).toBe(0);
  }
});
test("export collection with DB UUID embed and property query in every format", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const format of ["docx", "pdf", "html", "markdown", "json"]) {
    await page.locator("#format").selectOption(format);
    const downloaded = page.waitForEvent("download");
    await page.locator("#export").click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toMatch(
      new RegExp(`\\.${format === "markdown" ? "md" : format}$`),
    );
    if (["html", "markdown", "json"].includes(format)) {
      const output = await readFile((await file.path())!, "utf8");
      expect(output).toContain("Nested referenced content");
      expect(output).not.toContain("Missing page:");
    }
    await expect(page.locator("#status")).toHaveText("Export created.");
  }
  expect(errors).toEqual([]);
});
test("a root page lookup failure produces no download and clears the old preview", async ({
  page,
}) => {
  await page.locator("#preview").click();
  await expect(page.locator("#status")).toHaveText("Preview ready.");
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await page.evaluate(() => {
    (window as any).logseq.Editor.getPage = async () => null;
  });
  await page.locator("#export").click();
  await expect(page.locator("#status")).toHaveText(
    /^Export failed: Page not found:/,
  );
  await expect(page.locator("#previewFrame")).toBeHidden();
  expect(downloads).toEqual([]);
});
for (const scope of ["named", "graph"])
  test(`${scope} page collection uses scalar page identities`, async ({
    page,
  }) => {
    await page.locator("#scope").selectOption(scope);
    if (scope === "named") await page.locator("#target").fill("collected page");
    await page.locator("#preview").click();
    await expect(page.locator("#status")).toHaveText("Preview ready.");
    await expect(
      page.frameLocator("#previewFrame").getByText("Nested referenced content"),
    ).toHaveCount(2);
  });
for (const width of [660, 390])
  test(`preview and layout at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.locator("#preview").click();
    await expect(page.locator("#status")).toHaveText("Preview ready.");
    await expect(
      page.frameLocator("#previewFrame").getByText("Nested referenced content"),
    ).toHaveCount(2);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    expect(overflow).toBe(false);
    await page.screenshot({
      path: `test-results/panel-${width}.png`,
      fullPage: true,
    });
    const headerTop = await page
      .locator(".panel > header")
      .evaluate((el) => el.getBoundingClientRect().top);
    await page.locator(".panel-content").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const position = await page.evaluate(() => {
      const header = document
        .querySelector(".panel > header")!
        .getBoundingClientRect();
      const close = document.getElementById("close")!.getBoundingClientRect();
      const scroller = document.querySelector(".panel-content")!;
      return {
        top: header.top,
        bottom: header.bottom,
        closeTop: close.top,
        closeBottom: close.bottom,
        scroll: scroller.scrollTop,
        viewportHeight: innerHeight,
      };
    });
    expect(position.scroll).toBeGreaterThan(0);
    expect(position.top).toBe(headerTop);
    expect(position.closeTop).toBeGreaterThanOrEqual(position.top);
    expect(position.closeBottom).toBeLessThanOrEqual(position.bottom);
    expect(position.bottom).toBeLessThan(position.viewportHeight);
    await page.screenshot({
      path: `test-results/panel-scrolled-${width}.png`,
      fullPage: true,
    });
    await page.evaluate(() => {
      (window as any).closeCalls = 0;
      (window as any).logseq.hideMainUI = () => (window as any).closeCalls++;
    });
    await page.locator("#close").click();
    expect(await page.evaluate(() => (window as any).closeCalls)).toBe(1);
  });
