export interface Node {
  uuid: string;
  text: string;
  children: Node[];
  ordered?: Array<string | number>;
  query?: { source: string; results: unknown[] };
  collapsed: boolean;
  properties: Record<string, unknown>;
  kind: "block" | "page" | "notice";
  embedded?: boolean;
}
export interface DocumentData {
  title: string;
  graph: string;
  nodes: Node[];
  warnings: string[];
  created: string;
}
export interface Options {
  expandRefs: boolean;
  expandPages: boolean;
  properties: boolean;
  margins: number[];
  darken: number;
  accent: string;
  defaultColor?: string;
  paper: "LETTER" | "A4";
}
export interface Api {
  getBlock(id: string | number, opts?: object): Promise<any>;
  getPage(id: any): Promise<any>;
  getPageBlocksTree(id: any): Promise<any[] | null>;
  getBlockProperties?(id: string): Promise<any>;
  getPageProperties?(id: any): Promise<any>;
  getLinkedTarget?(id: number | string): Promise<any>;
  getLinkedTitle?(id: number | string): Promise<string | undefined>;
  getAssetWidth?(uuid: string): number | undefined;
}
export interface QueryProvider {
  run(
    block: any,
  ): Promise<{ results: any[]; html?: string; source: string } | undefined>;
}
export const defaults: Options = {
  expandRefs: true,
  expandPages: true,
  properties: true,
  margins: [0.35, 0.35, 0.35, 0.35],
  darken: 25,
  accent: "#426b9e",
  paper: "LETTER",
};
export const textOf = (b: any): string =>
  String(b.title ?? b.content ?? b.originalName ?? b.name ?? "");
export function pageIdentity(value: any): string | number {
  const identity =
    typeof value === "object" && value !== null
      ? (value.uuid ?? value.id ?? value.name ?? value.originalName)
      : value;
  if (
    (typeof identity !== "string" && typeof identity !== "number") ||
    identity === ""
  )
    throw new Error("The page has no usable UUID, ID, or name.");
  return identity;
}
export const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function darken(hex: string, percent: number) {
  return (
    "#" +
    hex
      .replace("#", "")
      .match(/../g)!
      .map((c) =>
        Math.round(parseInt(c, 16) * (1 - percent / 100))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

export class Resolver {
  warnings: string[] = [];
  private cache = new Map<string, Promise<any>>();
  private count = 0;
  constructor(
    private api: Api,
    private options: Options,
    private queries?: QueryProvider,
  ) {}
  private warn(message: string) {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }
  private fetch(id: string | number): Promise<any> {
    const key = String(id);
    if (!this.cache.has(key))
      this.cache.set(
        key,
        this.api.getBlock(id, { includeChildren: true, includePage: true }),
      );
    return this.cache.get(key)!;
  }
  private notice(text: string): Node {
    this.warn(text);
    return {
      uuid: "",
      text,
      children: [],
      collapsed: false,
      properties: {},
      kind: "notice",
    };
  }
  async page(id: any, path = new Set<string>()): Promise<Node> {
    const identity = pageIdentity(id);
    const page = await this.api.getPage(identity);
    if (!page) {
      if (!path.size) throw new Error(`Page not found: ${identity}`);
      return this.notice(`Missing page: ${identity}`);
    }
    const key = String(page.uuid ?? page.id);
    if (path.has(key))
      return this.notice(`Circular page reference: ${textOf(page)}`);
    const next = new Set(path).add(key);
    const resolvedIdentity = pageIdentity(page);
    const blocks = await this.api.getPageBlocksTree(resolvedIdentity);
    if (!blocks) throw new Error(`Could not read page: ${textOf(page)}`);
    const children: Node[] = [];
    for (const block of blocks) children.push(await this.block(block, next));
    const properties =
      this.options.properties && this.api.getPageProperties
        ? await this.api.getPageProperties(resolvedIdentity)
        : page.properties;
    return {
      uuid: key,
      text: textOf(page),
      children,
      collapsed: false,
      properties: properties ?? {},
      kind: "page",
    };
  }
  async block(
    input: any,
    path = new Set<string>(),
    children = true,
  ): Promise<Node> {
    const b = Array.isArray(input)
      ? await this.fetch(input[1])
      : typeof input === "object"
        ? input
        : await this.fetch(input);
    if (!b) return this.notice(`Missing block: ${String(input)}`);
    const key = String(b.uuid ?? b.id);
    if (path.has(key)) return this.notice(`Circular block reference: ${key}`);
    if (++this.count > 50000 || path.size > 80)
      throw new Error(
        "Export exceeds the 50,000 expanded block or 80-level limit. Export smaller sections or disable reference expansion.",
      );
    const next = new Set(path).add(key);
    let text = textOf(b);
    const rawLinked = await this.api.getLinkedTarget?.(b.id ?? key);
    if (rawLinked) {
      const target = await this.fetch(rawLinked);
      if (!target)
        throw new Error(`Could not read embedded target: ${rawLinked}`);
      const node =
        target.name !== undefined
          ? await this.page(pageIdentity(target), next)
          : await this.block(target, next, children);
      const sourcePage =
        target.name === undefined && target.page
          ? await this.api.getPage(pageIdentity(target.page))
          : null;
      const sourceTitle =
        (await this.api.getLinkedTitle?.(b.id ?? key)) ??
        (sourcePage ? textOf(sourcePage) : undefined);
      return {
        ...node,
        ...(sourceTitle && target.name === undefined
          ? { text: sourceTitle, children: [node] }
          : {}),
        uuid: key,
        embedded: true,
        collapsed: !!(b["collapsed?"] ?? b.collapsed),
      };
    }
    const nested: Node[] = [];
    const ordered: Array<string | number> = [];
    const query = await this.queries?.run(b);
    if (query) {
      text =
        text
          .replace(/\{\{\s*query\s+[\s\S]*?\}\}/gi, "")
          .replace(/#\+BEGIN_QUERY[\s\S]*?#\+END_QUERY/gi, "")
          .trim() || "Query results";
      if (query.html)
        nested.push({
          uuid: "",
          text: query.html,
          kind: "block",
          children: [],
          collapsed: false,
          properties: {},
        });
      else if (!query.results.length)
        nested.push({
          uuid: "",
          text: "No query results.",
          kind: "block",
          children: [],
          collapsed: false,
          properties: {},
        });
      else
        for (const row of query.results) {
          const value = Array.isArray(row) && row.length === 1 ? row[0] : row;
          const id =
            value && typeof value === "object"
              ? (value.uuid ??
                value["block/uuid"] ??
                value.id ??
                value["db/id"])
              : undefined;
          if (id) {
            if (String(id) === key || id === b.id) continue;
            const entity = await this.fetch(id);
            if (!entity)
              throw new Error(
                `Could not read query result ${String(id)} in block ${key}.`,
              );
            // Logseq also excludes the query block from its own result set.
            if (entity && String(entity.uuid ?? entity.id) !== key)
              nested.push(
                entity.name !== undefined
                  ? await this.page({ uuid: entity.uuid }, next)
                  : await this.block(entity, next),
              );
          } else
            nested.push({
              uuid: "",
              text: typeof value === "string" ? value : JSON.stringify(value),
              kind: "block",
              children: [],
              collapsed: false,
              properties: {},
            });
        }
    }
    const queryChildren = nested.length;
    // Resolve embeds in place; ordinary references retain readable linked labels.
    const pattern =
      /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|\{\{\s*embed\s+(?:\(\(([^)]+)\)\)|\[\[([^\]]+)\]\])\s*\}\}|\(\(([^)]+)\)\)|\[\[([^\]]+)\]\]/gi;
    let result = "",
      last = 0,
      segmentStart = 0;
    for (const match of text.matchAll(pattern)) {
      result += text.slice(last, match.index);
      const [, embedBlock, embedPage, refBlock, refPage] = match;
      if (!embedBlock && !embedPage && !refBlock && !refPage) {
        result += match[0];
        last = match.index! + match[0].length;
        continue;
      }
      const target = embedBlock ?? embedPage ?? refBlock ?? refPage;
      let isPage = !!(embedPage || refPage);
      let entity: any;
      try {
        entity = isPage
          ? await this.api.getPage(target)
          : await this.fetch(target);
        if (!entity && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(target))
          entity =
            (await this.fetch(target)) ?? (await this.api.getPage(target));
        if (entity) isPage = entity.name !== undefined;
      } catch (e) {
        this.warn(`Reference failed: ${target}: ${String(e)}`);
      }
      if (!entity) {
        result += match[0];
        this.warn(`Unresolved reference: ${target}`);
      } else {
        const label = String(entity.fullTitle ?? textOf(entity)).replace(
          /\[\[|\]\]|\(\(|\)\)/g,
          "",
        );
        const dest = entity.uuid ?? target;
        result += `[${label.replace(/[\[\]]/g, "") || target}](logseq://graph/${encodeURIComponent(this.graph)}?block-id=${encodeURIComponent(dest)})`;
        if (
          embedBlock ||
          embedPage ||
          (!isPage && this.options.expandRefs) ||
          (isPage && this.options.expandPages)
        ) {
          ordered.push(result.slice(segmentStart), nested.length);
          segmentStart = result.length;
          nested.push(
            isPage || entity.name !== undefined
              ? await this.page({ uuid: entity.uuid }, next)
              : await this.block(entity, next),
          );
        }
      }
      last = match.index! + match[0].length;
    }
    text = result + text.slice(last);
    if (ordered.length)
      ordered.push(
        text.slice(segmentStart),
        ...Array.from({ length: queryChildren }, (_, i) => i),
      );
    if (/\{\{(?:query|renderer)|#\+BEGIN_QUERY/i.test(text))
      this.warn(
        `Dynamic query or custom renderer needs manual review in block ${key}.`,
      );
    if (children)
      for (const child of b.children ?? []) {
        if (ordered.length) ordered.push(nested.length);
        nested.push(await this.block(child, next));
      }
    // DB embed/alias entities can point at another node through :block/link.
    const linked = b.link ?? b["block/link"];
    if (linked) {
      const id =
        typeof linked === "object" ? (linked.uuid ?? linked.id) : linked;
      if (id) {
        const target = await this.fetch(id);
        if (target) {
          if (ordered.length) ordered.push(nested.length);
          nested.push(
            target.name !== undefined
              ? await this.page({ uuid: target.uuid }, next)
              : await this.block(target, next),
          );
        }
      }
    }
    const properties = this.api.getBlockProperties
      ? await this.api.getBlockProperties(b.uuid)
      : b.properties;
    const assetType =
      properties?.[":logseq.property.asset/type"] ??
      b["logseq.property.asset/type"];
    if (assetType && /^(png|jpe?g|gif|webp|svg)$/i.test(assetType)) {
      const url =
        properties?.[":logseq.property.asset/external-url"] ??
        `../assets/${b.uuid}.${assetType}`;
      const resize =
        properties?.[":logseq.property.asset/resize-metadata"] ??
        b["logseq.property.asset/resize-metadata"];
      const width =
        this.api.getAssetWidth?.(b.uuid) ??
        resize?.width ??
        resize?.[":width"] ??
        Math.min(
          Number(properties?.[":logseq.property.asset/width"]) || 250,
          250,
        );
      text = `<figure><img src="${escape(url)}" alt="${escape(text)}" width="${Math.max(1, Math.round(Number(width)))}"><figcaption>${escape(text)}</figcaption></figure>`;
    }
    return {
      uuid: key,
      text,
      children: nested,
      ...(ordered.length ? { ordered } : {}),
      ...(query
        ? { query: { source: query.source, results: query.results } }
        : {}),
      collapsed: !!(b["collapsed?"] ?? b.collapsed),
      properties: properties ?? {},
      kind: "block",
    };
  }
  graph = "";
}
