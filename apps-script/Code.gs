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

// Outreach tab: one row per person you're reaching out to
const OUTREACH_SHEET = 'Outreach';
const O_HEADERS = [
  'Date added', 'Name', 'Company', 'Role', 'LinkedIn URL', 'Job URL',
  'Status', 'Last contact', 'Follow up on', 'Notes', 'Last updated'
];
const O_FIELDS = ['name', 'company', 'role', 'profileUrl', 'jobUrl', 'status']; // columns 2-7
const O_COL = { company: 3, profileUrl: 5, status: 7, lastContact: 8, followUp: 9, notes: 10, updated: 11 };
const O_STATUSES = ['To contact', 'Request sent', 'Connected', 'Messaged', 'Replied',
  'Referral asked', 'Referral received', 'No response'];
// Days until a follow-up is due after moving to each status. Connected means
// they accepted, so the follow-up (your first message) is due right away.
const FOLLOW_UP_DAYS = { 'Request sent': 7, 'Connected': 0, 'Messaged': 5, 'Referral asked': 5 };
// Statuses that mean you just reached out, so they stamp "Last contact"
const CONTACT_STATUSES = ['Request sent', 'Messaged', 'Referral asked'];

/** Run once from the editor to create and format the sheet. */
function setup() {
  const sheet = getSheet_();
  formatSheet_(sheet);
  formatOutreach_(getOutreach_());
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
    if (data.action === 'outreachList') return json_(outreachList_(data));
    if (data.action === 'outreachSave') return json_(outreachSave_(data));

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

function getOutreach_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(OUTREACH_SHEET);
  if (!sheet) sheet = ss.insertSheet(OUTREACH_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(O_HEADERS);
    formatOutreach_(sheet);
  }
  return sheet;
}

function formatOutreach_(sheet) {
  const header = sheet.getRange(1, 1, 1, O_HEADERS.length);
  header.setValues([O_HEADERS]).setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  const maxRows = Math.max(sheet.getMaxRows() - 1, 999);
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(O_STATUSES, true).setAllowInvalid(true).build();
  sheet.getRange(2, O_COL.status, maxRows, 1).setDataValidation(rule);
  [1, O_COL.lastContact, O_COL.followUp, O_COL.updated].forEach((c) =>
    sheet.getRange(2, c, maxRows, 1).setNumberFormat('yyyy-mm-dd'));
  [110, 170, 150, 200, 240, 240, 130, 110, 110, 260, 110].forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  // Highlight rows whose follow-up date has arrived
  const range = sheet.getRange(2, 1, maxRows, O_HEADERS.length);
  const due = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($I2<>"", $I2<=TODAY())')
    .setBackground('#fef7e0')
    .setRanges([range])
    .build();
  sheet.setConditionalFormatRules([due]);
}

/** People at a company, plus how many follow-ups are due across the whole tab. */
function outreachList_(data) {
  const sheet = getOutreach_();
  const company = String(data.company || '').trim().toLowerCase();
  const today = startOfDay_(new Date());
  const people = [];
  const dueList = [];
  outreachRows_(sheet).forEach((r) => {
    const person = {
      row: r.row, name: r.v[1], company: r.v[2], role: r.v[3], profileUrl: r.v[4], jobUrl: r.v[5],
      status: r.v[6], lastContact: fmtDate_(r.v[7]), followUp: fmtDate_(r.v[8]), notes: r.v[9]
    };
    person.due = r.v[8] instanceof Date && r.v[8] <= today;
    if (person.due) dueList.push(person.name + ' (' + person.company + ')');
    if (company && String(person.company).trim().toLowerCase() === company) people.push(person);
  });
  return { ok: true, people: people, due: dueList.length, dueNames: dueList.slice(0, 5), sheetUrl: sheetUrl_(sheet) };
}

/** Adds a person, or updates them if they're already in the tab. */
function outreachSave_(data) {
  const sheet = getOutreach_();
  const name = clean_(data.name);
  const company = clean_(data.company);
  if (!name || !company) return { ok: false, error: 'Name and company are required.' };

  let row = Number(data.row) || -1;
  if (row < 2 || row > sheet.getLastRow()) row = findOutreachRow_(sheet, data.profileUrl, name, company);

  const now = new Date();
  const status = O_STATUSES.indexOf(data.status) >= 0 ? data.status : 'To contact';
  const values = O_FIELDS.map((f) => (f === 'status' ? status : clean_(data[f])));
  const prev = row > 0 ? sheet.getRange(row, 1, 1, O_HEADERS.length).getValues()[0] : null;

  // Dates change only when the status does, so editing notes doesn't reset a follow-up
  let lastContact = prev ? prev[O_COL.lastContact - 1] : '';
  let followUp = prev ? prev[O_COL.followUp - 1] : '';
  if (!prev || prev[O_COL.status - 1] !== status) {
    if (CONTACT_STATUSES.indexOf(status) >= 0) lastContact = now;
    followUp = status in FOLLOW_UP_DAYS ? addDays_(startOfDay_(now), FOLLOW_UP_DAYS[status]) : '';
  }
  const notes = data.notes === undefined && prev ? prev[O_COL.notes - 1] : clean_(data.notes);

  if (prev) {
    sheet.getRange(row, 2, 1, O_HEADERS.length - 1)
      .setValues([values.concat([lastContact, followUp, notes, now])]);
    return { ok: true, action: 'updated', row: row };
  }
  sheet.appendRow([now].concat(values, [lastContact, followUp, notes, now]));
  return { ok: true, action: 'added', row: sheet.getLastRow() };
}

function outreachRows_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, O_HEADERS.length).getValues()
    .map((v, i) => ({ row: i + 2, v: v }))
    .filter((r) => String(r.v[1]).trim());
}

function findOutreachRow_(sheet, profileUrl, name, company) {
  const url = normalizeProfile_(profileUrl);
  const key = (name + '|' + company).toLowerCase();
  const hit = outreachRows_(sheet).find((r) =>
    (url && normalizeProfile_(r.v[4]) === url)
    || (String(r.v[1]) + '|' + String(r.v[2])).toLowerCase() === key);
  return hit ? hit.row : -1;
}

/** linkedin.com/in/jane-doe-123/?foo → linkedin.com/in/jane-doe-123 */
function normalizeProfile_(url) {
  const m = String(url || '').match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : String(url || '').trim().toLowerCase();
}

function sheetUrl_(sheet) {
  return SpreadsheetApp.getActiveSpreadsheet().getUrl() + '#gid=' + sheet.getSheetId();
}

function startOfDay_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays_(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function fmtDate_(v) {
  return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v || '');
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
