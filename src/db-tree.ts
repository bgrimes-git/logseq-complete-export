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
): Promise<any[] | null> {
  const page = await ls.Editor.getPage(identity);
  if (typeof page?.id !== "number")
    return ls.Editor.getPageBlocksTree(identity);
  const rows = await ls.DB.datascriptQuery(
    "[:find (pull ?b [:db/id :block/uuid :block/title :block/order :block/collapsed? {:block/parent [:db/id]} {:block/link [:db/id :block/uuid]}]) :in $ ?page :where [?b :block/page ?page] [?b :block/parent]]",
    page.id,
  );
  return (
    buildDbTree(rows ?? [], page.id) ?? ls.Editor.getPageBlocksTree(identity)
  );
}
