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
test("Logseq tables without separators become Markdown tables", () => {
  const source =
    "| Item | Status | Detail |\n| A | Ready | <p>First<br>second</p> |\n| B | Waiting | Last |";
  const html = new MarkdownIt({ html: true }).render(tableSource(source));
  assert.match(html, /<table>/);
  assert.equal((html.match(/<th>/g) || []).length, 3);
  assert.equal((html.match(/<td>/g) || []).length, 6);
});
test("existing separator and alignment rows are never duplicated", () => {
  const existing = "| Item | Detail |\n| :--- | ---: |\n| A | B |";
  assert.equal(tableSource(existing), existing);
  const missing = "| Label | Value |\n| C | D |";
  const mixed = tableSource(existing + "\n\n" + missing);
  assert.equal(
    mixed,
    existing + "\n\n| Label | Value |\n| --- | --- |\n| C | D |",
  );
  assert.equal(
    (new MarkdownIt().render(mixed).match(/<table>/g) || []).length,
    2,
  );
});
test("wrapped table rows retain breaks within their cells", () => {
  const source = "| Item | Long\nheading |\n| A | First\nsecond |";
  const html = new MarkdownIt({ html: true }).render(tableSource(source));
  assert.match(html, /<table>/);
  assert.match(html, /Long<br>heading/);
  assert.match(html, /First<br>second/);
});
test("incomplete pipe text and mismatched rows remain literal", () => {
  for (const source of [
    "| A | B |",
    "| A | B |\n| C | D | E |",
    "| A | unfinished\n\nUnrelated note",
    "```\n| A | B |\n| C | D |\n```",
  ])
    assert.equal(tableSource(source), source);
});
