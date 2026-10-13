import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFString,
  PDFHexString,
  PDFNumber,
  PDFRef,
} from "pdf-lib";

export function preparePdfAnchors(root: HTMLElement) {
  const aliases = new Map<string, string>();
  const targets = new Map<HTMLElement, string>();
  for (const element of root.querySelectorAll<HTMLElement>("[id]")) {
    const candidates = element.matches(
      "p,h1,h2,h3,h4,h5,h6,li,figcaption,td,th",
    )
      ? [element]
      : Array.from(
          element.querySelectorAll<HTMLElement>(
            "p,h1,h2,h3,h4,h5,h6,li,figcaption,td,th",
          ),
        );
    const target = candidates.find(
      (leaf) =>
        leaf.textContent?.trim() && !leaf.classList.contains("empty-block"),
    );
    if (!target) continue;
    if (!targets.has(target)) targets.set(target, `ls_pdf_${targets.size + 1}`);
    aliases.set(element.id, targets.get(target)!);
  }
  for (const element of root.querySelectorAll("[id]"))
    element.removeAttribute("id");
  for (const [target, name] of targets) target.id = name;
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    const destination = aliases.get(link.getAttribute("href")!.slice(1));
    if (destination) link.setAttribute("href", `#${destination}`);
    else if (link.dataset.source)
      link.setAttribute("href", link.dataset.source);
    else link.removeAttribute("href");
  }
}

export function normalizePdfAnchors(
  node: any,
  seen = new WeakSet<object>(),
): void {
  if (!node || typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);
  for (const value of Object.values(node)) normalizePdfAnchors(value, seen);
  if (!node.id || node.text !== undefined) return;
  const id = node.id;
  delete node.id;
  function assign(value: any): boolean {
    if (!value || typeof value !== "object") return false;
    if (value.text !== undefined) {
      value.id = id;
      return true;
    }
    return Object.values(value).some(assign);
  }
  assign(node);
}

export async function validatePdf(blob: Blob): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const fail = (reason: string): never => {
    throw new Error(`PDF validation failed: ${reason}. No file was saved.`);
  };
  if (!/^%PDF-1\.[4-7]/.test(new TextDecoder().decode(bytes.slice(0, 8))))
    fail("unsupported or missing PDF header");
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, {
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
  } catch {
    return fail("unreadable PDF structure");
  }
  const pages = document.getPages();
  if (!pages.length) fail("no pages");
  const pageIds = new Set(pages.map((p) => p.ref.toString()));
  const destinations = new Map<string, PDFArray>();
  const context = document.context;
  function label(value: any): string {
    if (
      value instanceof PDFString ||
      value instanceof PDFHexString ||
      value instanceof PDFName
    )
      return value.decodeText();
    return fail("invalid destination name");
  }
  const seen = new Set<PDFDict>();
  function readNames(tree: PDFDict) {
    if (seen.has(tree)) fail("circular destination tree");
    seen.add(tree);
    const entries = tree.lookupMaybe(PDFName.of("Names"), PDFArray);
    if (entries) {
      if (entries.size() % 2) fail("invalid destination tree");
      for (let i = 0; i < entries.size(); i += 2) {
        const name = label(entries.lookup(i));
        let value: any = entries.lookup(i + 1);
        if (value instanceof PDFDict) value = value.lookup(PDFName.of("D"));
        if (!(value instanceof PDFArray) || destinations.has(name))
          fail("invalid or duplicate destination");
        destinations.set(name, value);
      }
    }
    const kids = tree.lookupMaybe(PDFName.of("Kids"), PDFArray);
    if (kids)
      for (let i = 0; i < kids.size(); i++) readNames(kids.lookup(i, PDFDict));
  }
  const names = document.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const tree = names?.lookupMaybe(PDFName.of("Dests"), PDFDict);
  if (tree) readNames(tree);
  function checkDestination(value: any) {
    const destination =
      value instanceof PDFArray ? value : destinations.get(label(value));
    if (!destination) return fail("internal link has no destination");
    const page = destination.get(0);
    if (!(page instanceof PDFRef) || !pageIds.has(page.toString()))
      fail("destination points outside the document");
  }
  for (const destination of destinations.values())
    checkDestination(destination);
  for (const page of pages) {
    const { width, height } = page.getSize();
    if (
      ![width, height].every((n) => Number.isFinite(n) && n > 0 && n <= 20000)
    )
      fail("invalid page dimensions");
    const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annotations) continue;
    for (let i = 0; i < annotations.size(); i++) {
      const annotation = annotations.lookup(i, PDFDict);
      const rectangle = annotation.lookupMaybe(PDFName.of("Rect"), PDFArray);
      if (!rectangle || rectangle.size() !== 4)
        fail("invalid annotation rectangle");
      for (let j = 0; j < 4; j++)
        if (!Number.isFinite(rectangle!.lookup(j, PDFNumber).asNumber()))
          fail("non-finite annotation coordinate");
      const action = annotation.lookupMaybe(PDFName.of("A"), PDFDict);
      if (action?.lookupMaybe(PDFName.of("S"), PDFName)?.asString() === "/GoTo")
        checkDestination(action.lookup(PDFName.of("D")));
      const destination = annotation.get(PDFName.of("Dest"));
      if (destination) checkDestination(context.lookup(destination));
    }
  }
}
