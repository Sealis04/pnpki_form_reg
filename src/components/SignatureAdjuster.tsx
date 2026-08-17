"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { findInkBounds } from "~/lib/pdf";

export type Rect = { x: number; y: number; w: number; h: number };

type Props = {
  /** Raw source data URL (from draw pad or upload). */
  source: string;
  /** Called with the cropped data URL whenever the crop is applied. */
  onChange: (dataUrl: string) => void;
  /**
   * Auto-fit strategy. Defaults to detecting ink bounds (best for signatures).
   * Pass a different function for non-ink images (e.g. passport photos).
   */
  autoFit?: (img: HTMLImageElement) => Rect;
  /**
   * When set, the crop is locked to this width/height ratio during resize and
   * auto-fit. Edge handles are hidden so dragging always preserves the ratio.
   */
  aspectRatio?: number;
  /**
   * When set, the exported image is always rendered at this fixed pixel size
   * (must match `aspectRatio`), regardless of how many native pixels the crop
   * box currently spans. This decouples "size visible in the document" (the
   * crop box, adjusted by dragging corners) from output resolution, so
   * zooming in tightly never shrinks the exported image below print quality.
   * Without it, output resolution equals the crop box's native pixel size.
   */
  outputSize?: { w: number; h: number };
  /**
   * When set (and `outputSize` is not), the exported image's longer side is
   * upscaled to at least this many pixels if the crop box's native pixels
   * fall short — preserving the crop's aspect ratio. Use this for freeform
   * crops (no fixed `aspectRatio`, e.g. signatures) so tightening the crop
   * box or auto-fitting to a small ink region doesn't leave the exported
   * image too small to look sharp once placed in the document.
   */
  minOutputLongEdge?: number;
  /** Override the helper text shown above the canvas. */
  helperText?: string;
};

/**
 * Resolves the actual output canvas size for a crop rect, given the fixed
 * `outputSize` (locked-aspect case) or `minOutputLongEdge` (freeform case)
 * export options. Shared by `emitCrop` and the on-screen size readout so
 * they never disagree about what will actually be exported.
 */
function resolveOutputSize(
  c: Rect,
  outputSize: { w: number; h: number } | undefined,
  minOutputLongEdge: number | undefined,
): { w: number; h: number } {
  if (outputSize) return outputSize;
  let w = Math.max(1, Math.round(c.w));
  let h = Math.max(1, Math.round(c.h));
  if (minOutputLongEdge) {
    const longEdge = Math.max(w, h);
    if (longEdge > 0 && longEdge < minOutputLongEdge) {
      const scale = minOutputLongEdge / longEdge;
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
    }
  }
  return { w, h };
}

type HandleKind = "tl" | "tr" | "bl" | "br" | "t" | "b" | "l" | "r" | "move";
type ResizeHandle = Exclude<HandleKind, "move">;

const CORNER_HANDLES: ResizeHandle[] = ["tl", "tr", "bl", "br"];
const ALL_HANDLES: ResizeHandle[] = [
  "tl",
  "tr",
  "bl",
  "br",
  "t",
  "b",
  "l",
  "r",
];

const HANDLE_SIZE = 10;
const CANVAS_MAX_W = 520;
const CANVAS_MAX_H = 240;
const AUTO_PAD = 4;

const HANDLE_CURSORS: Record<HandleKind, string> = {
  tl: "nwse-resize",
  br: "nwse-resize",
  tr: "nesw-resize",
  bl: "nesw-resize",
  t: "ns-resize",
  b: "ns-resize",
  l: "ew-resize",
  r: "ew-resize",
  move: "move",
};

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function getHandlePositions(x: number, y: number, w: number, h: number) {
  return {
    tl: { x, y },
    tr: { x: x + w, y },
    bl: { x, y: y + h },
    br: { x: x + w, y: y + h },
    t: { x: x + w / 2, y },
    b: { x: x + w / 2, y: y + h },
    l: { x, y: y + h / 2 },
    r: { x: x + w, y: y + h / 2 },
  } as const;
}

function computeInkAutoCrop(img: HTMLImageElement): Rect {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const fallback: Rect = { x: 0, y: 0, w, h };
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return fallback;
  ctx.drawImage(img, 0, 0);
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    return fallback;
  }
  const bounds = findInkBounds(data);
  if (!bounds) return fallback;
  return {
    x: Math.max(0, bounds.x - AUTO_PAD),
    y: Math.max(0, bounds.y - AUTO_PAD),
    w: Math.min(w, bounds.width + AUTO_PAD * 2),
    h: Math.min(h, bounds.height + AUTO_PAD * 2),
  };
}

/**
 * Centered crop matching `aspectRatio` (= width / height), as large as fits
 * inside the image. Useful for documents that demand a fixed photo aspect
 * such as the 35x45mm passport frame on the PNPKI form.
 */
export function computeAspectAutoCrop(
  img: HTMLImageElement,
  aspectRatio: number,
): Rect {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  let cw = w;
  let ch = cw / aspectRatio;
  if (ch > h) {
    ch = h;
    cw = ch * aspectRatio;
  }
  return {
    x: Math.round((w - cw) / 2),
    y: Math.round((h - ch) / 2),
    w: Math.round(cw),
    h: Math.round(ch),
  };
}

export default function SignatureAdjuster({
  source,
  onChange,
  autoFit,
  aspectRatio,
  outputSize,
  minOutputLongEdge,
  helperText,
}: Props) {
  const computeAutoCrop = autoFit ?? computeInkAutoCrop;
  const visibleHandles = useMemo(
    () => (aspectRatio ? CORNER_HANDLES : ALL_HANDLES),
    [aspectRatio],
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [dragging, setDragging] = useState<{
    kind: HandleKind;
    startPointer: { x: number; y: number };
    startRect: Rect;
  } | null>(null);
  const [hoverCursor, setHoverCursor] = useState<string>("default");

  const emitCrop = useCallback(
    (c: Rect) => {
      const img = imgRef.current;
      if (!img) return;
      const { w: outW, h: outH } = resolveOutputSize(
        c,
        outputSize,
        minOutputLongEdge,
      );
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // Source rect (c) always comes from the crop box in native image
      // pixels; the destination is the resolved output size, so shrinking
      // the crop box (zooming in) scales up into that canvas instead of
      // shrinking the exported pixel count.
      ctx.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, outW, outH);
      onChange(canvas.toDataURL("image/png"));
    },
    [onChange, outputSize, minOutputLongEdge],
  );

  // emitCrop/computeAutoCrop are read via refs (not effect deps) below so
  // that a caller passing new callback/object identities each render (e.g.
  // an inline `outputSize`) can't retrigger this effect and silently reset
  // an in-progress crop back to the auto-fit default.
  const emitCropRef = useRef(emitCrop);
  useEffect(() => {
    emitCropRef.current = emitCrop;
  }, [emitCrop]);
  const computeAutoCropRef = useRef(computeAutoCrop);
  useEffect(() => {
    computeAutoCropRef.current = computeAutoCrop;
  }, [computeAutoCrop]);

  // Load the image whenever the source changes; seed an auto-fit crop.
  useEffect(() => {
    if (!source) {
      imgRef.current = null;
      setImgSize(null);
      setCrop(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      if (!img.naturalWidth || !img.naturalHeight) return;
      imgRef.current = img;
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
      const initial = computeAutoCropRef.current(img);
      setCrop(initial);
      emitCropRef.current(initial);
    };
    img.onerror = () => {
      if (!cancelled) console.warn("SignatureAdjuster: image failed to load");
    };
    img.src = source;
    return () => {
      cancelled = true;
    };
  }, [source]);

  const displayScale = useMemo(() => {
    if (!imgSize) return 1;
    return Math.min(CANVAS_MAX_W / imgSize.w, CANVAS_MAX_H / imgSize.h, 1);
  }, [imgSize]);

  // Repaint the preview whenever crop or size changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgSize || !crop) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const displayW = imgSize.w * displayScale;
    const displayH = imgSize.h * displayScale;
    canvas.width = Math.round(displayW * ratio);
    canvas.height = Math.round(displayH * ratio);
    canvas.style.width = `${displayW}px`;
    canvas.style.height = `${displayH}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, displayW, displayH);

    // Checkerboard background to hint transparency.
    const tile = 8;
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, displayW, displayH);
    ctx.fillStyle = "#e2e8f0";
    for (let y = 0; y < displayH; y += tile) {
      for (let x = 0; x < displayW; x += tile) {
        if ((Math.floor(x / tile) + Math.floor(y / tile)) % 2 === 0) {
          ctx.fillRect(x, y, tile, tile);
        }
      }
    }

    ctx.drawImage(img, 0, 0, displayW, displayH);

    const cx = crop.x * displayScale;
    const cy = crop.y * displayScale;
    const cw = crop.w * displayScale;
    const ch = crop.h * displayScale;

    // Dim the area outside the crop.
    ctx.fillStyle = "rgba(15, 23, 42, 0.45)";
    ctx.fillRect(0, 0, displayW, cy);
    ctx.fillRect(0, cy + ch, displayW, displayH - (cy + ch));
    ctx.fillRect(0, cy, cx, ch);
    ctx.fillRect(cx + cw, cy, displayW - (cx + cw), ch);

    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2;
    ctx.strokeRect(cx, cy, cw, ch);

    const positions = getHandlePositions(cx, cy, cw, ch);
    const s = HANDLE_SIZE;
    const hs = s / 2;
    ctx.fillStyle = "#10b981";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    for (const k of visibleHandles) {
      const pos = positions[k];
      ctx.fillRect(pos.x - hs, pos.y - hs, s, s);
      ctx.strokeRect(pos.x - hs, pos.y - hs, s, s);
    }

    ctx.restore();
  }, [crop, imgSize, displayScale, visibleHandles]);

  const hitTest = useCallback(
    (px: number, py: number): HandleKind | null => {
      if (!crop) return null;
      const cx = crop.x * displayScale;
      const cy = crop.y * displayScale;
      const cw = crop.w * displayScale;
      const ch = crop.h * displayScale;
      const positions = getHandlePositions(cx, cy, cw, ch);
      const tolerance = HANDLE_SIZE;
      for (const k of visibleHandles) {
        const pos = positions[k];
        if (Math.abs(px - pos.x) <= tolerance && Math.abs(py - pos.y) <= tolerance) {
          return k;
        }
      }
      if (px >= cx && px <= cx + cw && py >= cy && py <= cy + ch) return "move";
      return null;
    },
    [crop, displayScale, visibleHandles],
  );

  const pointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!crop) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const kind = hitTest(px, py);
    if (!kind) return;
    canvas.setPointerCapture(e.pointerId);
    setDragging({ kind, startPointer: { x: px, y: py }, startRect: { ...crop } });
  };

  const pointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (!dragging) {
      const kind = hitTest(px, py);
      setHoverCursor(kind ? HANDLE_CURSORS[kind] : "default");
      return;
    }

    if (!imgSize) return;
    const dx = (px - dragging.startPointer.x) / displayScale;
    const dy = (py - dragging.startPointer.y) / displayScale;
    const start = dragging.startRect;
    const minSide = 2;
    const next: Rect = { ...start };

    if (aspectRatio && dragging.kind !== "move") {
      // Aspect-locked corner resize: anchor on the opposite corner; size grows
      // from drag distance and is clamped to image bounds without breaking the
      // ratio.
      const minH = minSide / aspectRatio;
      switch (dragging.kind) {
        case "br": {
          const ax = start.x;
          const ay = start.y;
          let w = clamp(start.w + dx, minSide, imgSize.w - ax);
          let h = w / aspectRatio;
          if (h > imgSize.h - ay) {
            h = imgSize.h - ay;
            w = h * aspectRatio;
          }
          next.x = ax;
          next.y = ay;
          next.w = w;
          next.h = Math.max(h, minH);
          break;
        }
        case "tl": {
          const ax = start.x + start.w;
          const ay = start.y + start.h;
          let w = clamp(start.w - dx, minSide, ax);
          let h = w / aspectRatio;
          if (h > ay) {
            h = ay;
            w = h * aspectRatio;
          }
          next.w = w;
          next.h = Math.max(h, minH);
          next.x = ax - next.w;
          next.y = ay - next.h;
          break;
        }
        case "tr": {
          const ax = start.x;
          const ay = start.y + start.h;
          let w = clamp(start.w + dx, minSide, imgSize.w - ax);
          let h = w / aspectRatio;
          if (h > ay) {
            h = ay;
            w = h * aspectRatio;
          }
          next.x = ax;
          next.w = w;
          next.h = Math.max(h, minH);
          next.y = ay - next.h;
          break;
        }
        case "bl": {
          const ax = start.x + start.w;
          const ay = start.y;
          let w = clamp(start.w - dx, minSide, ax);
          let h = w / aspectRatio;
          if (h > imgSize.h - ay) {
            h = imgSize.h - ay;
            w = h * aspectRatio;
          }
          next.y = ay;
          next.w = w;
          next.h = Math.max(h, minH);
          next.x = ax - next.w;
          break;
        }
      }
      setCrop(next);
      return;
    }

    switch (dragging.kind) {
      case "move":
        next.x = clamp(start.x + dx, 0, imgSize.w - start.w);
        next.y = clamp(start.y + dy, 0, imgSize.h - start.h);
        break;
      case "tl": {
        const nx = clamp(start.x + dx, 0, start.x + start.w - minSide);
        const ny = clamp(start.y + dy, 0, start.y + start.h - minSide);
        next.x = nx;
        next.y = ny;
        next.w = start.x + start.w - nx;
        next.h = start.y + start.h - ny;
        break;
      }
      case "tr": {
        const ny = clamp(start.y + dy, 0, start.y + start.h - minSide);
        next.y = ny;
        next.h = start.y + start.h - ny;
        next.w = clamp(start.w + dx, minSide, imgSize.w - start.x);
        break;
      }
      case "bl": {
        const nx = clamp(start.x + dx, 0, start.x + start.w - minSide);
        next.x = nx;
        next.w = start.x + start.w - nx;
        next.h = clamp(start.h + dy, minSide, imgSize.h - start.y);
        break;
      }
      case "br":
        next.w = clamp(start.w + dx, minSide, imgSize.w - start.x);
        next.h = clamp(start.h + dy, minSide, imgSize.h - start.y);
        break;
      case "t": {
        const ny = clamp(start.y + dy, 0, start.y + start.h - minSide);
        next.y = ny;
        next.h = start.y + start.h - ny;
        break;
      }
      case "b":
        next.h = clamp(start.h + dy, minSide, imgSize.h - start.y);
        break;
      case "l": {
        const nx = clamp(start.x + dx, 0, start.x + start.w - minSide);
        next.x = nx;
        next.w = start.x + start.w - nx;
        break;
      }
      case "r":
        next.w = clamp(start.w + dx, minSide, imgSize.w - start.x);
        break;
    }
    setCrop(next);
  };

  const pointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    if (dragging && crop) emitCrop(crop);
    setDragging(null);
  };

  const applyAutoFit = () => {
    const img = imgRef.current;
    if (!img) return;
    const next = computeAutoCrop(img);
    setCrop(next);
    emitCrop(next);
  };

  if (!source || !imgSize || !crop) return null;

  const exported = resolveOutputSize(crop, outputSize, minOutputLongEdge);
  const isUpscaled =
    exported.w > crop.w + 0.5 || exported.h > crop.h + 0.5;

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 text-xs text-slate-600">
        {helperText ??
          "Drag the green corners or edges to adjust the signature area. The cropped region is used on your form."}
      </p>
      <canvas
        ref={canvasRef}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        style={{ cursor: dragging ? HANDLE_CURSORS[dragging.kind] : hoverCursor }}
        className="block touch-none select-none rounded border border-slate-300 bg-white"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={applyAutoFit}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Auto-fit
        </button>
        <span className="text-xs text-slate-500">
          {isUpscaled
            ? `${Math.round(crop.w)} × ${Math.round(crop.h)} px selected → exported at ${exported.w} × ${exported.h} px`
            : `${Math.round(crop.w)} × ${Math.round(crop.h)} px`}
        </span>
      </div>
      {isUpscaled && (
        <p className="mt-1 text-xs text-amber-600">
          Zoomed in past the source image&apos;s native resolution — the
          exported image may look soft. Zoom out (drag the handles outward)
          for a sharper result.
        </p>
      )}
    </div>
  );
}
