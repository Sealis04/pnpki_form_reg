/**
 * PNPKI Registration Sheet — Apps Script Web App
 *
 * SETUP (one-time):
 *
 *   1. Convert the target sheet to native Google Sheets format.
 *      Your shared link points to an .xlsx file (the URL has rtpof=true&sd=true),
 *      and SpreadsheetApp.openById only works with native Sheets files.
 *      Open the file in Sheets, then File → Save as Google Sheets.
 *      Use the NEW file's ID below — it's the long token in
 *      /spreadsheets/d/<ID>/edit.
 *
 *   2. Sheet layout expected by this script:
 *        - Column A: running index (auto-filled)
 *        - Columns B..L: submission fields, in this order:
 *            Last Name | First Name | Middle Name | Suffix | Email Address |
 *            Mobile Number | Residential Address | Organization Name |
 *            Organization Unit | Gender | TIN
 *        - Column M: PDF Link (Drive URL, filled by this script)
 *        - Data rows start at row 8 (rows 1-7 are reserved for headers/notes).
 *
 *   3. Create a Drive folder to hold the filled PDFs. Open it and copy the
 *      folder ID from the URL (/folders/<ID>). Paste it into FOLDER_ID below.
 *      Keep the folder private — only users you share it with will be able
 *      to open the PDFs linked from column M.
 *
 *   4. From the converted sheet: Extensions → Apps Script.
 *      Replace the editor contents with everything in this file. Save.
 *
 *   5. Update SHEET_ID and FOLDER_ID below.
 *
 *   6. Deploy → New deployment → "Web app".
 *        Execute as:    Me
 *        Who has access: Anyone
 *      Authorize when prompted (the script now requests Drive access in
 *      addition to Sheets — re-authorize if updating an existing deployment).
 *      Copy the Web app URL (ends in /exec).
 *
 *   7. In the project root, create .env.local containing:
 *        NEXT_PUBLIC_SHEETS_WEBHOOK_URL=<paste the /exec URL>
 *      Restart `npm run dev` so the env var is picked up.
 *
 *   8. To update this script later, edit and Deploy → Manage deployments
 *      → pencil icon → New version → Deploy. The /exec URL stays the same.
 */

const SHEET_ID = 'PASTE_CONVERTED_GOOGLE_SHEETS_ID_HERE';
const FOLDER_ID = 'PASTE_DRIVE_FOLDER_ID_HERE';
const FIRST_DATA_ROW = 8; // rows 1-7 are reserved for headers/notes
const FIRST_DATA_COL = 2; // Column B — Column A holds the running index

// Normalize Philippine mobile numbers to the canonical 63XXXXXXXXXX form.
// Accepts "09XXXXXXXXX", "9XXXXXXXXX", "+639XXXXXXXXX", "639XXXXXXXXX", etc.
// Returns the input stripped to digits if it doesn't match any known shape.
function normalizeMobile(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('63')) return digits;
  if (digits.startsWith('0')) return '63' + digits.slice(1);
  if (digits.startsWith('9') && digits.length === 10) return '63' + digits;
  return digits;
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];

    // Find the next empty row at/after FIRST_DATA_ROW by scanning Column B.
    const lastRow = sheet.getLastRow();
    const targetRow = Math.max(lastRow + 1, FIRST_DATA_ROW);

    // Column A: running index (1-based, counted from FIRST_DATA_ROW).
    const index = targetRow - FIRST_DATA_ROW + 1;

    // Upload the filled PDF to Drive if one was sent. The file stays private
    // — sharing inherits from the target folder, so only folder collaborators
    // can open the link stored in column M.
    let pdfUrl = '';
    if (data.pdfBase64) {
      const bytes = Utilities.base64Decode(data.pdfBase64);
      const filename =
        'PNPKI_' +
        (data.lastName || 'applicant') +
        '_' +
        (data.firstName || '') +
        '_row' +
        targetRow +
        '.pdf';
      const blob = Utilities.newBlob(bytes, 'application/pdf', filename);
      const file = DriveApp.getFolderById(FOLDER_ID).createFile(blob);
      pdfUrl = file.getUrl();
    }

    const values = [
      data.lastName || '',
      data.firstName || '',
      data.middleName || '',
      data.suffix || '',
      data.email || '',
      normalizeMobile(data.mobile),
      data.address || '',
      data.organization || '',
      data.organizationUnit || '',
      data.gender || '',
      data.tin || '',
      pdfUrl,
    ];

    sheet.getRange(targetRow, 1).setValue(index);
    sheet.getRange(targetRow, FIRST_DATA_COL, 1, values.length).setValues([values]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, row: targetRow, pdfUrl: pdfUrl }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
