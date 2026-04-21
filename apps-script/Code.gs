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
 *        - Data rows start at row 8 (rows 1-7 are reserved for headers/notes).
 *
 *   3. From the converted sheet: Extensions → Apps Script.
 *      Replace the editor contents with everything in this file. Save.
 *
 *   4. Update SHEET_ID below with the converted sheet's ID.
 *
 *   5. Deploy → New deployment → "Web app".
 *        Execute as:    Me
 *        Who has access: Anyone
 *      Authorize when prompted. Copy the Web app URL (ends in /exec).
 *
 *   6. In the project root, create .env.local containing:
 *        NEXT_PUBLIC_SHEETS_WEBHOOK_URL=<paste the /exec URL>
 *      Restart `npm run dev` so the env var is picked up.
 *
 *   7. To update this script later, edit and Deploy → Manage deployments
 *      → pencil icon → New version → Deploy. The /exec URL stays the same.
 */

const SHEET_ID = 'PASTE_CONVERTED_GOOGLE_SHEETS_ID_HERE';
const FIRST_DATA_ROW = 8; // rows 1-7 are reserved for headers/notes
const FIRST_DATA_COL = 2; // Column B — Column A holds the running index

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];

    // Find the next empty row at/after FIRST_DATA_ROW by scanning Column B.
    const lastRow = sheet.getLastRow();
    const targetRow = Math.max(lastRow + 1, FIRST_DATA_ROW);

    // Column A: running index (1-based, counted from FIRST_DATA_ROW).
    const index = targetRow - FIRST_DATA_ROW + 1;

    const values = [
      data.lastName || '',
      data.firstName || '',
      data.middleName || '',
      data.suffix || '',
      data.email || '',
      data.mobile || '',
      data.address || '',
      data.organization || '',
      data.organizationUnit || '',
      data.gender || '',
      data.tin || '',
    ];

    sheet.getRange(targetRow, 1).setValue(index);
    sheet.getRange(targetRow, FIRST_DATA_COL, 1, values.length).setValues([values]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, row: targetRow }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
