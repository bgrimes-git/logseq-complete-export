import { test } from "node:test";
import assert from "node:assert/strict";
import { Resolver, defaults, darken } from "../src/model";
function api(blocks: Record<string, any>, pages: Record<string, any> = {}) {
  return {
    async getBlock(id: any) {
      return blocks[id] ?? null;
    },
    async getPage(id: any) {
      assert.notEqual(
        typeof id,
        "object",
        "Logseq DB 2.0.1 requires a scalar page identity",
      );
      return pages[id] ?? null;
    },
    async getPageBlocksTree(id: any) {
      assert.notEqual(
        typeof id,
        "object",
        "Page trees require a scalar identity",
      );
      return pages[id]?.children ?? null;
    },
  };
}
test("DB title wins over deprecated content; UUID tuple children include collapsed content", async () => {
  const r = new Resolver(
    api({ child: { uuid: "child", title: "Child", children: [] } }),
    defaults,
  );
  const n = await r.block({
    uuid: "root",
    title: "DB title",
    content: "Old",
    children: [["uuid", "child"]],
    "collapsed?": true,
  });
  assert.equal(n.text, "DB title");
  assert.equal(n.children[0].text, "Child");
  assert.equal(n.collapsed, true);
});
test("nested block and page embeds expand and repeats are preserved", async () => {
  const blocks = {
    a: { uuid: "a", title: "A {{embed [[Page]]}}" },
    b: { uuid: "b", title: "B" },
  };
  const page = {
    uuid: "page",
    name: "page",
    title: "Page",
    children: [blocks.b],
  };
  const r = new Resolver(api(blocks, { Page: page, page }), defaults);
  const n = await r.block({ uuid: "root", title: "((a)) and ((a))" });
  assert.equal(n.children.length, 2);
  assert.equal(n.children[0].children[0].children[0].text, "B");
  assert.deepEqual(r.warnings, []);
});
test("cycles end with a visible notice, missing references remain visible", async () => {
  const a = { uuid: "a", title: "((a)) and ((missing))" };
  const r = new Resolver(api({ a }), defaults);
  const n = await r.block(a);
  assert.equal(n.children[0].kind, "notice");
  assert.match(n.text, /missing/);
  assert.equal(r.warnings.length, 2);
});
test("block scope omits original children; embed content still included", async () => {
  const r = new Resolver(
    api({ ref: { uuid: "ref", title: "Reference" } }),
    defaults,
  );
  const n = await r.block(
    {
      uuid: "root",
      title: "{{embed ((ref))}}",
      children: [{ uuid: "child", title: "Child" }],
    },
    new Set(),
    false,
  );
  assert.equal(n.children.length, 1);
  assert.equal(n.children[0].text, "Reference");
});
test("DB link entities and opt-in ordinary page expansion", async () => {
  const page = { uuid: "p", title: "Page", name: "page", children: [] };
  const r = new Resolver(api({ p: page }, { Page: page, p: page }), {
    ...defaults,
    expandPages: true,
  });
  assert.equal(
    (await r.block({ uuid: "link", title: "Alias", link: { id: "p" } }))
      .children[0].kind,
    "page",
  );
  assert.equal(
    (await r.block({ uuid: "root", title: "[[Page]]" })).children[0].text,
    "Page",
  );
});
test("accent darkening has stable endpoints", () => {
  assert.equal(darken("#abcdef", 0), "#abcdef");
  assert.equal(darken("#ffffff", 100), "#000000");
});
test("query results hydrate entities and include nested embeds without duplicating self", async () => {
  const blocks = {
    hit: { uuid: "hit", title: "Result {{embed ((nested))}}" },
    nested: { uuid: "nested", title: "Nested query embed" },
  };
  const r = new Resolver(api(blocks), defaults, {
    async run(b) {
      return b.uuid === "query"
        ? { results: [[{ id: "hit" }], [{ uuid: "query" }]], source: "(and)" }
        : undefined;
    },
  });
  const n = await r.block({ uuid: "query", title: "Collected query" });
  assert.equal(n.children.length, 1);
  assert.equal(n.children[0].children[0].text, "Nested query embed");
});
test("a query failure stops export instead of producing an incomplete page", async () => {
  const r = new Resolver(api({}), defaults, {
    async run() {
      throw new Error("Query execution failed");
    },
  });
  await assert.rejects(
    () => r.block({ uuid: "q", title: "Query" }),
    /Query execution failed/,
  );
});
test("reference-like text inside code remains literal", async () => {
  const r = new Resolver(api({}), defaults);
  const n = await r.block({
    uuid: "code",
    title: "`((not-a-ref))` and ```\n[[Literal]]\n```",
  });
  assert.equal(n.children.length, 0);
  assert.deepEqual(r.warnings, []);
});
test("DB UUID syntax can refer to a block rather than a page", async () => {
  const uuid = "12345678-1234-1234-1234-123456789abc";
  const r = new Resolver(
    api({
      [uuid]: {
        uuid,
        title: "DB reference",
        children: [{ uuid: "nested", title: "Branch content" }],
      },
    }),
    defaults,
  );
  const n = await r.block({ uuid: "root", title: `[[${uuid}]]` });
  assert.equal(n.children[0].text, "DB reference");
  assert.equal(n.children[0].children[0].text, "Branch content");
  assert.deepEqual(r.warnings, []);
});
test("DB page lookup, tree and properties all receive a UUID string", async () => {
  const uuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const page = {
    uuid,
    id: 7,
    name: "collection",
    title: "Collection",
    children: [{ uuid: "child", title: "Actual page content" }],
  };
  const calls: unknown[] = [];
  const r = new Resolver(
    {
      ...api({}, { [uuid]: page }),
      async getPageProperties(id: any) {
        calls.push(id);
        assert.equal(id, uuid);
        return { status: "Ready" };
      },
    },
    defaults,
  );
  const node = await r.page({ uuid });
  assert.equal(node.text, "Collection");
  assert.equal(node.children[0].text, "Actual page content");
  assert.equal(node.properties.status, "Ready");
  assert.deepEqual(calls, [uuid]);
});
test("missing root pages stop export and embedded missing pages have readable notices", async () => {
  const r = new Resolver(api({}), defaults);
  await assert.rejects(
    () => r.page({ uuid: "missing" }),
    /Page not found: missing/,
  );
  const nested = await r.page({ uuid: "missing" }, new Set(["parent"]));
  assert.equal(nested.text, "Missing page: missing");
});

test("page references without UUIDs use scalar IDs or names without false cycles", async () => {
  const root = { name: "workshop", title: "Workshop" };
  const linked = { id: 42, name: "supplies", title: "Supplies" };
  const resolver = new Resolver(
    {
      getBlock: async () => null,
      getPage: async (id) => (id === "workshop" ? root : linked),
      getPageBlocksTree: async (id) =>
        id === "workshop"
          ? [{ uuid: "link", title: "[[Supplies]]" }]
          : [{ uuid: "supply", title: "Paper" }],
    },
    defaults,
  );
  const node = await resolver.page(root);
  assert.equal(node.uuid, "workshop");
  assert.equal(node.children[0].children[0].uuid, "42");
  assert.equal(node.children[0].children[0].children[0].text, "Paper");
  assert.deepEqual(resolver.warnings, []);
});
test("DB hidden link restores the embedded title without duplicating flattened children", async () => {
  const r = new Resolver(
    {
      getLinkedTarget: async (id) => (id === 10 ? 20 : undefined),
      getBlock: async () => ({
        id: 20,
        uuid: "target",
        name: "workshop planning",
        title: "Workshop planning",
      }),
      getPage: async () => ({
        id: 20,
        uuid: "target",
        name: "workshop planning",
        title: "Workshop planning",
      }),
      getPageBlocksTree: async () => [
        { uuid: "child", title: "Recommendation" },
      ],
    },
    defaults,
  );
  const n = await r.block({
    id: 10,
    uuid: "alias",
    title: "",
    children: [{ uuid: "child", title: "Recommendation" }],
  });
  assert.equal(n.text, "Workshop planning");
  assert.equal(n.embedded, true);
  assert.equal(n.children.length, 1);
});
test("DB asset metadata becomes an image even when properties are disabled", async () => {
  const r = new Resolver(
    {
      getBlock: async () => null,
      getPage: async () => null,
      getPageBlocksTree: async () => [],
      getBlockProperties: async () => ({
        ":logseq.property.asset/type": "png",
        ":logseq.property.asset/width": 250,
      }),
    },
    { ...defaults, properties: false },
  );
  const n = await r.block({ uuid: "asset", title: "Screenshot" });
  assert.match(n.text, /src="\.\.\/assets\/asset.png"/);
  assert.match(n.text, /width="250"/);
});
test("branch embed retains containing page label above the target block", async () => {
  const r = new Resolver(
    {
      getLinkedTarget: async (id) => (id === 10 ? 20 : undefined),
      getBlock: async () => ({
        id: 20,
        uuid: "recommendation",
        title: "Community workshop",
        page: { id: 30 },
      }),
      getPage: async () => ({
        id: 30,
        uuid: "source",
        title: "Workshop planning",
      }),
      getPageBlocksTree: async () => [],
    },
    defaults,
  );
  const node = await r.block({ id: 10, uuid: "embed", title: "" });
  assert.equal(node.text, "Workshop planning");
  assert.equal(node.children[0].text, "Community workshop");
});
test("DB label snapshot restores branch heading even without SDK page metadata", async () => {
  const r = new Resolver(
    {
      getLinkedTarget: async (id) => (id === 10 ? 20 : undefined),
      getLinkedTitle: async () => "Workshop planning",
      getBlock: async () => ({
        id: 20,
        uuid: "target",
        title: "Recommendation",
      }),
      getPage: async () => null,
      getPageBlocksTree: async () => [],
    },
    defaults,
  );
  const node = await r.block({ id: 10, uuid: "alias", title: "" });
  assert.equal(node.text, "Workshop planning");
  assert.equal(node.children[0].text, "Recommendation");
});
