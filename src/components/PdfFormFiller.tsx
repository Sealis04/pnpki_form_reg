"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PDFDocument,
  PDFTextField,
  StandardFonts,
  type PDFField,
} from "pdf-lib";
import SignaturePad from "./SignaturePad";
import {
  dataUrlToBytes,
  findPageForWidget,
  trimSignatureDataUrl,
} from "~/lib/pdf";
import { bytesToBase64, submitToSheet, toTitleCase } from "~/lib/sheet";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const DEFAULT_FORM_URL = `${BASE_PATH}/pnpki_form.pdf`;
const SHEET_WEBHOOK_URL = process.env.NEXT_PUBLIC_SHEETS_WEBHOOK_URL ?? "";

const DEFAULT_ORGANIZATION = "INTRAMUROS ADMINISTRATION";
const DEFAULT_PLACE = "INTRAMUROS, MANILA";
const DEFAULT_NATIONALITY = "FILIPINO";
const UNIFORM_FONT_SIZE = 10;

const NATIONALITY_OPTIONS = [
  "FILIPINO",
  "AMERICAN",
  "CHINESE",
  "JAPANESE",
  "KOREAN",
  "INDIAN",
  "BRITISH",
  "CANADIAN",
  "AUSTRALIAN",
  "SINGAPOREAN",
] as const;

function todayMMDDYYYY(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

// Mask raw digits into MM/DD/YYYY as the user types.
function formatDateMask(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

// Mask raw digits into TIN format XXX-XXX-XXX-XXX as the user types.
function formatTinMask(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 12);
  const groups: string[] = [];
  for (let i = 0; i < d.length; i += 3) groups.push(d.slice(i, i + 3));
  return groups.join("-");
}

const stripToDigits = (v: string) => v.replace(/\D/g, "");
const stripToPhone = (v: string) => v.replace(/[^\d+\- ]/g, "");

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(file);
  });

type TextKey =
  | "lastName"
  | "firstName"
  | "middleName"
  | "nameExtension"
  | "nationality"
  | "dateOfBirth"
  | "tin"
  | "organization"
  | "organizationalUnit"
  | "unitHouseNo"
  | "street"
  | "barangay"
  | "municipalityCity"
  | "province"
  | "zipCode"
  | "mobileNo"
  | "officialWorkEmail"
  | "date"
  | "place"
  | "nameOfApplicant";

type CheckKey =
  | "sexMale"
  | "sexFemale"
  | "primaryPhilId"
  | "primaryPassport"
  | "primarySss"
  | "primaryLto"
  | "primaryPrc"
  | "primaryPostal"
  | "secondaryBirth"
  | "secondaryNbi"
  | "secondaryPolice"
  | "secondarySeaman"
  | "secondaryComelec"
  | "secondaryOsca"
  | "secondaryOwwa"
  | "secondaryDswd"
  | "secondaryIbp"
  | "secondaryNcwdp"
  | "secondaryNcwdpGov"
  | "secondaryHdmf"
  | "secondaryCompany"
  | "alienPassport"
  | "alienCertification"
  | "alienCompany";

type TextValues = Record<TextKey, string>;
type CheckValues = Record<CheckKey, boolean>;

// Mapping of semantic field keys → AcroForm field names in pnpki_form.pdf.
// Some semantic keys map to multiple PDF fields (page 1 + page 2 duplicates).
const TEXT_MAP: Record<TextKey, readonly string[]> = {
  lastName: ["Text2"],
  firstName: ["Text3"],
  middleName: ["Text4"],
  nameExtension: ["Text5"],
  nationality: ["Text6"],
  dateOfBirth: ["Text7"],
  tin: ["Text8"],
  organization: ["Text9"],
  organizationalUnit: ["Text10"],
  unitHouseNo: ["Text11"],
  street: ["Text15"],
  barangay: ["Text12"],
  municipalityCity: ["Text16"],
  province: ["Text13"],
  zipCode: ["Text17"],
  mobileNo: ["Text14"],
  officialWorkEmail: ["Text18"],
  date: ["Text19", "Text1"],
  place: ["Text20", "Text22"],
  nameOfApplicant: ["Text21", "Text23"],
};

const CHECK_MAP: Record<CheckKey, string> = {
  sexMale: "Check Box22",
  sexFemale: "Check Box23",
  primaryPhilId: "Check Box26",
  primaryPassport: "Check Box27",
  primarySss: "Check Box28",
  primaryLto: "Check Box45",
  primaryPrc: "Check Box46",
  primaryPostal: "Check Box47",
  secondaryBirth: "Check Box29",
  secondaryNbi: "Check Box30",
  secondaryPolice: "Check Box31",
  secondarySeaman: "Check Box32",
  secondaryComelec: "Check Box33",
  secondaryOsca: "Check Box34",
  secondaryOwwa: "Check Box35",
  secondaryDswd: "Check Box36",
  secondaryIbp: "Check Box37",
  secondaryNcwdp: "Check Box38",
  secondaryNcwdpGov: "Check Box39",
  secondaryHdmf: "Check Box40",
  secondaryCompany: "Check Box41",
  alienPassport: "Check Box42",
  alienCertification: "Check Box43",
  alienCompany: "Check Box44",
};

const SIGNATURE_FIELDS = ["Image26_af_image", "Image25_af_image"] as const;
const PHOTO_FIELD = "Image1_af_image";

const EMPTY_TEXT: TextValues = {
  lastName: "",
  firstName: "",
  middleName: "",
  nameExtension: "",
  nationality: DEFAULT_NATIONALITY,
  dateOfBirth: "",
  tin: "",
  organization: DEFAULT_ORGANIZATION,
  organizationalUnit: "",
  unitHouseNo: "",
  street: "",
  barangay: "",
  municipalityCity: "",
  province: "",
  zipCode: "",
  mobileNo: "",
  officialWorkEmail: "",
  date: "",
  place: DEFAULT_PLACE,
  nameOfApplicant: "",
};

const EMPTY_CHECKS: CheckValues = Object.fromEntries(
  Object.keys(CHECK_MAP).map((k) => [k, false]),
) as CheckValues;

type PhotoUpload = { dataUrl: string } | null;

export default function PdfFormFiller() {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [texts, setTexts] = useState<TextValues>(EMPTY_TEXT);
  const [checks, setChecks] = useState<CheckValues>(EMPTY_CHECKS);
  const [signature, setSignature] = useState<string>("");
  const [photo, setPhoto] = useState<PhotoUpload>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  const loadDefault = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(DEFAULT_FORM_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      setPdfBytes(buf);
      setStatus("Form template loaded.");
    } catch (e) {
      setError(
        `Could not load ${DEFAULT_FORM_URL}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }, []);

  useEffect(() => {
    void loadDefault();
  }, [loadDefault]);

  // Auto-fill "Date" on Declaration with today's date (set on mount to avoid
  // SSR hydration mismatch).
  useEffect(() => {
    setTexts((prev) => (prev.date ? prev : { ...prev, date: todayMMDDYYYY() }));
  }, []);

  // Keep "Name of Applicant" in sync with FIRST MIDDLE LAST EXT.
  useEffect(() => {
    const full = [
      texts.firstName,
      texts.middleName,
      texts.lastName,
      texts.nameExtension,
    ]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" ");
    setTexts((prev) =>
      prev.nameOfApplicant === full ? prev : { ...prev, nameOfApplicant: full },
    );
  }, [
    texts.firstName,
    texts.middleName,
    texts.lastName,
    texts.nameExtension,
  ]);

  const setText = (k: TextKey, v: string) =>
    setTexts((prev) => ({ ...prev, [k]: v }));

  const setCheck = (k: CheckKey, v: boolean) =>
    setChecks((prev) => ({ ...prev, [k]: v }));

  const setSex = (sex: "male" | "female") =>
    setChecks((prev) => ({
      ...prev,
      sexMale: sex === "male",
      sexFemale: sex === "female",
    }));

  const generate = async () => {
    if (!pdfBytes) return;
    if (!signature) {
      setError("Please provide a signature (draw or upload an image).");
      return;
    }
    if (!photo) {
      setError("Please upload a passport-size photo.");
      return;
    }
    const confirmed = window.confirm(
      "Submit your PNPKI registration?\n\n" +
        "This will download your filled PDF and add your details to the registration sheet.",
    );
    if (!confirmed) return;
    setError("");
    setStatus("Generating filled PDF...");
    try {
      const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const form = doc.getForm();
      const helvetica = await doc.embedFont(StandardFonts.Helvetica);

      // 1) Text fields — enforce a single uniform font size across all text
      //    fields. If any single-line value would overflow its widget at the
      //    preferred size, drop the global size in 0.5pt steps until it fits,
      //    so every field still renders at the same size.
      type WidgetRect = {
        getRectangle: () => { width: number };
      };
      type FillJob = {
        field: PDFTextField;
        text: string;
        widthBudget: number;
        multiline: boolean;
      };

      // Some fields in the source PDF have no /DA (default appearance) entry.
      // pdf-lib's setFontSize throws on those because it parses the existing
      // /DA to swap the size token. Seed a /DA so the call succeeds, falling
      // back to writing /DA directly if anything else trips it.
      const setFieldFontSize = (tf: PDFTextField, size: number) => {
        const acro = (
          tf as unknown as {
            acroField: {
              getDefaultAppearance: () => string | undefined;
              setDefaultAppearance: (s: string) => void;
            };
          }
        ).acroField;
        if (!acro.getDefaultAppearance()) {
          acro.setDefaultAppearance(`/Helv ${size} Tf 0 g`);
          return;
        }
        try {
          tf.setFontSize(size);
        } catch {
          acro.setDefaultAppearance(`/Helv ${size} Tf 0 g`);
        }
      };

      const fillJobs: FillJob[] = [];
      for (const [key, fieldNames] of Object.entries(TEXT_MAP) as [
        TextKey,
        readonly string[],
      ][]) {
        const value = texts[key];
        if (!value) continue;
        for (const name of fieldNames) {
          try {
            const tf = form.getTextField(name);
            const widgets =
              (tf as unknown as {
                acroField?: { getWidgets?: () => WidgetRect[] };
              }).acroField?.getWidgets?.() ?? [];
            let minWidth = Infinity;
            for (const w of widgets) {
              try {
                minWidth = Math.min(minWidth, w.getRectangle().width);
              } catch {
                // ignore
              }
            }
            const widthBudget = Number.isFinite(minWidth)
              ? Math.max(minWidth - 4, 1)
              : Infinity;
            let multiline = false;
            try {
              multiline = tf.isMultiline();
            } catch {
              // ignore
            }
            fillJobs.push({ field: tf, text: value, widthBudget, multiline });
          } catch (e) {
            console.warn(`Missing text field ${name}`, e);
          }
        }
      }

      const MIN_FONT_SIZE = 5;
      let chosenSize = UNIFORM_FONT_SIZE;
      while (chosenSize > MIN_FONT_SIZE) {
        const overflows = fillJobs.some(
          (j) =>
            !j.multiline &&
            helvetica.widthOfTextAtSize(j.text, chosenSize) > j.widthBudget,
        );
        if (!overflows) break;
        chosenSize -= 0.5;
      }

      for (const { field, text } of fillJobs) {
        field.setText(text);
        setFieldFontSize(field, chosenSize);
      }
      for (const field of form.getFields()) {
        if (field instanceof PDFTextField) {
          try {
            setFieldFontSize(field, chosenSize);
          } catch (e) {
            console.warn(`Could not set font size on ${field.getName()}`, e);
          }
        }
      }

      // 2) Check boxes
      for (const [key, name] of Object.entries(CHECK_MAP) as [
        CheckKey,
        string,
      ][]) {
        try {
          const cb = form.getCheckBox(name);
          if (checks[key]) cb.check();
          else cb.uncheck();
        } catch (e) {
          console.warn(`Missing checkbox ${name}`, e);
        }
      }

      // 3) Capture widget rectangles for image overlays BEFORE flatten.
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

      const overlayJobs: Array<{
        dataUrl: string;
        page: import("pdf-lib").PDFPage;
        rect: { x: number; y: number; width: number; height: number };
      }> = [];

      const collectPlacements = (fieldName: string, dataUrl: string) => {
        let fieldObj: PDFField;
        try {
          fieldObj = form.getField(fieldName);
        } catch {
          return;
        }
        const widgets =
          (fieldObj as unknown as {
            acroField?: { getWidgets?: () => WidgetLike[] };
          }).acroField?.getWidgets?.() ?? [];
        for (const w of widgets) {
          try {
            const rect = w.getRectangle();
            const page = findPageForWidget(doc, w);
            overlayJobs.push({ dataUrl, page, rect });
          } catch (e) {
            console.warn(`Widget rect lookup failed for ${fieldName}`, e);
          }
        }
      };

      if (signature) {
        let signatureForOverlay = signature;
        try {
          signatureForOverlay = await trimSignatureDataUrl(signature);
        } catch (e) {
          console.warn("Signature trim failed; using original.", e);
        }
        for (const fieldName of SIGNATURE_FIELDS) {
          collectPlacements(fieldName, signatureForOverlay);
        }
      }
      if (photo) {
        collectPlacements(PHOTO_FIELD, photo.dataUrl);
      }

      // 4) Flatten — renders all field appearances and strips widgets. This
      //    runs BEFORE drawImage so the image sits on top of the (now empty)
      //    placeholder box rather than being overdrawn by flatten.
      try {
        form.updateFieldAppearances(helvetica);
      } catch (e) {
        console.warn("updateFieldAppearances failed", e);
      }
      try {
        form.flatten();
      } catch (e) {
        console.warn("Flatten failed; saving with fields intact.", e);
      }

      // 5) Draw overlays on top of flattened pages.
      for (const { dataUrl, page, rect } of overlayJobs) {
        const bytes = dataUrlToBytes(dataUrl);
        const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
        const img = isJpeg
          ? await doc.embedJpg(bytes)
          : await doc.embedPng(bytes);
        const padding = 2;
        const boxW = Math.max(rect.width - padding * 2, 1);
        const boxH = Math.max(rect.height - padding * 2, 1);
        const { width: iw, height: ih } = img.scale(1);
        const scale = Math.min(boxW / iw, boxH / ih);
        const drawW = iw * scale;
        const drawH = ih * scale;
        page.drawImage(img, {
          x: rect.x + (rect.width - drawW) / 2,
          y: rect.y + (rect.height - drawH) / 2,
          width: drawW,
          height: drawH,
        });
      }

      const out = await doc.save();
      const blob = new Blob([out as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pnpki-form-filled.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Filled PDF downloaded.");

      if (!SHEET_WEBHOOK_URL) {
        setError(
          "PDF downloaded, but the registration sheet is not configured " +
            "(NEXT_PUBLIC_SHEETS_WEBHOOK_URL is missing).",
        );
        return;
      }

      setStatus("Submitting to registration sheet...");
      const address = [
        texts.unitHouseNo,
        texts.street,
        texts.barangay,
        texts.municipalityCity,
        texts.province,
        texts.zipCode,
      ]
        .map((p) => p.trim())
        .filter(Boolean)
        .join(", ");
      try {
        const pdfBase64 = await bytesToBase64(out);
        await submitToSheet(SHEET_WEBHOOK_URL, {
          lastName: toTitleCase(texts.lastName),
          firstName: toTitleCase(texts.firstName),
          middleName: toTitleCase(texts.middleName),
          suffix: texts.nameExtension.trim(),
          email: texts.officialWorkEmail.trim().toLowerCase(),
          mobile: texts.mobileNo.trim(),
          address: toTitleCase(address),
          organization: toTitleCase(texts.organization),
          organizationUnit: toTitleCase(texts.organizationalUnit),
          gender: checks.sexMale ? "Male" : checks.sexFemale ? "Female" : "",
          tin: texts.tin.trim(),
          pdfBase64,
        });
        setStatus("Filled PDF downloaded and details submitted to the sheet.");
      } catch (e) {
        console.error(e);
        setError(
          `Submission to sheet failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    } catch (e) {
      console.error(e);
      setError(
        `Failed to generate: ${e instanceof Error ? e.message : String(e)}`,
      );
      setStatus("");
    }
  };

  const sexValue: "male" | "female" | "" = checks.sexMale
    ? "male"
    : checks.sexFemale
      ? "female"
      : "";

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void generate();
      }}
      noValidate={false}
    >
      {(status || error) && (
        <div className="text-sm">
          {status && <span className="text-emerald-700">{status}</span>}
          {error && <span className="text-red-700">{error}</span>}
        </div>
      )}

      <Section title="Applicant Details">
        <div className="grid gap-4 md:grid-cols-4">
          <TextInput
            label="Last Name"
            value={texts.lastName}
            onChange={(v) => setText("lastName", v)}
            maxLength={50}
            autoComplete="family-name"
          />
          <TextInput
            label="First Name"
            value={texts.firstName}
            onChange={(v) => setText("firstName", v)}
            maxLength={50}
            autoComplete="given-name"
          />
          <TextInput
            label="Middle Name"
            value={texts.middleName}
            onChange={(v) => setText("middleName", v)}
            maxLength={50}
            autoComplete="additional-name"
          />
          <TextInput
            label="Name Extension (JR/SR/III)"
            value={texts.nameExtension}
            onChange={(v) => setText("nameExtension", v)}
            maxLength={10}
            required={false}
            autoComplete="honorific-suffix"
          />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">Sex</p>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="sex"
                  checked={sexValue === "male"}
                  onChange={() => setSex("male")}
                />
                Male
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="sex"
                  checked={sexValue === "female"}
                  onChange={() => setSex("female")}
                />
                Female
              </label>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Nationality<span className="ml-0.5 text-red-600">*</span>
            </label>
            <select
              value={texts.nationality}
              onChange={(e) => setText("nationality", e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm uppercase focus:border-slate-500 focus:outline-none"
            >
              {NATIONALITY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <TextInput
            label="Date of Birth (MM/DD/YYYY)"
            value={texts.dateOfBirth}
            onChange={(v) => setText("dateOfBirth", v)}
            placeholder="MM/DD/YYYY"
            inputMode="numeric"
            maxLength={10}
            pattern="\d{2}/\d{2}/\d{4}"
            title="Enter date as MM/DD/YYYY"
            transform={formatDateMask}
            uppercase={false}
            autoComplete="bday"
          />
          <TextInput
            label="TIN"
            value={texts.tin}
            onChange={(v) => setText("tin", v)}
            inputMode="numeric"
            maxLength={15}
            pattern="\d{3}-\d{3}-\d{3}-\d{3}"
            title="Enter TIN as XXX-XXX-XXX-XXX"
            transform={formatTinMask}
            uppercase={false}
            placeholder="XXX-XXX-XXX-XXX"
          />
        </div>

        <div className="mt-4 grid gap-4">
          <TextInput
            label="Organization/Agency/Company"
            value={texts.organization}
            onChange={(v) => setText("organization", v)}
            maxLength={120}
            autoComplete="organization"
            disabled
            hint="Fixed to Intramuros Administration."
          />
          <TextInput
            label="Organizational Unit/Department/Division"
            value={texts.organizationalUnit}
            onChange={(v) => setText("organizationalUnit", v)}
            maxLength={120}
          />
        </div>

        <div className="mt-6">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Passport-size photograph (35x45mm)
            <span className="ml-0.5 text-red-600">*</span>
          </label>
          <ImageDropZone
            label="passport photo"
            value={photo?.dataUrl ?? ""}
            onChange={(dataUrl) => setPhoto(dataUrl ? { dataUrl } : null)}
            previewClassName="h-40 w-auto"
          />
        </div>
      </Section>

      <Section title="Contact Details">
        <div className="grid gap-4 md:grid-cols-2">
          <TextInput
            label="Unit/Room/House No."
            value={texts.unitHouseNo}
            onChange={(v) => setText("unitHouseNo", v)}
            maxLength={30}
            autoComplete="address-line1"
          />
          <TextInput
            label="Street"
            value={texts.street}
            onChange={(v) => setText("street", v)}
            maxLength={80}
            autoComplete="address-line2"
          />
          <TextInput
            label="Barangay"
            value={texts.barangay}
            onChange={(v) => setText("barangay", v)}
            maxLength={50}
          />
          <TextInput
            label="Municipality/City"
            value={texts.municipalityCity}
            onChange={(v) => setText("municipalityCity", v)}
            maxLength={50}
            autoComplete="address-level2"
          />
          <TextInput
            label="Province"
            value={texts.province}
            onChange={(v) => setText("province", v)}
            maxLength={50}
            autoComplete="address-level1"
          />
          <TextInput
            label="Zip Code"
            value={texts.zipCode}
            onChange={(v) => setText("zipCode", v)}
            inputMode="numeric"
            maxLength={4}
            pattern="\d{4}"
            title="4-digit ZIP code"
            transform={stripToDigits}
            uppercase={false}
            autoComplete="postal-code"
          />
          <TextInput
            label="Mobile No."
            value={texts.mobileNo}
            onChange={(v) => setText("mobileNo", v)}
            type="tel"
            inputMode="tel"
            maxLength={15}
            transform={stripToPhone}
            uppercase={false}
            placeholder="09XXXXXXXXX"
            autoComplete="tel"
          />
          <TextInput
            label="Official Work Email Address"
            value={texts.officialWorkEmail}
            onChange={(v) => setText("officialWorkEmail", v)}
            type="email"
            inputMode="email"
            maxLength={100}
            uppercase={false}
            autoComplete="email"
            hint="*PNPKI-related emails will be sent to this email address"
          />
        </div>
      </Section>

      <Section title="Declaration">
        <p className="mb-4 text-sm leading-relaxed text-slate-600">
          I hereby agree that I have read and understood the provisions of the
          Subscriber Agreement; that all information provided and documents
          submitted in relation to this application is true and correct to the
          best of my knowledge; that I am duly authorized to make this
          application; that I consent to the subscriber agreement and will
          abide by the same; that I accept the publication of my certificate
          information.
        </p>
        <p className="mb-4 text-sm leading-relaxed text-slate-600">
          I authorize and expressly give consent to the Philippine National PKI
          through its authorized representative(s) to verify my personal
          information from whatever source it deems appropriate.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <TextInput
            label="Date"
            value={texts.date}
            onChange={(v) => setText("date", v)}
            placeholder="MM/DD/YYYY"
            inputMode="numeric"
            maxLength={10}
            pattern="\d{2}/\d{2}/\d{4}"
            title="Enter date as MM/DD/YYYY"
            transform={formatDateMask}
            uppercase={false}
            disabled
            hint="Auto-filled with today's date."
          />
          <TextInput
            label="Place"
            value={texts.place}
            onChange={(v) => setText("place", v)}
            maxLength={50}
            disabled
            hint="Fixed to Intramuros, Manila."
          />
          <TextInput
            label="Name of Applicant"
            value={texts.nameOfApplicant}
            onChange={(v) => setText("nameOfApplicant", v)}
            maxLength={150}
            autoComplete="name"
            disabled
            hint="Auto-filled from First, Middle, and Last Name."
          />
        </div>
        <div className="mt-6">
          <p className="mb-2 text-sm font-medium text-slate-700">
            Signature<span className="ml-0.5 text-red-600">*</span>
          </p>
          <SignatureInput value={signature} onChange={setSignature} />
        </div>
      </Section>

      <Section title="Checklist of Documents">
        <p className="mb-4 text-sm text-slate-600">
          One (1) Primary OR two (2) Secondary government-issued IDs.
        </p>
        <Subhead>Primary IDs</Subhead>
        <div className="grid gap-2 md:grid-cols-2">
          <Check
            label="Philippine National ID (Phil ID)"
            checked={checks.primaryPhilId}
            onChange={(v) => setCheck("primaryPhilId", v)}
          />
          <Check
            label="LTO Driver's License"
            checked={checks.primaryLto}
            onChange={(v) => setCheck("primaryLto", v)}
          />
          <Check
            label="Philippine Passport"
            checked={checks.primaryPassport}
            onChange={(v) => setCheck("primaryPassport", v)}
          />
          <Check
            label="Professional Regulation Commission (PRC) ID"
            checked={checks.primaryPrc}
            onChange={(v) => setCheck("primaryPrc", v)}
          />
          <Check
            label="SSS Unified Multi-Purpose ID"
            checked={checks.primarySss}
            onChange={(v) => setCheck("primarySss", v)}
          />
          <Check
            label="Postal Identity Card"
            checked={checks.primaryPostal}
            onChange={(v) => setCheck("primaryPostal", v)}
          />
        </div>

        <Subhead>Secondary IDs</Subhead>
        <div className="grid gap-2 md:grid-cols-2">
          <Check
            label="Philippines-issued Birth Certificate"
            checked={checks.secondaryBirth}
            onChange={(v) => setCheck("secondaryBirth", v)}
          />
          <Check
            label="National Bureau of Investigation (NBI) Clearance"
            checked={checks.secondaryNbi}
            onChange={(v) => setCheck("secondaryNbi", v)}
          />
          <Check
            label="Police Clearance"
            checked={checks.secondaryPolice}
            onChange={(v) => setCheck("secondaryPolice", v)}
          />
          <Check
            label="Seaman's Book"
            checked={checks.secondarySeaman}
            onChange={(v) => setCheck("secondarySeaman", v)}
          />
          <Check
            label="COMELEC Voter's ID"
            checked={checks.secondaryComelec}
            onChange={(v) => setCheck("secondaryComelec", v)}
          />
          <Check
            label="OSCA Senior Citizen Card"
            checked={checks.secondaryOsca}
            onChange={(v) => setCheck("secondaryOsca", v)}
          />
          <Check
            label="Overseas Workers Welfare Administration (OWWA) ID"
            checked={checks.secondaryOwwa}
            onChange={(v) => setCheck("secondaryOwwa", v)}
          />
          <Check
            label="Department of Social Welfare and Development (DSWD) Certification"
            checked={checks.secondaryDswd}
            onChange={(v) => setCheck("secondaryDswd", v)}
          />
          <Check
            label="Integrated Bar of the Philippines ID"
            checked={checks.secondaryIbp}
            onChange={(v) => setCheck("secondaryIbp", v)}
          />
          <Check
            label="Certification from the National Council for the Welfare of Disabled Persons (NCWDP)"
            checked={checks.secondaryNcwdp}
            onChange={(v) => setCheck("secondaryNcwdp", v)}
          />
          <Check
            label="Certification from NCWDP Government Office and GOCCC ID (e.g. AFP ID)"
            checked={checks.secondaryNcwdpGov}
            onChange={(v) => setCheck("secondaryNcwdpGov", v)}
          />
          <Check
            label="Home Development Mutual Fund (HDMF) ID"
            checked={checks.secondaryHdmf}
            onChange={(v) => setCheck("secondaryHdmf", v)}
          />
          <Check
            label="Company IDs issued by private entities or institutions registered with/supervised by BSP, SEC, or IC"
            checked={checks.secondaryCompany}
            onChange={(v) => setCheck("secondaryCompany", v)}
          />
        </div>

        <Subhead>Alien Applicants Only</Subhead>
        <div className="grid gap-2 md:grid-cols-2">
          <Check
            label="Valid Passport"
            checked={checks.alienPassport}
            onChange={(v) => setCheck("alienPassport", v)}
          />
          <Check
            label="Alien Certification of Registration / Immigrant Certificate of Registration"
            checked={checks.alienCertification}
            onChange={(v) => setCheck("alienCertification", v)}
          />
          <Check
            label="Company IDs issued by private entities registered with/supervised by BSP, SEC, or IC"
            checked={checks.alienCompany}
            onChange={(v) => setCheck("alienCompany", v)}
          />
        </div>
      </Section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!pdfBytes}
          className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Submit registration
        </button>
      </div>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="bg-[#1e3a8a] px-6 py-3 text-sm font-semibold uppercase tracking-[0.25em] text-white">
        {title}
      </header>
      <div className="p-6">{children}</div>
    </section>
  );
}

function Subhead({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-widest text-slate-600 first:mt-0">
      {children}
    </h3>
  );
}

type TextInputProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  type?: "text" | "email" | "tel";
  inputMode?: "text" | "numeric" | "tel" | "email" | "decimal";
  maxLength?: number;
  pattern?: string;
  required?: boolean;
  autoComplete?: string;
  uppercase?: boolean;
  transform?: (v: string) => string;
  title?: string;
  disabled?: boolean;
  multiline?: boolean;
  rows?: number;
};

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
  inputMode,
  maxLength,
  pattern,
  required = true,
  autoComplete,
  uppercase = true,
  transform,
  title,
  disabled = false,
  multiline = false,
  rows = 2,
}: TextInputProps) {
  const handle = (raw: string) => {
    let v = raw;
    if (transform) v = transform(v);
    if (uppercase) v = v.toUpperCase();
    if (maxLength != null) v = v.slice(0, maxLength);
    onChange(v);
  };
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && !disabled && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => handle(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          required={required && !disabled}
          autoComplete={autoComplete}
          title={title}
          disabled={disabled}
          rows={rows}
          className={`w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none ${
            uppercase ? "uppercase" : ""
          } ${
            disabled
              ? "cursor-not-allowed bg-slate-100 text-slate-600"
              : "bg-white"
          }`}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => handle(e.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          maxLength={maxLength}
          pattern={pattern}
          required={required && !disabled}
          autoComplete={autoComplete}
          title={title}
          disabled={disabled}
          className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none ${
            uppercase ? "uppercase" : ""
          } ${
            disabled
              ? "cursor-not-allowed bg-slate-100 text-slate-600"
              : "bg-white"
          }`}
        />
      )}
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300"
      />
      <span>{label}</span>
    </label>
  );
}

function ImageDropZone({
  label,
  value,
  onChange,
  previewClassName = "h-32 w-auto",
}: {
  label: string;
  value: string;
  onChange: (dataUrl: string) => void;
  previewClassName?: string;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState("");

  const accept = async (file: File | null | undefined) => {
    setErr("");
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg)$/i.test(file.type)) {
      setErr("Only PNG or JPEG images are supported.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErr("Image is larger than 5 MB.");
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    onChange(dataUrl);
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void accept(e.dataTransfer.files?.[0]);
        }}
        className={`flex flex-col items-start gap-2 rounded-lg border border-dashed p-3 ${
          dragOver ? "border-emerald-500 bg-emerald-50" : "border-slate-300"
        }`}
      >
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={(e) => void accept(e.target.files?.[0])}
          className="block text-sm"
        />
        <p className="text-sm text-slate-500">
          Drag &amp; drop or choose a PNG/JPEG (max 5 MB) for the {label}.
        </p>
        {value && (
          <div className="flex items-center gap-3">
            <img
              src={value}
              alt={`${label} preview`}
              className={`rounded border border-slate-200 ${previewClassName}`}
            />
            <button
              type="button"
              onClick={() => onChange("")}
              className="text-sm font-medium text-red-600 hover:underline"
            >
              Remove
            </button>
          </div>
        )}
      </div>
      {err && <p className="mt-1 text-sm text-red-600">{err}</p>}
    </div>
  );
}

function SignatureInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
}) {
  const [mode, setMode] = useState<"draw" | "upload">("draw");
  return (
    <div>
      <div className="mb-3 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm font-medium">
        <button
          type="button"
          onClick={() => {
            setMode("draw");
            onChange("");
          }}
          className={`rounded-md px-3 py-1 ${
            mode === "draw"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600"
          }`}
        >
          Draw
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("upload");
            onChange("");
          }}
          className={`rounded-md px-3 py-1 ${
            mode === "upload"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600"
          }`}
        >
          Upload image
        </button>
      </div>
      {mode === "draw" ? (
        <SignaturePad onChange={onChange} />
      ) : (
        <ImageDropZone
          label="signature"
          value={value}
          onChange={onChange}
          previewClassName="h-24 w-auto"
        />
      )}
    </div>
  );
}
