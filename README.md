# Complete Export for Logseq DB

Targets Logseq DB Desktop 2.0.1. Exports a block, branch, current or named page, or the visible graph to DOCX, PDF, interactive HTML, Markdown, and structured JSON. Nested block/page references and page/block embeds resolve recursively, including collapsed children. Circular and missing references produce visible notices and a companion report.

DB query definitions are read directly from `:logseq.property/query` nodes, which can be omitted by the regular block API. Simple queries run through Logseq's DSL API. Advanced queries run through its Datascript API with inputs, custom rules, and the built-in rule definitions from 2.0.1. A bundled SCI ClojureScript interpreter applies common result transforms and custom Hiccup views. Query execution failures stop the export instead of silently omitting sections. Exports are snapshots; queries do not remain live outside Logseq.

## Install

1. Download the ZIP attached to the [latest release](https://github.com/bgrimes-git/logseq-complete-export/releases/latest) and extract it into a dedicated folder. For a source checkout, run `npm ci` and `npm run build` instead.
2. Enable developer mode in Logseq DB's settings.
3. In Plugins, choose **Load unpacked plugin** and select this folder (not `dist` or `marketplace-master`).
4. Use **Complete Export** in the command palette, toolbar, page menu, or block context menu.

Settings persist across sessions. Default document margins are 0.35 inches on each side. Main text is black and background is white, independent of the theme. Accent colors can be selected and darkened. Explicit inline text colors are retained, except a sampled theme-default color when host DOM access is available; source background and layout styles are removed.

## Format behavior

| Format | Preserved behavior |
| --- | --- |
| DOCX | Editable text, basic Markdown formatting, tables, images, links, bookmarks and Word outline levels; no live Logseq queries |
| PDF | Selectable text, basic formatting, tables, embedded images, internal/external links and expanded outlines; static document |
| HTML | Self-contained embedded images, nested expand/collapse, internal navigation, external and Logseq links |
| Markdown | Text, nested outlines, Markdown syntax and Logseq links; DB image elements embed their image data and caption, with HTML image support depending on the Markdown reader |
| JSON | Resolved tree, UUIDs, properties, collapse state, options and notices; a portable snapshot, not a native Logseq backup |

Logseq links open the source graph when the application is installed. HTML and DOCX links point within the exported content when the destination is present. Graph export includes pages/classes/journals returned by the SDK, excluding hidden/property pages; it is a content export rather than a database backup.

Only the selected content is collected, including embeds and query sections within it. The separate linked-reference and unlinked-reference panels are not exported. Image sizing uses the visible host image width or saved resize metadata when available; otherwise DB image thumbnails default to at most 250 pixels. DOCX and PDF paginate normally when expanded content exceeds the selected paper size.

## Current limits

Custom renderer macros, whiteboard canvases, and arbitrary plugin widgets are not evaluated. Advanced query functions that depend on private frontend namespaces or unavailable libraries need compatibility work; failures are explicit. Standard Markdown tables and images are supported; image fetch failures produce notices. DB structured properties retain their SDK representation, including IDs where the SDK supplies IDs. Theme accent sampling depends on host DOM access; the color picker supplies a reliable fallback. PDF uses bundled Roboto; scripts outside that font's coverage require additional font support. Expanded documents are limited to 50,000 blocks and 80 levels to prevent runaway graphs. Page references may expand the graph substantially.

Build and resolver/export/query tests can be run outside Logseq (`npm run build`, `npm test`). `npm run test:browser` builds and checks all five download formats against a simulated DB graph, plus desktop/mobile screenshots, using installed Microsoft Edge. The installed Logseq DB version still needs a real-graph integration check, especially for DB embed/alias serialization and your query definitions. No graph content is changed by this plugin, and no export content is sent to a service. Remote images are fetched only to embed them in the output.

The plugin is AGPL-3.0-only because it includes Logseq's 2.0.1 query rules. See `THIRD_PARTY.md` for attribution.

## Preview

![Complete Export with a synthetic collection preview](docs/complete-export.png)

The demonstration uses synthetic notes, not a user's graph. It shows the plugin interface and export preview in a simulated Logseq host; it is not a screenshot of a running Logseq desktop window.
