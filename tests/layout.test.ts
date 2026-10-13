import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { outlineStep, tableWidths } from "../src/layout";
test("short table columns get less width than detailed columns", () => {
  const root = new JSDOM(
    "<table><tr><th>ID</th><th>State</th><th>Notes</th></tr><tr><td>1</td><td>Ready</td><td>A longer description of the next steps for the group.</td></tr></table>",
  ).window.document;
  const widths = tableWidths(root.querySelector("table")!);
  assert.ok(widths[0] < widths[2] / 3);
  assert.ok(Math.abs(widths.reduce((a, b) => a + b) - 100) < 0.001);
});
test("deep outlines use a smaller step without flattening levels", () => {
  const root = new JSDOM(
    "<main>" +
      '<div class="children">'.repeat(80) +
      "Note" +
      "</div>".repeat(80) +
      "</main>",
  ).window.document.querySelector("main")!;
  assert.equal(outlineStep(root, 500), 2.5);
  assert.equal(
    outlineStep(
      new JSDOM(
        '<main><div class="children">Note</div></main>',
      ).window.document.querySelector("main")!,
      500,
    ),
    15,
  );
});
test("header words reserve width while explicit header breaks keep columns compact", () => {
  const doc = new JSDOM(
    "<table><tr><th>Record #</th><th>Delivery<br>Readiness</th><th>Details</th></tr><tr><td>1</td><td>Possible</td><td>" +
      "Several steps need explanation. ".repeat(20) +
      "</td></tr></table>",
  ).window.document;
  const widths = tableWidths(doc.querySelector("table")!, 500);
  assert.ok(
    widths[0] * 5 >= 51,
    "Record must fit as a whole word plus padding",
  );
  assert.ok(
    widths[1] < 25,
    "A two-line header should not consume paragraph-column space",
  );
  assert.ok(widths[2] > widths[1] * 2);
});
