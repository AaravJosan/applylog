# ApplyLog

A Chrome extension that saves job postings to a Google Sheet in one click, and tracks the networking side of your search: LinkedIn connections, contacts and referrals.

## Features

- **One-click capture**: open a job posting, click the extension, and the title, company, location and URL are filled in for you.
- **Works on major job sites**: LinkedIn, Indeed, Handshake, Greenhouse, Lever, Ashby, Workday, plus any site that publishes standard `JobPosting` structured data.
- **Networking columns**: track whether you're connected with someone at the company, who your contact is, and your referral status.
- **Find connections fast**: one button opens a LinkedIn search for your 1st-degree connections at that company.
- **Outreach tracker**: log the people you reach out to at each company (name, LinkedIn profile, role, status) in an Outreach tab, with follow-up dates set for you and due ones highlighted.
- **No duplicates**: revisit a job you've already saved and the extension loads its row, so you can update status or referral instead of adding a new one.
- **Ready-made sheet**: headers, frozen top row and dropdown menus are set up automatically.
- **Autofill applications**: fill a whole application in one click: contact details, links, resume upload, education, work authorization, common screening questions and voluntary self-identification. Tested on Greenhouse, Lever and Ashby. Also built for Workday, LinkedIn Easy Apply, Handshake and plain HTML forms.
- **A resume per kind of role**: save several resumes (Software, Hardware…) and pick which one an application gets. Autofill uploads it and Claude drafts from it.
- **Claude answers the rest**: every question your profile doesn't settle goes to Claude in one batch, with your resume, profile and the job description, using your own Claude subscription. That covers written answers ("Why do you want to work here?", required cover letters), dropdowns, radio buttons, Yes/No buttons, select-all-that-apply checkboxes and multi-selects ("Will you graduate by June 2027?", "Preferred office?", "Which languages?"), and short fields like GPA, graduation date or a portfolio link. Its answers are highlighted purple for you to review. Work authorization, sponsorship, demographic and salary questions are answered only from what you set in your profile (Claude may match your answer to the form's wording, but never guesses one), and consent checkboxes are always left for you.
- **Learns your answers**: answer a company's custom question once, click **Remember my answers on this page**, and it's reused when a similar question comes up.

## Sheet columns

| Date added | Job title | Company | Location | URL | Status | Connected on LinkedIn | Contact | Referral | Notes | Last updated |
|---|---|---|---|---|---|---|---|---|---|---|

- **Status**: Saved, Applied, Interviewing, Offer, Rejected, Withdrawn
- **Connected on LinkedIn**: No, Request sent, Yes
- **Referral**: Not asked, Asked, Received, Declined

An **Outreach** tab tracks the people you contact:

| Date added | Name | Company | Role | LinkedIn URL | Job URL | Status | Last contact | Follow up on | Notes | Last updated |
|---|---|---|---|---|---|---|---|---|---|---|

- **Status**: To contact, Request sent, Connected, Messaged, Replied, Referral asked, Referral received, No response
- **Follow up on** is set when the status changes: 7 days after **Request sent**, 5 days after **Messaged** or **Referral asked**, and today when they've **Connected** (time to send your first message). Other statuses clear it. Rows turn yellow once the date arrives.

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

**What it costs:** nothing beyond your subscription. Each application makes one Claude call that answers all of its open questions together. It sends about 10,000 tokens (your resume, profile and the job description) and gets back a few hundred words. That counts toward your plan's usage limits like a short Claude Code prompt, and takes about 20 to 60 seconds.

This setup is for your own use on your own Mac. Anthropic doesn't allow apps you distribute to other people to run on their claude.ai logins, so a shared or published version of ApplyLog would need API keys instead.

## Usage

1. Open any job posting.
2. Click the ApplyLog icon. Details are pre-filled; fix anything that looks off.
3. Set your status, LinkedIn connection and referral, and add notes.
4. Click **Add to sheet**.

### Autofilling an application

1. In ⚙ settings, fill in **Autofill profile**: your details, resumes, common questions and (optionally) self-identification answers. Click **Save profile**. Everything stays in this browser and is never sent to your sheet.
   - Under **Resumes**, type a name (like *Software* or *Hardware*), then choose the file. Add as many as you like.
2. On an application form, open ApplyLog. If you've saved more than one resume, pick one under **Resume for this application** (it stays selected until you change it). Then click **Autofill this application**.
3. Check the highlighted fields:
   - **Green**: filled from your profile.
   - **Blue**: filled from a saved answer to a similar question. Double-check these.
   - **Purple**: answered by Claude, either a written draft or a choice picked from your profile and resume (dashed while it's still working). Read it and make it yours.
   - **Amber**: required and still empty. Claude leaves a question amber when your profile and resume don't settle it (it won't invent a username or ID). Work authorization, sponsorship, self-identification and salary questions stay amber until you set them in your profile, and consent checkboxes are always yours to tick. Fill in your whole profile once and most applications need nothing from you but a review.
4. Answer the rest yourself, then click **Remember my answers on this page** so next time they fill too. You can edit saved answers in settings.
5. Submit the application yourself. ApplyLog never submits.

On multi-page forms that change pages without reloading (Workday, LinkedIn Easy Apply, Ashby), it keeps filling each new page as you click **Next**, including Claude's answers, for 30 minutes after you start. If a site loads a whole new page for each step, click **Autofill this application** again on each one.

Written answers are drafted only when the drafting helper is set up (step 4) and **Draft written answers with Claude** is on in settings; otherwise those fields are flagged amber. Drafts never replace anything you've typed. Cover letters are drafted only when the form requires one; for an "Attach" or "Enter manually" cover letter, ApplyLog opens the text box first. The phone number's country code picker is filled from your profile's country (USA, US and UK work too), or from your phone number's +code if country is blank. Not filled automatically: consent and legal-acknowledgement checkboxes, and pages that need you to sign in first. Forms embedded from Greenhouse, Lever, Ashby or Workday inside a company's careers site (like Pinterest's) are filled in place. For an iframe from any other site, open that iframe in its own tab.

### Tracking outreach

The **Outreach** section at the bottom of the popup lists everyone you've logged at the current company. Change someone's status from the dropdown and the sheet updates, along with their follow-up date. A yellow line at the top shows follow-ups due across all companies.

1. Save the job, then click **Find my LinkedIn connections at this company**.
2. Open a person's LinkedIn profile and click the ApplyLog icon. **Add a person** is pre-filled with their name, headline and profile link, and the company is the last job you saved. It reads only the profile you have open.
3. Send the connection request or message on LinkedIn yourself, then click **Add to outreach** (status defaults to **Request sent** on a profile).
4. When they accept, set them to **Connected**. After you message them, set **Messaged**, and so on.

You can also add people by hand from any page, for example someone you met at a career fair.

Come back to the same posting later and the extension shows your saved tracking info, ready to update.

## Project structure

```
extension/
  manifest.json      Chrome extension config (Manifest V3)
  popup.html/css/js  The popup form and job-detail scraping
  autofill.js        Fills application forms (runs in the extension's isolated world)
  bridge.js          Small page-side helper for React dropdowns
  resumes.js         Saved resumes and which one is selected
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
- Updating from an older ApplyLog: paste the new `Code.gs`, run `setup` once to create the Outreach tab, then publish a new version.
- After editing `Code.gs`, publish a new version: **Deploy → Manage deployments → Edit → Version: New version**.

## Tech

Chrome Extension Manifest V3, vanilla JavaScript, Google Apps Script, Chrome native messaging with the Claude Code CLI.
