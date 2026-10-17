# ApplyLog

A Chrome extension that saves job postings to a Google Sheet in one click, and tracks the networking side of your search: LinkedIn connections, contacts and referrals.

## Features

- **One-click capture**: open a job posting, click the extension, and the title, company, location and URL are filled in for you.
- **Works on major job sites**: LinkedIn, Indeed, Handshake, Greenhouse, Lever, Ashby, Workday, plus any site that publishes standard `JobPosting` structured data.
- **Networking columns**: track whether you're connected with someone at the company, who your contact is, and your referral status.
- **Find connections fast**: one button opens a LinkedIn search for your 1st-degree connections at that company.
- **No duplicates**: revisit a job you've already saved and the extension loads its row, so you can update status or referral instead of adding a new one.
- **Ready-made sheet**: headers, frozen top row and dropdown menus are set up automatically.
- **Autofill applications**: fill a whole application in one click: contact details, links, resume upload, education, work authorization, common screening questions and voluntary self-identification. Tested on Greenhouse, Lever and Ashby. Also built for Workday, LinkedIn Easy Apply, Handshake and plain HTML forms.
- **Drafts written answers**: open-ended questions like "Why do you want to work here?" and cover letters are drafted by Claude from your resume, profile and the job description, using your own Claude subscription. Drafts are highlighted purple for you to review.
- **Learns your answers**: answer a company's custom question once, click **Remember my answers on this page**, and it's reused when a similar question comes up.

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

### 4. Written answers with Claude (optional)

ApplyLog drafts open-ended answers through [Claude Code](https://claude.com/claude-code) running on your Mac, so it uses your Claude Pro or Max subscription. No API key, and nothing extra to pay.

1. Install Node.js and Claude Code, then run `claude` in Terminal once and log in with your Claude account.
2. From this folder, register the helper with Chrome:
   ```bash
   ./native/install.sh
   ```
   It prints the extension ID it allowed. If `chrome://extensions` shows a different ID for ApplyLog, run `./native/install.sh <that-id>`.
3. Reload ApplyLog in `chrome://extensions`, open ⚙ settings and click **Check the drafting helper**.

The helper is a small script (`native/host.js`, copied to `~/Library/Application Support/ApplyLog`) that Chrome starts only when ApplyLog asks for drafts. Only ApplyLog can talk to it. It runs `claude -p` with only the Read tool, in a temporary folder holding a copy of your resume, then deletes the folder. Re-run `install.sh` after updating ApplyLog.

**What it costs:** nothing beyond your subscription. Each application makes one Claude call that drafts all of its written questions together. It sends about 10,000 tokens (your resume, profile and the job description) and gets back a few hundred words. That counts toward your plan's usage limits like a short Claude Code prompt, and takes about 20 to 60 seconds.

This setup is for your own use on your own Mac. Anthropic doesn't allow apps you distribute to other people to run on their claude.ai logins, so a shared or published version of ApplyLog would need API keys instead.

## Usage

1. Open any job posting.
2. Click the ApplyLog icon. Details are pre-filled; fix anything that looks off.
3. Set your status, LinkedIn connection and referral, and add notes.
4. Click **Add to sheet**.

### Autofilling an application

1. In ⚙ settings, fill in **Autofill profile**: your details, resume, common questions and (optionally) self-identification answers. Click **Save profile**. Everything stays in this browser and is never sent to your sheet.
2. On an application form, open ApplyLog and click **Autofill this application**.
3. Check the highlighted fields:
   - **Green**: filled from your profile.
   - **Blue**: filled from a saved answer to a similar question. Double-check these.
   - **Purple**: a written answer drafted by Claude (dashed while it's still drafting). Read it and make it yours.
   - **Amber**: required and still empty. The popup lists them.
4. Answer the rest yourself, then click **Remember my answers on this page** so next time they fill too. You can edit saved answers in settings.
5. Submit the application yourself. ApplyLog never submits.

On multi-page forms (Workday, LinkedIn Easy Apply), it keeps filling each new page as you click **Next** for 30 minutes after you start.

Written answers are drafted only when the drafting helper is set up (step 4) and **Draft written answers with Claude** is on in settings; otherwise those fields are flagged amber. Drafts never replace anything you've typed. Not filled automatically: cover letters uploaded as a file, consent and legal-acknowledgement checkboxes, and pages that need you to sign in first. If a form sits in an iframe from another site, open that iframe in its own tab.

Come back to the same posting later and the extension shows your saved tracking info, ready to update.

## Project structure

```
extension/
  manifest.json      Chrome extension config (Manifest V3)
  popup.html/css/js  The popup form and job-detail scraping
  autofill.js        Fills application forms (runs in the extension's isolated world)
  bridge.js          Small page-side helper for React dropdowns
  options.html/js    Settings page
  background.js      Passes draft requests to the native helper
  icons/
native/
  host.js            Drafting helper: runs the claude CLI (native messaging host)
  install.sh         Registers the helper with Chrome
apps-script/
  Code.gs            Google Sheets backend
```

## Notes

- Job sites change their page layouts often. If a field stops auto-filling on a site, the selectors live in `extractJob()` in `popup.js`.
- Application autofill matches each question to a profile field using the `RULES` list in `autofill.js`, then falls back to your saved answers. Add a pattern there if a common question isn't recognised.
- Which questions count as open-ended is set by `OPEN_ENDED` and `isOpenEnded()` in `autofill.js`. The drafting instructions are `SYSTEM` in `native/host.js`. Set `APPLYLOG_MODEL` in the launcher it writes to pick a model (for example `sonnet`). By default it uses your Claude Code default.
- After editing `Code.gs`, publish a new version: **Deploy → Manage deployments → Edit → Version: New version**.

## Tech

Chrome Extension Manifest V3, vanilla JavaScript, Google Apps Script, Chrome native messaging with the Claude Code CLI.
