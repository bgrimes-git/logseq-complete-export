import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  initRules,
  planQuery,
  applyQueryFunction,
  queryEntity,
} from "../src/query-engine";
const dom = new JSDOM("<!doctype html><html></html>", {
  runScripts: "outside-only",
});
dom.window.eval(readFileSync("node_modules/scittle/dist/scittle.js", "utf8"));
const engine = (dom.window as any).scittle.core;
initRules(engine, readFileSync("src/logseq-db-rules.cljc", "utf8"));
test("advanced EDN queries preserve vectors, strings and inputs", () => {
  const p = planQuery(
    engine,
    "{:query [:find (pull ?b [*]) :in $ ?p :where [?b :block/title ?p]] :inputs [:current-page]}",
  );
  assert.match(p.query, /:find/);
  assert.deepEqual(Array.from(p.inputs), [":current-page"]);
  assert.equal(p.rules, null);
});
test("Logseq 2.0.1 built-in rules and dependencies are attached", () => {
  const p = planQuery(
    engine,
    '{:query [:find (pull ?b [*]) :where (task ?b #{"Todo"})]}',
  );
  assert.match(p.query, /:in \$ %/);
  assert.match(p.rules!, /ref-property-with-default/);
  assert.equal(p.inputs.length, 1);
});
test("custom rules retain user input and result transforms work", () => {
  const p = planQuery(
    engine,
    '{:query [:find ?b :in $ ?p % :where (title ?b ?p)] :inputs ["A"] :rules [[(title ?b ?p) [?b :block/title ?p]]] :result-transform (fn [r] (reverse r))}',
  );
  assert.equal(p.inputs[0], '"A"');
  assert.match(p.inputs[1], /title/);
  const result = applyQueryFunction(engine, p.transform!, [
    { title: "A" },
    { title: "B" },
  ]);
  assert.equal(result[0].title, "B");
});
test("custom views return hiccup data with proper Logseq entity keys", () => {
  const result = applyQueryFunction(
    engine,
    "(fn [r] [:table (for [b r] [:tr [:td (:block/title b)]])])",
    [queryEntity({ uuid: "u", id: 1, title: "Visible query result" })],
  );
  assert.equal(result[0], "table");
  assert.equal(result[1][0][1][1], "Visible query result");
});
test("rules in :inputs merge with automatic built-in rules", () => {
  const p = planQuery(
    engine,
    '{:query [:find ?b :in $ % :where (task ?b #{"Todo"}) (extra ?b)] :inputs [[[(extra ?b) [?b :block/title _]]]]}',
  );
  assert.match(p.inputs[0], /extra/);
  assert.match(p.inputs[0], /ref-property-with-default/, JSON.stringify(p));
});
