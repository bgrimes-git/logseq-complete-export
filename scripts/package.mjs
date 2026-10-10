import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { zipSync, strToU8 } from "fflate";

const files = {};
async function add(path) {
  if ((await stat(path)).isDirectory()) {
    for (const name of await readdir(path)) await add(join(path, name));
  } else {
    files[relative(process.cwd(), path).replaceAll("\\", "/")] = new Uint8Array(
      await readFile(path),
    );
  }
}
for (const path of ["dist", "docs", "README.md", "LICENSE", "THIRD_PARTY.md"])
  await add(join(process.cwd(), path));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
files["package.json"] = strToU8(JSON.stringify(pkg, null, 2));
await mkdir("releases", { recursive: true });
const output = `releases/${pkg.name}-v${pkg.version}.zip`;
await writeFile(output, zipSync(files, { level: 6 }));
console.log(output);
