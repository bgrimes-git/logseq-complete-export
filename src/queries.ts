import {
  planQuery,
  applyQueryFunction,
  queryEntity,
  type Evaluator,
} from "./query-engine";
import { escape, textOf } from "./model";
export interface QuerySnapshot {
  results: any[];
  html?: string;
  source: string;
}
export class Queries {
  private definitions = new Map<number, string>();
  constructor(
    private ls: typeof logseq,
    private engine: () => Promise<Evaluator>,
  ) {}
  async load() {
    const rows = await this.ls.DB.datascriptQuery(
      "[:find ?b ?title :where [?b :logseq.property/query ?q] [?q :block/title ?title]]",
    );
    for (const [id, title] of rows ?? []) this.definitions.set(id, title);
  }
  async run(block: any): Promise<QuerySnapshot | undefined> {
    const source = this.definitions.get(block.id);
    const macros = Array.from(
      textOf(block).matchAll(/\{\{\s*query\s+([\s\S]*?)\}\}/gi),
    ).map((m) => m[1]);
    const advanced = textOf(block).match(
      /#\+BEGIN_QUERY\s*([\s\S]*?)#\+END_QUERY/i,
    )?.[1];
    const sources = [
      ...(source ? [source] : []),
      ...macros,
      ...(advanced ? [advanced] : []),
    ];
    if (!sources.length) return;
    const results: any[] = [];
    let html: string | undefined;
    for (let source of sources) {
      const page = block.page?.id
        ? await this.ls.Editor.getPage(block.page.id)
        : await this.ls.Editor.getCurrentPage();
      source = source.replace(/<%\s*current page\s*%>/gi, textOf(page ?? {}));
      let rows: any;
      if (source.trim().startsWith("{") || source.trim().startsWith("[:find")) {
        const e = await this.engine(),
          plan = planQuery(e, source);
        const inputs = plan.inputs.map((input) =>
          input === ":current-page"
            ? JSON.stringify(
                String(page?.name ?? textOf(page ?? {})).toLowerCase(),
              )
            : input === ":current-block"
              ? String(block.id)
              : input === ":parent-block"
                ? String(block.parent?.id)
                : input === ":query-page"
                  ? JSON.stringify(page?.name ?? textOf(page ?? {}))
                  : input,
        );
        rows = await this.ls.DB.datascriptQuery(plan.query, ...inputs);
        if (plan.transform || plan.view) {
          const entities = await this.hydrateRows(rows);
          const configs = await this.ls.App.getCurrentGraphConfigs();
          const data = entities.map(queryEntity);
          rows = plan.transform
            ? applyQueryFunction(
                e,
                plan.transform,
                data,
                configs?.["query/result-transforms"] ?? {},
              )
            : entities;
          if (plan.view)
            html = hiccup(
              applyQueryFunction(
                e,
                plan.view,
                plan.transform ? rows : data,
                configs?.["query/views"] ?? {},
              ),
            );
        }
      } else rows = await this.ls.DB.q(source);
      if (rows === null || rows === undefined) rows = [];
      results.push(...(Array.isArray(rows) ? rows : [rows]));
    }
    return { results, html, source: sources.join("\n") };
  }
  private async hydrateRows(rows: any): Promise<any[]> {
    const result = [];
    for (const row of Array.isArray(rows) ? rows : [rows]) {
      const cell = Array.isArray(row) && row.length === 1 ? row[0] : row;
      if (cell?.id && typeof cell === "object")
        result.push(
          (await this.ls.Editor.getBlock(cell.id, { includeChildren: true })) ??
            cell,
        );
      else result.push(cell);
    }
    return result;
  }
}
// Translate the data returned by a Logseq :view function, then sanitize in the renderer.
export function hiccup(value: any): string {
  if (value == null || value === false) return "";
  if (!Array.isArray(value)) return escape(String(value));
  if (typeof value[0] !== "string") return value.map(hiccup).join("");
  const descriptor = value[0].replace(/^:/, ""),
    tag = descriptor.split(/[.#]/)[0] || "div";
  if (!/^[a-z][a-z0-9-]*$/i.test(tag)) return escape(String(value));
  const attrs =
    value[1] && typeof value[1] === "object" && !Array.isArray(value[1])
      ? value[1]
      : null;
  const attributes = attrs
    ? Object.entries(attrs)
        .filter(([key]) =>
          ["href", "src", "alt", "title", "colspan", "rowspan"].includes(
            key.replace(/^:/, ""),
          ),
        )
        .map(([key, v]) => ` ${key.replace(/^:/, "")}="${escape(String(v))}"`)
        .join("")
    : "";
  return `<${tag}${attributes}>${value
    .slice(attrs ? 2 : 1)
    .map(hiccup)
    .join("")}</${tag}>`;
}
