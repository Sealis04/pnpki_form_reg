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
};

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
