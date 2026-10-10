import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
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
      settings: {},
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
  });
