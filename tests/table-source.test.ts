import { test } from "node:test";
import assert from "node:assert/strict";
import MarkdownIt from "markdown-it";
import { tableSource } from "../src/table-source";

test("paragraphs and line breaks stay inside table cells", () => {
  const source =
    "| Control | Detail |\n| --- | --- |\n| A | <p>First\nparagraph</p><p>Second<br>line</p> |\n| B | Last |";
  const html = new MarkdownIt({ html: true }).render(tableSource(source));
  assert.match(html, /<table>/);
  assert.match(html, /First paragraph<\/span><br><span>Second<br>line/);
  assert.equal((html.match(/<tr>/g) || []).length, 3);
});
test("unclosed paragraphs do not consume subsequent blocks", () => {
  const source = "| A | <p>Unclosed |\n\nNext note\n| B | Next |";
  assert.equal(tableSource(source), source);
});
test("pipe examples in code remain unchanged", () => {
  const source = "```text\n| A | <p>Example</p> |\n```";
  assert.equal(tableSource(source), source);
});
