import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDbTree, readDbPageTree } from "../src/db-tree";

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
      datascriptQuery: async (_q: string, id: number) => {
        assert.equal(id, 1);
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
