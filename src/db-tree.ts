export function buildDbTree(rows: any[], pageId: number): any[] | undefined {
  const records = rows
    .map((row) => (Array.isArray(row) ? row[0] : row))
    .filter(
      (row) =>
        row && typeof row.id === "number" && typeof row.uuid === "string",
    );
  if (!records.length) return undefined;
  if (records.length > 50000)
    throw new Error("The DB page exceeds the 50,000-block export limit.");
  const nodes = new Map<number, any>();
  for (const record of records)
    nodes.set(record.id, { ...record, children: [] });
  const roots: any[] = [];
  for (const node of nodes.values()) {
    const parent =
      typeof node.parent === "object" ? node.parent?.id : node.parent;
    if (parent === pageId) roots.push(node);
    else if (nodes.has(parent) && parent !== node.id)
      nodes.get(parent).children.push(node);
  }
  const visited = new Set<number>();
  function sort(children: any[], depth = 0) {
    if (depth > 80)
      throw new Error("The DB page exceeds the 80-level export limit.");
    children.sort((a, b) =>
      String(a.order ?? "") < String(b.order ?? "")
        ? -1
        : String(a.order ?? "") > String(b.order ?? "")
          ? 1
          : a.id - b.id,
    );
    for (const node of children) {
      if (visited.has(node.id))
        throw new Error("The DB page tree contains a parent cycle.");
      visited.add(node.id);
      sort(node.children, depth + 1);
    }
  }
  sort(roots);
  return roots.length ? roots : undefined;
}
export async function readDbPageTree(
  ls: typeof logseq,
  identity: any,
  pageIds?: ReadonlySet<string>,
): Promise<any[] | null> {
  const page = await ls.Editor.getPage(identity);
  if (typeof page?.id !== "number")
    return ls.Editor.getPageBlocksTree(identity);
  return (
    (await readDbChildren(ls, page.id, pageIds)) ??
    ls.Editor.getPageBlocksTree(identity)
  );
}

export async function readDbBlock(
  ls: typeof logseq,
  id: string | number,
  opts?: object,
  pageIds?: ReadonlySet<string>,
): Promise<any> {
  // The DB SDK's expanded page tree can return its first child instead of the root.
  const rootOptions = {
    ...opts,
    includeChildren: false,
    includePage: true,
  };
  const block = await ls.Editor.getBlock(id, rootOptions);
  if (!block || typeof block.id !== "number") return block;
  const children = await readDbChildren(ls, block.id, pageIds);
  if (children) return { ...block, children };
  if ((opts as { includeChildren?: boolean } | undefined)?.includeChildren) {
    const expanded = await ls.Editor.getBlock(id, opts);
    if (expanded && expanded.uuid === block.uuid && expanded.id === block.id)
      return expanded;
  }
  return block;
}

async function readDbChildren(
  ls: typeof logseq,
  rootId: number,
  pageIds?: ReadonlySet<string>,
): Promise<any[] | undefined> {
  const records: any[] = [];
  const seen = new Set<number>([rootId]);
  let pending = [rootId];
  for (let depth = 0; pending.length; depth++) {
    if (depth > 80)
      throw new Error("The DB branch exceeds the 80-level export limit.");
    const rows = await ls.DB.datascriptQuery(
      "[:find (pull ?b [:db/id :block/uuid :block/title :block/order :block/collapsed? :logseq.property/heading :block/heading-level {:block/parent [:db/id]} {:block/link [:db/id :block/uuid]}]) :in $ [?parent ...] :where [?b :block/parent ?parent]]",
      `[${pending.join(" ")}]`,
    );
    pending = [];
    for (const row of rows ?? []) {
      const child = Array.isArray(row) ? row[0] : row;
      if (typeof child?.id !== "number" || typeof child.uuid !== "string")
        continue;
      // Namespace child pages are separate documents, not outline descendants.
      if (pageIds?.has(String(child.id)) || pageIds?.has(child.uuid)) continue;
      if (seen.has(child.id))
        throw new Error("The DB branch contains a parent cycle.");
      seen.add(child.id);
      records.push(child);
      pending.push(child.id);
    }
    if (records.length > 50000)
      throw new Error("The DB branch exceeds the 50,000-block export limit.");
  }
  return buildDbTree(records, rootId);
}
