import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDbTree, readDbPageTree, readDbBlock } from "../src/db-tree";

test("DB page snapshots retain embed wrappers, hierarchy and sibling order", () => {
  const tree = buildDbTree(
    [
      [
        {
          id: 3,
          uuid: "second",
          title: "Second",
          order: "b",
          parent: { id: 1 },
        },
      ],
      [{ id: 4, uuid: "nested", title: "Nested", parent: { id: 2 } }],
      [
        {
          id: 2,
          uuid: "embed",
          title: "",
          order: "a",
          parent: { id: 1 },
          link: { id: 10 },
        },
      ],
      [{ id: 5, uuid: "other", title: "Unrelated", parent: { id: 99 } }],
    ],
    1,
  )!;
  assert.deepEqual(
    tree.map((b) => b.uuid),
    ["embed", "second"],
  );
  assert.equal(tree[0].link.id, 10);
  assert.equal(tree[0].children[0].title, "Nested");
});

test("a DB page tree restores blocks absent from the rendered SDK tree", async () => {
  const ls: any = {
    Editor: {
      getPage: async () => ({ id: 1 }),
      getPageBlocksTree: async () => [],
    },
    DB: {
      datascriptQuery: async (_q: string, id: string) => {
        if (id === "[2]") return [];
        assert.equal(id, "[1]");
        return [
          [
            {
              id: 2,
              uuid: "restored",
              title: "Embedded page content",
              parent: { id: 1 },
            },
          ],
        ];
      },
    },
  };
  assert.equal(
    (await readDbPageTree(ls, "page"))![0].title,
    "Embedded page content",
  );
});

test("page traversal continues under blank nodes without page-membership metadata", async () => {
  const records = [
    { id: 2, uuid: "blank", title: "", parent: { id: 1 } },
    {
      id: 3,
      uuid: "content",
      title: "Content below blank row",
      parent: { id: 2 },
    },
    { id: 4, uuid: "later", title: "Later branch", parent: { id: 1 } },
  ];
  const ls: any = {
    Editor: {
      getPage: async () => ({ id: 1 }),
      getPageBlocksTree: async () => [
        { id: 2, uuid: "blank", title: "", children: [] },
      ],
    },
    DB: {
      datascriptQuery: async (q: string, input: string) => {
        assert.ok(!q.includes(":block/page"));
        const parents = input.slice(1, -1).split(" ").map(Number);
        return records
          .filter((r) => parents.includes(r.parent.id))
          .map((r) => [r]);
      },
    },
  };
  const result = await readDbPageTree(ls, "page");
  assert.equal(result![0].title, "");
  assert.equal(result![0].children[0].title, "Content below blank row");
  assert.equal(result![1].title, "Later branch");
});

test("unavailable DB snapshot retains the SDK fallback", async () => {
  const ls: any = {
    Editor: {
      getPage: async () => ({ id: 1 }),
      getPageBlocksTree: async () => [{ uuid: "fallback" }],
    },
    DB: { datascriptQuery: async () => [] },
  };
  assert.equal((await readDbPageTree(ls, "page"))![0].uuid, "fallback");
});

test("a page root is not replaced by the first child returned by SDK expansion", async () => {
  const root = {
    id: 20,
    uuid: "embedded-page",
    title: "Embedded page",
    name: "embedded page",
  };
  const first = {
    id: 21,
    uuid: "first-row",
    title: "First row",
    parent: { id: 20 },
    children: [],
  };
  const blank = { id: 22, uuid: "blank", title: "", parent: { id: 20 } };
  const body = {
    id: 23,
    uuid: "body",
    title: "Actual page body",
    parent: { id: 20 },
  };
  const records = [first, blank, body];
  const ls: any = {
    Editor: {
      getBlock: async (_id: any, opts: any) =>
        opts.includeChildren ? first : root,
    },
    DB: {
      datascriptQuery: async (_q: string, input: string) => {
        const parents = input.slice(1, -1).split(" ").map(Number);
        return records
          .filter((r) => parents.includes(r.parent.id))
          .map((r) => [r]);
      },
    },
  };
  const result = await readDbBlock(ls, 20, { includeChildren: true });
  assert.equal(result.id, 20);
  assert.equal(result.uuid, root.uuid);
  assert.deepEqual(
    result.children.map((b: any) => b.uuid),
    ["first-row", "blank", "body"],
  );
});

test("an expanded SDK fallback with a different identity cannot overwrite the root", async () => {
  const root = { id: 20, uuid: "page", title: "Page", children: [] };
  const ls: any = {
    Editor: {
      getBlock: async (_id: any, opts: any) =>
        opts.includeChildren ? { id: 21, uuid: "child" } : root,
    },
    DB: { datascriptQuery: async () => [] },
  };
  assert.equal(
    (await readDbBlock(ls, 20, { includeChildren: true })).uuid,
    "page",
  );
});

test("physical traversal does not expand separate namespace child pages", async () => {
  const ls: any = {
    Editor: {
      getPage: async () => ({ id: 1 }),
      getPageBlocksTree: async () => [],
    },
    DB: {
      datascriptQuery: async (_q: string, input: string) =>
        input === "[1]"
          ? [
              [
                {
                  id: 2,
                  uuid: "own-block",
                  title: "Own outline",
                  parent: { id: 1 },
                },
              ],
              [
                {
                  id: 9,
                  uuid: "subpage",
                  title: "Separate page",
                  parent: { id: 1 },
                },
              ],
            ]
          : [],
    },
  };
  const result = await readDbPageTree(
    ls,
    "page",
    new Set(["1", "9", "subpage"]),
  );
  assert.deepEqual(
    result!.map((block) => block.uuid),
    ["own-block"],
  );
});

test("DB child reads restore a capped SDK target with branches, large tables and pins", async () => {
  const table = (rows: number) =>
    "| Item | Value |\n| --- | --- |\n" +
    Array.from(
      { length: rows },
      (_, i) => `| Row ${i + 1} | Value ${i + 1} |`,
    ).join("\n");
  const records = [
    { id: 2, uuid: "branch-a", parent: { id: 1 }, title: "Branch A" },
    { id: 3, uuid: "branch-b", parent: { id: 1 }, title: "Branch B \u{1F4CC}" },
    { id: 4, uuid: "large", parent: { id: 2 }, title: table(118) },
    { id: 5, uuid: "small", parent: { id: 3 }, title: table(5) },
  ];
  const ls: any = {
    Editor: {
      getBlock: async () => ({
        id: 1,
        uuid: "target",
        title: "Embedded target",
        children: [],
      }),
    },
    DB: {
      datascriptQuery: async (_q: string, input: string) => {
        const parents = input.slice(1, -1).split(" ").map(Number);
        return records
          .filter((row) => parents.includes(row.parent.id))
          .map((row) => [row]);
      },
    },
  };
  const result = await readDbBlock(ls, 1, { includeChildren: true });
  assert.equal(result.children.length, 2);
  assert.equal(result.children[0].children[0].title.split("\n").length, 120);
  assert.equal(result.children[1].children[0].title.split("\n").length, 7);
  assert.equal(result.children[1].title, "Branch B \u{1F4CC}");
});
