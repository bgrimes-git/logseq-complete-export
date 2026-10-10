import * as asar from "@electron/asar";
import { writeFileSync } from "node:fs";
const map = JSON.parse(asar.extractFile(process.argv[2], "js/main.js.map"));
let content;
function walk(m) {
  if (m.sections) for (const s of m.sections) walk(s.map);
  else
    for (let i = 0; i < (m.sources || []).length; i++)
      if (m.sources[i] === "logseq/db/frontend/rules.cljc")
        content = m.sourcesContent[i];
}
walk(map);
if (!content)
  throw new Error("Installed Logseq does not include the DB rules source.");
writeFileSync(new URL("../src/logseq-db-rules.cljc", import.meta.url), content);
