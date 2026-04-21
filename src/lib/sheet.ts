// Capitalize the first character of each whitespace/hyphen/apostrophe/slash
// run, after lowercasing. Handles "JUAN DELA CRUZ" → "Juan Dela Cruz",
// "O'BRIEN" → "O'Brien", "QUEZON CITY" → "Quezon City". Roman-numeral suffixes
// (e.g. "III") will be mangled to "Iii", so callers should pass Suffix as-is.
export function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'/])(\S)/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export type SheetPayload = {
  lastName: string;
  firstName: string;
  middleName: string;
  suffix: string;
  email: string;
  mobile: string;
  address: string;
  organization: string;
  organizationUnit: string;
  gender: string;
  tin: string;
  // Base64-encoded PDF body (no data-URL prefix). When present, the Apps
  // Script webhook uploads the file to Drive and writes the link into the
  // sheet row.
  pdfBase64?: string;
};

// Encode a Uint8Array as base64 using FileReader so we don't blow the call
// stack on large PDFs (String.fromCharCode.apply has argument-count limits).
export function bytesToBase64(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

export async function submitToSheet(
  url: string,
  payload: SheetPayload,
): Promise<void> {
  // text/plain content-type avoids a CORS preflight; Apps Script reads the
  // raw body via e.postData.contents and parses it as JSON.
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Sheet webhook returned HTTP ${res.status}`);
  }
}
