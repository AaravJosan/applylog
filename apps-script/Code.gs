/**
 * ApplyLog: Google Apps Script backend
 *
 * 1. Open your Google Sheet → Extensions → Apps Script, paste this file in.
 * 2. Change SECRET below to your own random string.
 * 3. Run `setup` once (approve the permissions prompt).
 * 4. Deploy → New deployment → Web app
 *      Execute as: Me    Who has access: Anyone
 * 5. Copy the web app URL into the extension's settings.
 *
 * After editing this file, publish a new version:
 * Deploy → Manage deployments → Edit → Version: New version.
 */

const SECRET = 'change-me-to-something-random';
const SHEET_NAME = 'Applications';

const HEADERS = [
  'Date added', 'Job title', 'Company', 'Location', 'URL',
  'Status', 'Connected on LinkedIn', 'Contact', 'Referral', 'Notes', 'Last updated'
];
const FIELDS = ['title', 'company', 'location', 'url', 'status', 'connected', 'contact', 'referral', 'notes'];
const URL_COL = 5;

const OPTIONS = {
  6: ['Saved', 'Applied', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn'], // Status
  7: ['No', 'Request sent', 'Yes'],                                          // Connected
  9: ['Not asked', 'Asked', 'Received', 'Declined']                          // Referral
};

/** Run once from the editor to create and format the sheet. */
function setup() {
  const sheet = getSheet_();
  formatSheet_(sheet);
}

function doGet() {
  return json_({ ok: true, message: 'ApplyLog is running. Use the extension to add jobs.' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) return json_({ ok: false, error: 'Secret key doesn’t match. Check extension settings.' });

    const sheet = getSheet_();

    if (data.action === 'ping') return json_({ ok: true, sheet: sheet.getName() });

    const row = findRowByUrl_(sheet, data.url);

    if (data.action === 'lookup') {
      if (row < 0) return json_({ ok: true, found: false });
      const values = sheet.getRange(row, 2, 1, FIELDS.length).getValues()[0];
      const job = {};
      FIELDS.forEach((f, i) => { job[f] = String(values[i]); });
      return json_({ ok: true, found: true, row: row, job: job });
    }

    if (data.action === 'save') {
      const values = FIELDS.map((f) => clean_(data[f]));
      const now = new Date();
      if (row > 0) {
        sheet.getRange(row, 2, 1, values.length).setValues([values]);
        sheet.getRange(row, HEADERS.length).setValue(now);
        return json_({ ok: true, action: 'updated', row: row });
      }
      sheet.appendRow([now].concat(values, [now]));
      return json_({ ok: true, action: 'added', row: sheet.getLastRow() });
    }

    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    formatSheet_(sheet);
  }
  return sheet;
}

function formatSheet_(sheet) {
  const header = sheet.getRange(1, 1, 1, HEADERS.length);
  header.setValues([HEADERS]).setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  const maxRows = Math.max(sheet.getMaxRows() - 1, 999);
  Object.keys(OPTIONS).forEach((col) => {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(OPTIONS[col], true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, Number(col), maxRows, 1).setDataValidation(rule);
  });

  sheet.getRange(2, 1, maxRows, 1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2, HEADERS.length, maxRows, 1).setNumberFormat('yyyy-mm-dd');
  [110, 240, 160, 150, 260, 110, 150, 150, 110, 260, 110].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
}

function findRowByUrl_(sheet, url) {
  if (!url) return -1;
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const urls = sheet.getRange(2, URL_COL, last - 1, 1).getValues();
  const i = urls.findIndex((r) => String(r[0]) === url);
  return i >= 0 ? i + 2 : -1;
}

/** Trim, cap length, and block spreadsheet formula injection. */
function clean_(v) {
  let s = String(v == null ? '' : v).trim().slice(0, 2000);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
