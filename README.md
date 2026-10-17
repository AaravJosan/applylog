# ApplyLog

A Chrome extension that saves job postings to a Google Sheet in one click, and tracks the networking side of your search: LinkedIn connections, contacts and referrals.

## Features

- **One-click capture**: open a job posting, click the extension, and the title, company, location and URL are filled in for you.
- **Works on major job sites**: LinkedIn, Indeed, Handshake, Greenhouse, Lever, Ashby, Workday, plus any site that publishes standard `JobPosting` structured data.
- **Networking columns**: track whether you're connected with someone at the company, who your contact is, and your referral status.
- **Find connections fast**: one button opens a LinkedIn search for your 1st-degree connections at that company.
- **No duplicates**: revisit a job you've already saved and the extension loads its row, so you can update status or referral instead of adding a new one.
- **Ready-made sheet**: headers, frozen top row and dropdown menus are set up automatically.
- **Autofill applications**: save your name, contact info, links, address, education and work-authorization answers once, then fill application forms with one click.

## Sheet columns

| Date added | Job title | Company | Location | URL | Status | Connected on LinkedIn | Contact | Referral | Notes | Last updated |
|---|---|---|---|---|---|---|---|---|---|---|

- **Status**: Saved, Applied, Interviewing, Offer, Rejected, Withdrawn
- **Connected on LinkedIn**: No, Request sent, Yes
- **Referral**: Not asked, Asked, Received, Declined

## Setup (about 5 minutes)

### 1. Connect your Google Sheet

1. Create a Google Sheet (or open an existing one).
2. Go to **Extensions → Apps Script**.
3. Replace the contents of `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs).
4. Change `SECRET` near the top to your own random string.
5. Click **Run** with `setup` selected, and approve the permissions prompt.
6. Click **Deploy → New deployment**, choose **Web app**, and set:
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Copy the web app URL (it ends in `/exec`).

> The secret key keeps strangers who find your URL from writing to your sheet.

### 2. Install the extension

1. Go to `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `extension` folder.
3. Pin ApplyLog to your toolbar.

### 3. Link them

1. Click the ApplyLog icon, then the ⚙ settings button.
2. Paste your web app URL and secret, click **Test connection**, then **Save**.

## Usage

1. Open any job posting.
2. Click the ApplyLog icon. Details are pre-filled; fix anything that looks off.
3. Set your status, LinkedIn connection and referral, and add notes.
4. Click **Add to sheet**.

### Autofilling an application

1. In ⚙ settings, fill in **Autofill profile** and click **Save profile**. It's stored only in this browser and never sent to your sheet.
2. On an application form, open ApplyLog and click **Autofill this application**.
3. Filled fields get a green outline. Check them, attach your resume, and submit yourself.

Autofill only fills empty fields and never submits. Custom dropdown widgets (like Workday's) and file uploads aren't filled. If the form sits in an iframe from another site, open that iframe in its own tab first.

Come back to the same posting later and the extension shows your saved tracking info, ready to update.

## Project structure

```
extension/
  manifest.json      Chrome extension config (Manifest V3)
  popup.html/css/js  The popup form, job-detail scraping and autofill
  options.html/js    Settings page
  icons/
apps-script/
  Code.gs            Google Sheets backend
```

## Notes

- Job sites change their page layouts often. If a field stops auto-filling on a site, the selectors live in `extractJob()` in `popup.js`.
- Application autofill matches fields by label, name, id and placeholder using the `RULES` list in `autofillPage()` in `popup.js`. Add a pattern there if a form's field isn't recognised.
- After editing `Code.gs`, publish a new version: **Deploy → Manage deployments → Edit → Version: New version**.

## Tech

Chrome Extension Manifest V3, vanilla JavaScript, Google Apps Script.
