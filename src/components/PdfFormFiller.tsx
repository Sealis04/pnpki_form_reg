"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
  PDFSignature,
  type PDFField,
} from "pdf-lib";
import SignaturePad from "./SignaturePad";
import { dataUrlToBytes, findPageForWidget } from "~/lib/pdf";

type FieldType =
  | "text"
  | "checkbox"
  | "radio"
  | "dropdown"
  | "optionList"
  | "signature"
  | "unknown";

type FieldMeta = {
  name: string;
  type: FieldType;
  options?: string[];
};

type FieldValues = Record<string, string | boolean | string[]>;
type SignatureImages = Record<string, string>;

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const DEFAULT_FORM_URL = `${BASE_PATH}/form.pdf`;

const SIGNATURE_NAME_PATTERN = /signature|signatory|\bsign\b|initial/i;

function classifyField(field: PDFField): FieldMeta {
  const name = field.getName();
  if (field instanceof PDFSignature) return { name, type: "signature" };
  if (field instanceof PDFTextField) return { name, type: "text" };
  if (field instanceof PDFCheckBox) return { name, type: "checkbox" };
  if (field instanceof PDFRadioGroup)
    return { name, type: "radio", options: field.getOptions() };
  if (field instanceof PDFDropdown)
    return { name, type: "dropdown", options: field.getOptions() };
  if (field instanceof PDFOptionList)
    return { name, type: "optionList", options: field.getOptions() };
  return { name, type: "unknown" };
}

export default function PdfFormFiller() {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [fields, setFields] = useState<FieldMeta[]>([]);
  const [values, setValues] = useState<FieldValues>({});
  const [signatures, setSignatures] = useState<SignatureImages>({});
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const loadPdf = useCallback(async (bytes: Uint8Array) => {
    setError("");
    setStatus("Parsing PDF...");
    try {
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const form = doc.getForm();
      const metas = form.getFields().map(classifyField);

      setPdfBytes(bytes);
      setFields(metas);
      setValues(() => {
        const next: FieldValues = {};
        for (const m of metas) {
          if (m.type === "checkbox") next[m.name] = false;
          else if (m.type === "optionList") next[m.name] = [];
          else next[m.name] = "";
        }
        return next;
      });
      setSignatures({});
      setStatus(
        metas.length > 0
          ? `Loaded ${metas.length} fillable field${metas.length === 1 ? "" : "s"}.`
          : "Loaded PDF, but no AcroForm fillable fields were found. Upload a PDF that has fillable boxes.",
      );
    } catch (e) {
      console.error(e);
      setError(
        `Failed to parse PDF: ${e instanceof Error ? e.message : String(e)}`,
      );
      setStatus("");
    }
  }, []);

  const handleUpload = async (file: File) => {
    const buf = new Uint8Array(await file.arrayBuffer());
    await loadPdf(buf);
  };

  const loadDefault = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(DEFAULT_FORM_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      await loadPdf(buf);
    } catch (e) {
      setError(
        `Could not load bundled form at ${DEFAULT_FORM_URL}. Upload a PDF instead. (${
          e instanceof Error ? e.message : String(e)
        })`,
      );
    } finally {
      setLoading(false);
    }
  }, [loadPdf]);

  // Try to auto-load a bundled form.pdf on mount (stays silent if missing).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(DEFAULT_FORM_URL);
        if (!active || !res.ok) return;
        const buf = new Uint8Array(await res.arrayBuffer());
        if (active) await loadPdf(buf);
      } catch {
        /* silently ignore - user can still upload */
      }
    })();
    return () => {
      active = false;
    };
  }, [loadPdf]);

  const signatureFields = useMemo(
    () =>
      fields.filter(
        (f) => f.type === "signature" || SIGNATURE_NAME_PATTERN.test(f.name),
      ),
    [fields],
  );

  const nonSignatureFields = useMemo(
    () => fields.filter((f) => !signatureFields.some((sf) => sf.name === f.name)),
    [fields, signatureFields],
  );

  const updateValue = (name: string, v: string | boolean | string[]) =>
    setValues((prev) => ({ ...prev, [name]: v }));

  const generate = async () => {
    if (!pdfBytes) return;
    setError("");
    setStatus("Generating filled PDF...");
    try {
      const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const form = doc.getForm();

      // 1) Set values on every non-signature field.
      for (const meta of nonSignatureFields) {
        try {
          const v = values[meta.name];
          if (meta.type === "text" && typeof v === "string") {
            form.getTextField(meta.name).setText(v);
          } else if (meta.type === "checkbox" && typeof v === "boolean") {
            const cb = form.getCheckBox(meta.name);
            if (v) cb.check();
            else cb.uncheck();
          } else if (meta.type === "radio" && typeof v === "string" && v) {
            form.getRadioGroup(meta.name).select(v);
          } else if (meta.type === "dropdown" && typeof v === "string" && v) {
            form.getDropdown(meta.name).select(v);
          } else if (
            meta.type === "optionList" &&
            Array.isArray(v) &&
            v.length
          ) {
            form.getOptionList(meta.name).select(v);
          }
        } catch (e) {
          console.warn(`Skipping field ${meta.name}`, e);
        }
      }

      // 2) Embed signature images onto signature-like fields.
      for (const sigField of signatureFields) {
        const dataUrl = signatures[sigField.name];
        if (!dataUrl) continue;

        const pngBytes = dataUrlToBytes(dataUrl);
        const png = await doc.embedPng(pngBytes);

        let fieldObj: PDFField;
        try {
          fieldObj = form.getField(sigField.name);
        } catch {
          continue;
        }

        // Grab widget rectangles BEFORE removing the field.
        const widgets =
          (fieldObj as unknown as {
            acroField?: { getWidgets?: () => unknown[] };
          }).acroField?.getWidgets?.() ?? [];

        type WidgetLike = {
          getRectangle: () => {
            x: number;
            y: number;
            width: number;
            height: number;
          };
          P?: () => import("pdf-lib").PDFRef | undefined;
          ref?: import("pdf-lib").PDFRef;
        };

        const placements: Array<{
          page: import("pdf-lib").PDFPage;
          rect: { x: number; y: number; width: number; height: number };
        }> = [];

        for (const w of widgets as WidgetLike[]) {
          try {
            const rect = w.getRectangle();
            const page = findPageForWidget(doc, w);
            placements.push({ page, rect });
          } catch (e) {
            console.warn("Could not resolve widget rectangle", e);
          }
        }

        // Remove the (possibly interactive) field so its empty appearance
        // doesn't get flattened over the signature image.
        try {
          form.removeField(fieldObj);
        } catch (e) {
          console.warn(`Could not remove field ${sigField.name}`, e);
        }

        for (const { page, rect } of placements) {
          const padding = 2;
          const boxW = Math.max(rect.width - padding * 2, 1);
          const boxH = Math.max(rect.height - padding * 2, 1);
          const { width: pngW, height: pngH } = png.scale(1);
          const scale = Math.min(boxW / pngW, boxH / pngH);
          const drawW = pngW * scale;
          const drawH = pngH * scale;
          page.drawImage(png, {
            x: rect.x + (rect.width - drawW) / 2,
            y: rect.y + (rect.height - drawH) / 2,
            width: drawW,
            height: drawH,
          });
        }
      }

      // 3) Flatten so the output is a static, uneditable copy.
      try {
        form.flatten();
      } catch (e) {
        console.warn("Flatten failed; saving with fields intact.", e);
      }

      const out = await doc.save();
      // NOTE: pdf-lib returns a Uint8Array; Blob accepts ArrayBufferView.
      const blob = new Blob([out], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pnpki-form-filled.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Filled PDF downloaded.");
    } catch (e) {
      console.error(e);
      setError(
        `Failed to generate: ${e instanceof Error ? e.message : String(e)}`,
      );
      setStatus("");
    }
  };

  const hasFields = fields.length > 0;

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold">1. Load the form</h2>
        <p className="mb-4 text-sm text-slate-600">
          The app auto-loads{" "}
          <code className="rounded bg-slate-100 px-1">public/form.pdf</code> if
          you ship one with the site. You can also upload any PDF with fillable
          AcroForm boxes.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={loadDefault}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            disabled={loading}
          >
            {loading ? "Loading..." : "Load bundled form"}
          </button>
          <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
            Upload PDF
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
            />
          </label>
          {status && (
            <span className="text-sm text-emerald-700">{status}</span>
          )}
          {error && <span className="text-sm text-red-700">{error}</span>}
        </div>
      </section>

      {hasFields && nonSignatureFields.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold">2. Fill the fields</h2>
          <p className="mb-4 text-xs text-slate-500">
            {nonSignatureFields.length} field
            {nonSignatureFields.length === 1 ? "" : "s"} detected from the
            PDF&apos;s AcroForm.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {nonSignatureFields.map((f) => (
              <FieldInput
                key={f.name}
                meta={f}
                value={values[f.name]}
                onChange={(v) => updateValue(f.name, v)}
              />
            ))}
          </div>
        </section>
      )}

      {hasFields && signatureFields.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold">
            3. Draw your signature{signatureFields.length === 1 ? "" : "s"}
          </h2>
          <p className="mb-4 text-xs text-slate-500">
            Each pad below will be embedded into its matching signature box.
          </p>
          <div className="grid gap-6 md:grid-cols-2">
            {signatureFields.map((f) => (
              <div key={f.name}>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  {f.name}
                </label>
                <SignaturePad
                  onChange={(dataUrl) =>
                    setSignatures((s) => ({ ...s, [f.name]: dataUrl }))
                  }
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {hasFields && (
        <section className="flex justify-end">
          <button
            type="button"
            onClick={generate}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-emerald-500"
          >
            Generate &amp; download filled PDF
          </button>
        </section>
      )}
    </div>
  );
}

function FieldInput({
  meta,
  value,
  onChange,
}: {
  meta: FieldMeta;
  value: string | boolean | string[] | undefined;
  onChange: (v: string | boolean | string[]) => void;
}) {
  if (meta.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        <span className="font-medium text-slate-700">{meta.name}</span>
      </label>
    );
  }
  if (meta.type === "radio") {
    return (
      <div>
        <p className="mb-1 text-sm font-medium text-slate-700">{meta.name}</p>
        <div className="flex flex-wrap gap-3">
          {(meta.options ?? []).map((opt) => (
            <label key={opt} className="flex items-center gap-1 text-sm">
              <input
                type="radio"
                name={meta.name}
                value={opt}
                checked={value === opt}
                onChange={() => onChange(opt)}
              />
              {opt}
            </label>
          ))}
        </div>
      </div>
    );
  }
  if (meta.type === "dropdown") {
    return (
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          {meta.name}
        </label>
        <select
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select...</option>
          {(meta.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (meta.type === "optionList") {
    const arr = Array.isArray(value) ? value : [];
    return (
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          {meta.name}
        </label>
        <select
          multiple
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          value={arr}
          onChange={(e) =>
            onChange(Array.from(e.target.selectedOptions).map((o) => o.value))
          }
        >
          {(meta.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    );
  }
  // text / unknown
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {meta.name}
      </label>
      <input
        type="text"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
