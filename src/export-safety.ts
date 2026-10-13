import { unzipSync, strFromU8 } from "fflate";
import { cleanText, type DocumentData } from "./model";

export function prepareExport(data: DocumentData): DocumentData {
  let changed = false;
  const seen = new WeakSet<object>();
  function clean(value: any): any {
    if (typeof value === "string") {
      const text = cleanText(value);
      changed ||= text !== value;
      return text;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return value;
    seen.add(value);
    for (const key of Object.keys(value)) value[key] = clean(value[key]);
    return value;
  }
  const copy = clean(structuredClone(data)) as DocumentData;
  if (
    changed &&
    !data.warnings.includes(
      "Unsupported control characters were removed from the export.",
    )
  )
    data.warnings.push(
      "Unsupported control characters were removed from the export.",
    );
  copy.warnings = data.warnings;
  return copy;
}

export function prepareDocxAnchors(root: HTMLElement) {
  const targets = new Map<string, string>();
  for (const element of root.querySelectorAll<HTMLElement>("[id]")) {
    const leaf = element.matches("p,h1,h2,h3,h4,h5,h6,li,figcaption,img,td,th")
      ? element
      : element.querySelector<HTMLElement>(
          "p:not(.empty-block),h1,h2,h3,h4,h5,h6,li,figcaption,img,td,th",
        );
    if (!leaf || leaf.classList.contains("empty-block")) continue;
    const target = leaf.closest<HTMLElement>("td,th") ?? leaf;
    const name = `ls_b_${targets.size + 1}`;
    targets.set(element.id, name);
    const names: string[] = JSON.parse(target.dataset.docxBookmarks ?? "[]");
    target.dataset.docxBookmarks = JSON.stringify([...names, name]);
  }
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    const name = targets.get(link.getAttribute("href")!.slice(1));
    if (name) link.setAttribute("href", `#${name}`);
    else if (link.dataset.source)
      link.setAttribute("href", link.dataset.source);
    else link.removeAttribute("href");
  }
}

export async function validateDocx(blob: Blob): Promise<void> {
  const parts = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  if (!parts["[Content_Types].xml"] || !parts["word/document.xml"])
    throw new Error(
      "DOCX validation failed: missing required package parts. No file was saved.",
    );
  const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  for (const [name, bytes] of Object.entries(parts)) {
    if (!/\.(xml|rels)$/.test(name)) continue;
    const xml = new DOMParser().parseFromString(
      strFromU8(bytes),
      "application/xml",
    );
    if (xml.querySelector("parsererror"))
      throw new Error(
        `DOCX validation failed: malformed XML in ${name}. No file was saved.`,
      );
    if (name.endsWith(".rels")) {
      const ids = new Set<string>();
      const source =
        name === "_rels/.rels"
          ? ""
          : name.replace("/_rels/", "/").replace(/\.rels$/, "");
      for (const rel of Array.from(xml.getElementsByTagName("Relationship"))) {
        const id = rel.getAttribute("Id") ?? "";
        if (!id || ids.has(id))
          throw new Error(
            "DOCX validation failed: duplicate relationship. No file was saved.",
          );
        ids.add(id);
        if (rel.getAttribute("TargetMode") === "External") continue;
        const path = decodeURIComponent(
          new URL(
            rel.getAttribute("Target") ?? "",
            `https://package/${source}`,
          ).pathname.slice(1),
        );
        if (!parts[path])
          throw new Error(
            "DOCX validation failed: missing relationship target. No file was saved.",
          );
      }
    }
    const starts = Array.from(xml.getElementsByTagNameNS(w, "bookmarkStart"));
    const ends = Array.from(xml.getElementsByTagNameNS(w, "bookmarkEnd"));
    const ids = new Set<string>(),
      names = new Set<string>();
    for (const start of starts) {
      const id = start.getAttributeNS(w, "id") ?? "";
      const bookmark = start.getAttributeNS(w, "name") ?? "";
      if (
        !/^\d+$/.test(id) ||
        ids.has(id) ||
        !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(bookmark) ||
        names.has(bookmark)
      )
        throw new Error(
          "DOCX validation failed: invalid or duplicate bookmark. No file was saved.",
        );
      ids.add(id);
      names.add(bookmark);
    }
    const remaining = new Set(ids);
    for (const end of ends) {
      if (!remaining.delete(end.getAttributeNS(w, "id") ?? ""))
        throw new Error(
          "DOCX validation failed: unmatched bookmark. No file was saved.",
        );
    }
    if (remaining.size)
      throw new Error(
        "DOCX validation failed: missing bookmark end. No file was saved.",
      );
    for (const link of Array.from(xml.getElementsByTagNameNS(w, "hyperlink"))) {
      const anchor = link.getAttributeNS(w, "anchor");
      if (anchor && !names.has(anchor))
        throw new Error(
          "DOCX validation failed: unresolved internal link. No file was saved.",
        );
    }
  }
}
