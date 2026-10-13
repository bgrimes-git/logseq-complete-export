import "@logseq/libs";
import { createElement, createIcons, X, Eye, Download } from "lucide";
import {
  defaults,
  Resolver,
  escape,
  type Options,
  type DocumentData,
  pageIdentity,
} from "./model";
import {
  exportFile,
  download,
  filename,
  loadImages,
  type Format,
} from "./export";
import { htmlDocument } from "./render";
import "./style.css";
import { Queries } from "./queries";
import { engine } from "./query-runtime";
import { readClassColors } from "./host-colors";
import { readDbPageTree, readDbBlock } from "./db-tree";
import packageInfo from "../package.json";

const app = document.getElementById("app")!;
let context: { block?: string; page?: string } = {};
let busy = false;
let integrationDetails: string[] = [];
let options: Options = { ...defaults, margins: [...defaults.margins] };
async function theme() {
  const colors = await logseq.UI.resolveThemeCssPropsVals([
    "--ls-primary-text-color",
    "--ls-link-text-color",
  ]).catch(() => null);
  if (colors?.["--ls-primary-text-color"])
    options.defaultColor = colors["--ls-primary-text-color"];
  try {
    const doc = parent.document,
      el =
        doc.querySelector<HTMLElement>(".ls-block .block-content") ?? doc.body;
    options.defaultColor = parent.getComputedStyle(el).color;
    const accent = doc.querySelector<HTMLElement>(".page-ref");
    if (accent) {
      const rgb = parent.getComputedStyle(accent).color.match(/\d+/g);
      if (rgb?.length === 3)
        options.accent =
          "#" +
          rgb.map((c) => Number(c).toString(16).padStart(2, "0")).join("");
    }
  } catch {
    /* Export defaults are independent of host theme even without DOM access. */
  }
}
async function open(scope = "page", selected: typeof context = {}) {
  if (busy) {
    logseq.showMainUI();
    return;
  }
  context = selected;
  await theme();
  app.innerHTML = `<div class="panel"><header><h1>Complete Export</h1><button id="close" class="icon" title="Close"><i data-lucide="x"></i></button></header>
  <form id="form"><div class="fields"><label>Source<select id="scope"><option value="block">Block</option><option value="branch">Branch</option><option value="page">Current page</option><option value="named">Named page</option><option value="graph">Entire graph</option></select></label><label>Format<select id="format"><option value="docx">Word (.docx)</option><option value="pdf">PDF (.pdf)</option><option value="html">Interactive HTML (.html)</option><option value="markdown">Markdown (.md)</option><option value="json">Structured JSON (.json)</option></select></label></div>
  <label id="targetLabel">Page name<input id="target" value="${escape(selected.page ?? "")}" autocomplete="off"></label>
  <fieldset><legend>Content</legend><label class="check"><input id="refs" type="checkbox" ${options.expandRefs ? "checked" : ""}>Include referenced block branches</label><label class="check"><input id="props" type="checkbox" ${options.properties ? "checked" : ""}>Include properties</label></fieldset>
  <fieldset><legend>Document</legend><div class="fields"><label>Paper<select id="paper"><option value="LETTER">US Letter</option><option value="A4">A4</option></select></label><label>Accent color<input id="accent" type="color" value="${options.accent}"></label></div><div class="margins">${["Left", "Top", "Right", "Bottom"].map((name, i) => `<label>${name} (in)<input id="margin${i}" type="number" min="0" max="2" step="0.05" value="${options.margins[i]}"></label>`).join("")}</div><label>Darken accent colors <output id="percent">${options.darken}%</output><input id="darken" type="range" min="0" max="100" value="${options.darken}"></label></fieldset>
  <footer><button type="button" id="preview"><i data-lucide="eye"></i>Preview</button><button type="submit" id="export"><i data-lucide="download"></i>Export</button></footer></form><p id="status" role="status"></p><ul id="warnings"></ul><details id="integration" hidden><summary>Integration details</summary><pre id="integrationDetails"></pre></details><iframe id="previewFrame" title="Export preview" sandbox="allow-same-origin" hidden></iframe></div>`;
  createIcons({ icons: { X, Eye, Download } });
  const source = document.getElementById("scope") as HTMLSelectElement;
  source.value = scope;
  (document.getElementById("paper") as HTMLSelectElement).value = options.paper;
  function changeScope() {
    const label = document.getElementById("targetLabel")!;
    label.hidden = !["named", "block", "branch"].includes(source.value);
    label.firstChild!.textContent =
      source.value === "named"
        ? "Page name"
        : "Block UUID (blank uses selected block)";
    if (source.value === "block" || source.value === "branch")
      (document.getElementById("target") as HTMLInputElement).value =
        context.block ?? "";
  }
  source.onchange = changeScope;
  changeScope();
  document.getElementById("close")!.onclick = () => logseq.hideMainUI();
  document.getElementById("darken")!.oninput = (e) => {
    document.getElementById("percent")!.textContent =
      (e.target as HTMLInputElement).value + "%";
  };
  document.getElementById("preview")!.onclick = () => void run(true);
  (document.getElementById("form") as HTMLFormElement).onsubmit = (e) => {
    e.preventDefault();
    void run(false);
  };
  logseq.showMainUI({ autoFocus: true });
}
function readOptions(): Options {
  const value = (id: string) =>
    (document.getElementById(id) as HTMLInputElement).value;
  const checked = (id: string) =>
    (document.getElementById(id) as HTMLInputElement).checked;
  return {
    ...options,
    expandRefs: checked("refs"),
    expandPages: false,
    properties: checked("props"),
    margins: [0, 1, 2, 3].map((i) => Number(value("margin" + i))),
    darken: Number(value("darken")),
    accent: value("accent"),
    paper: value("paper") as Options["paper"],
  };
}
async function collect(): Promise<DocumentData> {
  integrationDetails = [`Plugin: ${packageInfo.version}`];
  const source = (document.getElementById("scope") as HTMLSelectElement).value;
  const target = (
    document.getElementById("target") as HTMLInputElement
  ).value.trim();
  if (!(await logseq.App.checkCurrentIsDbGraph()))
    throw new Error("Open a Logseq DB graph to use Complete Export.");
  const graph = await logseq.App.getCurrentGraph();
  const pages = await logseq.Editor.getAllPages();
  const pageIds = new Set(
    (pages ?? []).flatMap((p) =>
      [p.uuid, p.id].filter((id) => id != null).map(String),
    ),
  );
  const dbPages = await logseq.DB.datascriptQuery(
    "[:find ?page ?uuid :where [?page :block/tags ?tag] (or [?tag :db/ident :logseq.class/Page] [?tag :db/ident :logseq.class/Journal] [?tag :db/ident :logseq.class/Tag] [?tag :db/ident :logseq.class/Property]) [?page :block/uuid ?uuid]]",
  );
  for (const [id, uuid] of dbPages ?? []) {
    if (typeof id === "number") pageIds.add(String(id));
    if (typeof uuid === "string") pageIds.add(uuid);
  }
  const queries = new Queries(logseq, engine);
  await queries.load();
  const links = new Map<number, number>();
  const linkedRows = await logseq.DB.datascriptQuery(
    "[:find ?b ?target :where [?b :block/link ?target]]",
  );
  for (const [id, target] of linkedRows ?? []) links.set(id, target);
  const linkedTitles = new Map<number, string>();
  const titleRows = await logseq.DB.datascriptQuery(
    "[:find ?b ?title :where [?b :block/link ?target] [?target :block/page ?page] [?page :block/title ?title]]",
  );
  for (const [id, title] of titleRows ?? []) linkedTitles.set(id, title);
  const resolver = new Resolver(
    {
      getBlock: (id, opts) => readDbBlock(logseq, id, opts),
      getPage: (id) => logseq.Editor.getPage(id),
      getPageBlocksTree: (id) => readDbPageTree(logseq, id),
      getBlockProperties: (id) => logseq.Editor.getBlockProperties(id),
      getPageProperties: (id) => logseq.Editor.getPageProperties(id),
      isPage: (entity) =>
        [entity.uuid, entity.id].some(
          (id) => id != null && pageIds.has(String(id)),
        ),
      reportEmbed: (kind, children) =>
        integrationDetails.push(
          `Embed ${integrationDetails.filter((line) => line.startsWith("Embed ")).length + 1}: ${kind}; direct children: ${children}`,
        ),
      getLinkedTarget: async (id) => links.get(Number(id)),
      getLinkedTitle: async (id) => linkedTitles.get(Number(id)),
      getAssetWidth: (uuid) => {
        try {
          const img = parent.document
            .getElementById(`ls-block-${uuid}`)
            ?.querySelector("img");
          const width = img?.getBoundingClientRect().width;
          return width && width > 0 ? width : undefined;
        } catch {
          return undefined;
        }
      },
    },
    options,
    queries,
  );
  resolver.graph = graph?.name ?? "";
  let title = "",
    nodes: DocumentData["nodes"] = [];
  if (source === "graph") {
    title = graph?.name ?? "Graph";
    if (!pages) throw new Error("Logseq did not return the graph pages.");
    const visible = pages
      .filter((p) => !["property", "hidden"].includes(p.type))
      .sort((a, b) => (a.title ?? a.name).localeCompare(b.title ?? b.name));
    for (let i = 0; i < visible.length; i++) {
      status(`Reading page ${i + 1} of ${visible.length}...`);
      nodes.push(await resolver.page(pageIdentity(visible[i])));
    }
  } else if (source === "page" || source === "named") {
    const page =
      source === "named"
        ? await logseq.Editor.getPage(target)
        : context.page
          ? await logseq.Editor.getPage(context.page)
          : await logseq.Editor.getCurrentPage();
    if (!page)
      throw new Error("Page not found. Open a page or enter its exact name.");
    const node = await resolver.page(pageIdentity(page));
    title = node.text;
    nodes = [node];
  } else {
    const block = target
      ? await logseq.Editor.getBlock(target, { includeChildren: true })
      : await logseq.Editor.getCurrentBlock();
    if (!block)
      throw new Error(
        "Select a block using its context menu, or enter its UUID.",
      );
    const node = await resolver.block(block, new Set(), source === "branch");
    title = node.text.replace(/\n/g, " ").slice(0, 100) || "Block";
    nodes = [node];
  }
  return {
    title,
    graph: resolver.graph,
    nodes,
    warnings: resolver.warnings,
    created: new Date().toISOString(),
  };
}
function status(message: string) {
  document.getElementById("status")!.textContent = message;
}
async function run(preview: boolean) {
  if (busy) return;
  busy = true;
  const buttons = app.querySelectorAll<HTMLButtonElement>("#preview,#export");
  buttons.forEach((b) => (b.disabled = true));
  let data: DocumentData | undefined;
  try {
    options = readOptions();
    if (options.margins.some((n) => !Number.isFinite(n) || n < 0 || n > 2))
      throw new Error("Margins must be between 0 and 2 inches.");
    logseq.updateSettings({
      exportOptions: options,
      referenceDefaultsVersion: 1,
    });
    status("Resolving content...");
    document.getElementById("warnings")!.innerHTML = "";
    const previousPreview = document.getElementById(
      "previewFrame",
    ) as HTMLIFrameElement;
    previousPreview.hidden = true;
    previousPreview.srcdoc = "";
    data = await collect();
    const variables = new Set<string>();
    const classes = new Set<string>();
    function collectColors(nodes: DocumentData["nodes"]) {
      for (const node of nodes) {
        const parsed = new DOMParser().parseFromString(node.text, "text/html");
        for (const element of parsed.querySelectorAll("span[class]"))
          classes.add(element.className.trim());
        for (const element of parsed.querySelectorAll<HTMLElement>("[style]")) {
          for (const match of element.style.color.matchAll(
            /var\(\s*(--[\w-]+)/g,
          ))
            variables.add(match[1]);
        }
        collectColors(node.children);
      }
    }
    collectColors(data.nodes);
    options.classColors = {};
    try {
      options.classColors = await readClassColors([...classes]);
      integrationDetails.push(
        `Class colors: ${Object.keys(options.classColors).length} resolved / ${classes.size} requested`,
      );
    } catch (error) {
      const code =
        error instanceof Error && /^COLOR_[A-Z_]+$/.test(error.message)
          ? error.message
          : "COLOR_HELPER_UNAVAILABLE";
      integrationDetails.push(`Class colors: ${code}`);
      if (classes.size)
        data.warnings.push(
          `Theme-defined span colors could not be read from Logseq (${code}).`,
        );
    }
    document.getElementById("integration")!.hidden = false;
    document.getElementById("integrationDetails")!.textContent =
      integrationDetails.join("\n");
    options.colorVars =
      (variables.size
        ? await logseq.UI.resolveThemeCssPropsVals([...variables]).catch(
            () => ({}),
          )
        : {}) ?? {};
    if (preview) {
      const frame = document.getElementById(
        "previewFrame",
      ) as HTMLIFrameElement;
      frame.hidden = false;
      const previewDocument = new DOMParser().parseFromString(
        htmlDocument(data, options),
        "text/html",
      );
      await loadImages(previewDocument.body, data, (src) =>
        /^(https?:|data:|assets:)/i.test(src)
          ? src
          : logseq.Assets.makeUrl(src),
      );
      frame.srcdoc = previewDocument.documentElement.outerHTML;
      status("Preview ready.");
    } else {
      status("Creating file...");
      await exportFile(
        data,
        options,
        (document.getElementById("format") as HTMLSelectElement)
          .value as Format,
        (src) =>
          /^(https?:|data:|assets:)/i.test(src)
            ? src
            : logseq.Assets.makeUrl(src),
      );
      status(
        data.warnings.length
          ? "Export created with notices."
          : "Export created.",
      );
      if (data.warnings.length)
        download(
          new Blob([data.warnings.join("\n")], { type: "text/plain" }),
          `${filename(data.title)}-export-notices.txt`,
        );
    }
  } catch (e) {
    status(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    console.error(e);
  } finally {
    if (data)
      document.getElementById("warnings")!.innerHTML = data.warnings
        .map((w) => `<li>${escape(w)}</li>`)
        .join("");
    busy = false;
    buttons.forEach((b) => (b.disabled = false));
  }
}
logseq
  .ready(() => {
    const saved = logseq.settings?.exportOptions;
    if (saved && typeof saved === "object") options = { ...defaults, ...saved };
    options.expandPages = false;
    logseq.setMainUIInlineStyle({
      position: "fixed",
      top: "4vh",
      right: "3vw",
      width: "min(620px,94vw)",
      height: "92vh",
      zIndex: 1000,
    });
    logseq.provideModel({ openExporter: () => open() });
    logseq.App.registerUIItem("toolbar", {
      key: "complete-export",
      template: `<a class="button" data-on-click="openExporter" title="Complete Export" aria-label="Complete Export" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;min-width:28px;padding:0;line-height:1;box-sizing:border-box;vertical-align:middle">${createElement(Download, { width: 18, height: 18, "aria-hidden": "true", style: "display:block;width:18px;height:18px;flex-shrink:0" }).outerHTML}</a>`,
    });
    logseq.App.registerCommandPalette(
      { key: "complete-export", label: "Complete Export: export content" },
      () => open(),
    );
    logseq.Editor.registerBlockContextMenuItem(
      "Complete Export: block",
      async ({ uuid }) => open("block", { block: uuid }),
    );
    logseq.Editor.registerBlockContextMenuItem(
      "Complete Export: branch",
      async ({ uuid }) => open("branch", { block: uuid }),
    );
    logseq.App.registerPageMenuItem("Complete Export: page", ({ page }) =>
      open("page", { page }),
    );
  })
  .catch(console.error);
