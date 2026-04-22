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

/**
 * Crop the transparent / near-white margin around a signature image so the
 * actual ink fills the frame. Treats a pixel as "ink" when it is sufficiently
 * opaque AND not near-white — this covers both transparent-background PNGs
 * (from the draw pad) and white-background JPEG/PNG uploads. Returns the
 * original data URL if nothing ink-like is found.
 */
export async function trimSignatureDataUrl(
  dataUrl: string,
  options: { padding?: number; alphaThreshold?: number; whiteThreshold?: number } = {},
): Promise<string> {
  const padding = options.padding ?? 4;
  const alphaThreshold = options.alphaThreshold ?? 10;
  const whiteThreshold = options.whiteThreshold ?? 245;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Signature image failed to load"));
    el.src = dataUrl;
  });

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return dataUrl;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0);

  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    return dataUrl;
  }

  const px = data.data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = px[i]!;
      const g = px[i + 1]!;
      const b = px[i + 2]!;
      const a = px[i + 3]!;
      const isInk =
        a > alphaThreshold &&
        (r < whiteThreshold || g < whiteThreshold || b < whiteThreshold);
      if (isInk) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return dataUrl;

  const x0 = Math.max(0, minX - padding);
  const y0 = Math.max(0, minY - padding);
  const x1 = Math.min(w, maxX + 1 + padding);
  const y1 = Math.min(h, maxY + 1 + padding);
  const tw = x1 - x0;
  const th = y1 - y0;

  const out = document.createElement("canvas");
  out.width = tw;
  out.height = th;
  const octx = out.getContext("2d");
  if (!octx) return dataUrl;
  octx.drawImage(canvas, x0, y0, tw, th, 0, 0, tw, th);
  return out.toDataURL("image/png");
}
