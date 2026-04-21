"use client";

import { useEffect, useRef, useState } from "react";
import type SignaturePadLib from "signature_pad";

type Props = {
  onChange: (dataUrl: string) => void;
  height?: number;
};

export default function SignaturePad({ onChange, height = 200 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = await import("signature_pad");
      if (cancelled || !canvasRef.current) return;
      const canvas = canvasRef.current;

      // Handle HiDPI displays so strokes aren't blurry.
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      const ctx = canvas.getContext("2d");
      ctx?.scale(ratio, ratio);

      const pad = new mod.default(canvas, {
        minWidth: 0.6,
        maxWidth: 2.2,
        penColor: "#111827",
        backgroundColor: "rgba(255,255,255,0)",
      });

      pad.addEventListener("endStroke", () => {
        const isEmpty = pad.isEmpty();
        setEmpty(isEmpty);
        if (!isEmpty) onChange(pad.toDataURL("image/png"));
      });

      padRef.current = pad;
    })();

    return () => {
      cancelled = true;
      padRef.current?.off();
      padRef.current = null;
    };
  }, [onChange]);

  const clear = () => {
    padRef.current?.clear();
    setEmpty(true);
    onChange("");
  };

  return (
    <div>
      <div className="rounded-lg border border-dashed border-slate-300 bg-white">
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height, display: "block" }}
          className="touch-none"
        />
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={clear}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Clear
        </button>
        <span className="text-xs text-slate-500">
          {empty
            ? "Sign with mouse, finger, or stylus."
            : "Signature captured."}
        </span>
      </div>
    </div>
  );
}
