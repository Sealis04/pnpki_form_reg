import {
  PDFDocument,
  PDFPage,
  PDFArray,
  PDFName,
  type PDFRef,
} from "pdf-lib";

/**
 * Locate the page that a widget annotation is drawn on. Tries the widget's
 * `/P` reference first, then falls back to scanning every page's `/Annots`
 * array for the widget ref. Returns the first page as a last resort.
 */
export function findPageForWidget(
  doc: PDFDocument,
  widget: {
    P?: () => PDFRef | undefined;
    ref?: PDFRef;
  },
): PDFPage {
  const pages = doc.getPages();

  // 1) Try widget.P()
  try {
    const pRef = widget.P?.();
    if (pRef) {
      const match = pages.find((pg) => pg.ref === pRef);
      if (match) return match;
    }
  } catch {
    /* ignore */
  }

  // 2) Scan each page's /Annots array for the widget ref
  const widgetRef = widget.ref;
  if (widgetRef) {
    for (const page of pages) {
      const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (!annots) continue;
      for (let i = 0; i < annots.size(); i++) {
        const entry = annots.get(i);
        if (entry === widgetRef) return page;
      }
    }
  }

  return pages[0]!;
}

/** Convert a `data:image/png;base64,...` URL into raw bytes. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
