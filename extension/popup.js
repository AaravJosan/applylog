const $ = (id) => document.getElementById(id);
const DETAIL_FIELDS = ['title', 'company', 'location', 'url'];
const TRACK_FIELDS = ['status', 'connected', 'contact', 'referral', 'notes', 'nextAction', 'dueDate'];

/**
 * Runs inside the job posting page. Must be fully self-contained.
 * Tries structured data first (JSON-LD JobPosting), then site-specific
 * selectors, then generic fallbacks.
 */
function extractJob() {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const txt = (selectors) => {
    for (const s of [].concat(selectors)) {
      const el = document.querySelector(s);
      const t = el && clean(el.textContent);
      if (t) return t;
    }
    return '';
  };
  const meta = (name) => {
    const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
    return el ? clean(el.content) : '';
  };
  const titleCase = (slug) => (slug || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const out = { title: '', company: '', location: '', url: window.location.href };

  // 1. Structured data used by most job boards (and Google for Jobs)
  const findJob = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const n of node) { const r = findJob(n); if (r) return r; }
      return null;
    }
    const t = node['@type'];
    if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) return node;
    if (node['@graph']) return findJob(node['@graph']);
    return null;
  };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const job = findJob(JSON.parse(s.textContent));
      if (!job) continue;
      out.title = clean(job.title);
      const org = job.hiringOrganization;
      out.company = clean(typeof org === 'string' ? org : org && org.name);
      const places = [].concat(job.jobLocation || []).map((l) => {
        const a = (l && l.address) || {};
        if (typeof a === 'string') return clean(a);
        const country = a.addressCountry && (a.addressCountry.name || a.addressCountry);
        return [a.addressLocality, a.addressRegion, country].filter((x) => typeof x === 'string' && x).join(', ');
      }).filter(Boolean);
      out.location = places.join(' / ');
      if (job.jobLocationType === 'TELECOMMUTE') out.location = out.location ? `Remote / ${out.location}` : 'Remote';
      break;
    } catch (e) { /* ignore malformed JSON-LD */ }
  }

  // 2. Site-specific selectors
  const host = window.location.hostname;
  const pathParts = window.location.pathname.split('/').filter(Boolean);

  if (host.includes('linkedin.com')) {
    out.title = out.title || txt([
      '.job-details-jobs-unified-top-card__job-title h1',
      '.job-details-jobs-unified-top-card__job-title',
      '.jobs-unified-top-card__job-title',
      '.top-card-layout__title',
      'main h1'
    ]);
    out.company = out.company || txt([
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name',
      '.topcard__org-name-link'
    ]);
    out.location = out.location || txt([
      '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
      '.job-details-jobs-unified-top-card__bullet',
      '.jobs-unified-top-card__bullet',
      '.topcard__flavor--bullet'
    ]).split('·')[0].trim();
    const id = new URLSearchParams(window.location.search).get('currentJobId')
      || (window.location.pathname.match(/\/jobs\/view\/(\d+)/) || [])[1];
    // Newer LinkedIn layouts use generated class names, so fall back to the tab title
    // ("Job title | Company | LinkedIn") and the text around the title in the top card.
    const parts = document.title.replace(/^\(\d+\+?\)\s*/, '').split(' | ');
    if (parts.length >= 3 && /linkedin/i.test(parts[parts.length - 1])) {
      out.title = out.title || clean(parts[0]);
      out.company = out.company || clean(parts[1]);
    }
    // The title also appears in the results list; use the details panel (the card with Apply/Save buttons).
    const cards = (out.title ? [...document.querySelectorAll('h1, h2, a, p')] : [])
      .filter((e) => clean(e.textContent) === out.title)
      .map((heading) => {
        let card = heading;
        for (let i = 0; i < 8 && card && !card.querySelector('a[href*="/company/"]'); i++) card = card.parentElement;
        for (let i = 0; i < 2 && card && card.parentElement; i++) card = card.parentElement;
        return card;
      }).filter(Boolean);
    const card = cards.find((c) => c.querySelector('button')) || cards[0];
    if (card && !out.location) {
      const lines = [...new Set([...card.querySelectorAll('p, span, div, li')]
        .filter((e) => ![...e.children].some((c) => /^(P|SPAN|DIV|LI)$/.test(c.tagName)))
        .map((e) => clean(e.textContent)).filter(Boolean))];
      const places = lines.filter((t) => t !== out.company && t !== out.title && t.length < 80 && /[a-z]/i.test(t)
        && !/\b(ago|applicants?|clicked|people|promoted|responses|apply|save|reposted|alumni|connections?|work here|full-time|part-time|internship|contract|easy)\b/i.test(t)
        && !/^(on-site|remote|hybrid)$/i.test(t));
      const place = places.find((t) => /,|\bremote\b|united states/i.test(t)) || places[0] || '';
      const mode = lines.find((t) => /^(on-site|remote|hybrid)$/i.test(t));
      out.location = mode && !place.includes(`(${mode})`) ? [place, `(${mode})`].filter(Boolean).join(' ') : place;
    }
    if (id) out.url = `https://www.linkedin.com/jobs/view/${id}/`;
  } else if (host.includes('indeed.')) {
    out.title = out.title || txt(['[data-testid="jobsearch-JobInfoHeader-title"]', 'h1']).replace(/\s*-\s*job post$/i, '');
    out.company = out.company || txt(['[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]']);
    out.location = out.location || txt(['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]']);
    const jk = new URLSearchParams(window.location.search).get('vjk') || new URLSearchParams(window.location.search).get('jk');
    if (jk) out.url = `https://${host}/viewjob?jk=${jk}`;
  } else if (host.includes('greenhouse.io')) {
    out.title = out.title || txt(['.app-title', '.job__title h1', 'h1']);
    out.company = out.company || txt(['.company-name']).replace(/^at\s+/i, '')
      || clean((document.title.match(/^Job Application for .+ at (.+)$/) || [])[1]) || titleCase(pathParts[0]);
    out.location = out.location || txt(['.location', '.job__location']);
  } else if (host.includes('lever.co')) {
    out.title = out.title || txt(['.posting-headline h2', 'h2']);
    out.company = out.company || titleCase(pathParts[0]);
    out.location = out.location || txt(['.posting-categories .location', '.sort-by-location']);
  } else if (host.includes('ashbyhq.com')) {
    out.title = out.title || txt(['h1']);
    out.company = out.company || titleCase(pathParts[0]);
  } else if (host.includes('myworkdayjobs.com')) {
    out.title = out.title || txt(['[data-automation-id="jobPostingHeader"]', 'h2']);
    // Workday's structured data repeats the country and names the legal entity ("2100 NVIDIA USA"),
    // so prefer the page's location and the subdomain, keeping the posting's capitalization.
    out.location = txt(['[data-automation-id="jobPostingPage"] [data-automation-id="locations"] dd', '[data-automation-id="locations"] dd']) || out.location;
    const slug = host.split('.')[0];
    const inName = (out.company.match(new RegExp(slug.replace(/[^a-z0-9]/gi, ''), 'i')) || [])[0];
    out.company = inName || titleCase(slug);
  } else if (host.includes('joinhandshake.com')) {
    // Job details live in the right-hand panel on /job-search/<id>, or the whole page on /jobs/<id>
    const panel = document.querySelector('[data-hook="right-content"]') || document.querySelector('main') || document;
    out.title = out.title || clean((panel.querySelector('h1') || {}).textContent);
    const employer = [...panel.querySelectorAll('a[href*="/e/"], a[href*="/employers/"]')]
      .map((a) => clean(a.textContent)).find((t) => t && !/^learn more/i.test(t));
    out.company = out.company || employer || '';
    const glance = [...panel.querySelectorAll('h2, h3')].find((h) => /at a glance/i.test(h.textContent));
    if (glance && !out.location) {
      let box = glance.parentElement;
      while (box && box !== panel && box.querySelectorAll('*').length < 5) box = box.parentElement;
      const lines = [...(box || glance).querySelectorAll('*')].filter((e) => !e.children.length).map((e) => clean(e.textContent));
      out.location = lines.find((t) => /\b(remote|hybrid|on-?site|based in)\b/i.test(t)) || '';
    }
    const id = (window.location.pathname.match(/\/(?:jobs|job-search)\/(\d+)/) || [])[1];
    if (id) out.url = `https://${host}/jobs/${id}`;
  }

  // 3. Generic fallbacks (company career sites without structured data)
  // Page titles look like "Job title - Jobs - Careers at Apple" or "Job title — Google Careers":
  // keep the first part, and read the company from the "Careers" part if there is one.
  const titleParts = (meta('og:title') || clean(document.title)).split(/\s+[|–—-]\s+/);
  const siteParts = titleParts.slice(1).filter((p) => /\b(careers?|jobs?|hiring)\b/i.test(p));
  const fromTitle = siteParts.map((p) => clean(p.replace(/^(careers?|jobs?)\s+(at|@)\s+/i, '').replace(/\s+(careers?|jobs?)$/i, '')))
    .find((p) => p && !/\b(careers?|jobs?|hiring)\b/i.test(p));
  const pageTitle = titleParts.filter((p) => !siteParts.includes(p)).join(' - ');
  const domain = host.replace(/^(www|careers?|jobs?|apply)\./, '').split('.');
  const fromHost = titleCase(domain.length > 2 && /^(co|com)$/.test(domain[domain.length - 2]) ? domain[domain.length - 3] : domain[domain.length - 2]);
  const siteName = meta('og:site_name').replace(/\.(jobs|com|careers)$/i, '');
  out.title = out.title || pageTitle || txt('h1');
  out.company = out.company || fromTitle || siteName || fromHost;
  out.location = out.location || txt(['[itemprop="jobLocation"]', '[id*="joblocation" i]', '[class*="job-location" i]', '[class*="joblocation" i]', '[data-testid*="job-location" i]']);

  for (const k of Object.keys(out)) out[k] = (out[k] || '').slice(0, 500);
  return out;
}

function showMsg(text, type = '') {
  const m = $('msg');
  m.textContent = text;
  m.className = `msg ${type}`;
}

async function getSettings() {
  return chrome.storage.sync.get({ webAppUrl: '', secret: '' });
}

async function callSheet(payload) {
  const { webAppUrl, secret } = await getSettings();
  if (!webAppUrl) throw new Error('Add your Apps Script URL in settings first.');
  const res = await fetch(webAppUrl, {
    method: 'POST',
    // text/plain avoids a CORS preflight that Apps Script can't answer
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...payload, secret })
  });
  if (!res.ok) throw new Error(`Sheet returned HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Unknown error from your sheet');
  return data;
}

function setValues(obj, fields) {
  for (const f of fields) if (obj[f] !== undefined && obj[f] !== '') $(f).value = obj[f];
}

async function lookupExisting(url) {
  try {
    const data = await callSheet({ action: 'lookup', url, company: $('company').value });
    if (data.found) {
      setValues(data.job, TRACK_FIELDS);
      $('existingBanner').hidden = false;
      $('saveBtn').textContent = 'Update row in sheet';
    } else if (data.shared) {
      // New job at a company you've tracked before: carry over who you know there
      setValues(data.shared, ['connected', 'contact', 'referral']);
    }
  } catch (e) { /* lookup is a nice-to-have; ignore failures */ }
}

async function init() {
  const settings = await getSettings();
  $('setupBanner').hidden = !!settings.webAppUrl;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) $('url').value = tab.url;

  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractJob });
    setValues(result, DETAIL_FIELDS);
    if (!result.company || !result.title) showMsg('Couldn’t find every detail. Check the fields above.');
  } catch (e) {
    showMsg('Can’t read this page. Fill in the details manually.');
  }

  if (settings.webAppUrl && $('url').value) lookupExisting($('url').value);
  if (settings.webAppUrl) loadDashboard();
  else $('dashboardMsg').textContent = 'Connect your Google Sheet to see overdue and stale items.';
  initOutreach(tab, settings);
}

async function loadDashboard() {
  const box = $('dashboardMsg');
  const list = $('attentionList');
  try {
    const data = await callSheet({ action: 'dashboard' });
    list.replaceChildren();
    const entries = [
      ...data.overdue.map((x) => ({ ...x, kind: 'Action overdue', due: true })),
      ...data.stale.map((x) => ({ ...x, kind: 'No update in 7+ days', due: false }))
    ].slice(0, 8);
    box.textContent = entries.length || data.overdueOutreach ? '' : 'Nothing overdue or stale.';
    for (const item of entries) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.textContent = `${item.title || 'Untitled job'} · ${item.company || 'Unknown company'}`;
      a.href = item.url || '#';
      a.target = '_blank';
      const meta = document.createElement('span');
      meta.className = `meta${item.due ? ' is-due' : ''}`;
      meta.textContent = [item.kind, item.nextAction, item.dueDate && `Due ${item.dueDate}`].filter(Boolean).join(' · ');
      li.append(a, meta);
      list.append(li);
    }
    if (data.overdueOutreach) {
      const li = document.createElement('li');
      li.className = 'meta is-due';
      li.textContent = `${data.overdueOutreach} overdue outreach follow-up${data.overdueOutreach === 1 ? '' : 's'}${data.outreachNames.length ? `: ${data.outreachNames.join(', ')}` : ''}`;
      list.append(li);
    }
  } catch (e) {
    box.textContent = 'Could not load attention list.';
  }
}

$('findPeople').addEventListener('click', () => {
  const company = $('company').value.trim();
  if (!company) { showMsg('Enter a company name first.', 'err'); return; }
  const url = 'https://www.linkedin.com/search/results/people/?keywords='
    + encodeURIComponent(company) + '&network=%5B%22F%22%5D';
  chrome.tabs.create({ url });
});

$('jobForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('saveBtn');
  btn.disabled = true;
  showMsg('Saving…');
  const payload = { action: 'save' };
  for (const f of [...DETAIL_FIELDS, ...TRACK_FIELDS]) payload[f] = $(f).value.trim();
  try {
    const data = await callSheet(payload);
    rememberJob(payload.company, payload.url);
    if (!$('oCompany').value.trim()) { $('oCompany').value = payload.company; loadOutreach(); }
    showMsg(data.action === 'updated' ? `✓ Updated row ${data.row}` : `✓ Added to row ${data.row}`, 'ok');
    $('existingBanner').hidden = false;
    btn.textContent = 'Update row in sheet';
  } catch (err) {
    showMsg(err.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

async function injectAutofill(tabId) {
  // Many application forms (e.g. Greenhouse embeds) live in an iframe; fall back to the top frame
  for (const allFrames of [true, false]) {
    try {
      const target = { tabId, allFrames };
      await chrome.scripting.executeScript({ target, files: ['bridge.js'], world: 'MAIN' });
      await chrome.scripting.executeScript({ target, files: ['autofill.js'] });
      return target;
    } catch (e) {
      if (!allFrames) throw e;
    }
  }
}

function showAutofillMsg(text, type = '') {
  $('autofillMsg').textContent = text;
  $('autofillMsg').className = `msg ${type}`;
}

// Pick which resume autofill uploads and Claude reads (when you've saved more than one)
async function initResumePicker() {
  const { resumes, resumeId } = await getResumes();
  const pick = $('resumePick');
  for (const r of resumes) pick.add(new Option(r.label, r.id));
  pick.value = resumeId;
  $('resumeRow').hidden = resumes.length < 2;
}

$('resumePick').addEventListener('change', (e) => chrome.storage.local.set({ resumeId: e.target.value }));

$('autofillBtn').addEventListener('click', async () => {
  const { profile = {}, answers = [], draftsEnabled = true } =
    await chrome.storage.local.get(['profile', 'answers', 'draftsEnabled']);
  const resume = await getActiveResume();
  if (!Object.values(profile).some(Boolean)) {
    showAutofillMsg('Add your details under ⚙ Settings → Autofill profile first.', 'err');
    return;
  }
  const btn = $('autofillBtn');
  btn.disabled = true;
  showAutofillMsg('Filling…');
  try {
    await chrome.storage.local.set({ lastAutofillResume: { url: $('url').value.trim(), resume } });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const target = await injectAutofill(tab.id);
    // Embedded forms (a Greenhouse iframe on a company careers site) can't see the
    // job description around them, so read it from the top page and pass it in
    const [{ result: job }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: () => window.__applylog && window.__applylog.job()
    });
    const results = await chrome.scripting.executeScript({
      target, func: (data) => window.__applylog && window.__applylog.fill(data),
      args: [{ profile, answers, resume, drafts: draftsEnabled, job }]
    });
    const filled = [], saved = [], missing = [], drafting = [];
    for (const { result } of results) {
      if (!result) continue;
      filled.push(...result.filled);
      saved.push(...result.saved);
      missing.push(...result.missing);
      drafting.push(...(result.drafting || []));
    }
    const total = filled.length + saved.length;
    let text = total ? `✓ Filled ${total} field${total === 1 ? '' : 's'}` : 'No matching empty fields found';
    if (saved.length) text += ` (${saved.length} from saved answers, in blue)`;
    if (missing.length) text += `. Still needs you: ${missing.slice(0, 4).join('; ')}${missing.length > 4 ? ` +${missing.length - 4} more` : ''}`;
    if (drafting.length) text += `. Asking Claude about ${drafting.length} question${drafting.length === 1 ? '' : 's'} (purple when ready, under a minute; you can close this)`;
    showAutofillMsg(text + '. Review before submitting.', total || drafting.length ? 'ok' : '');
  } catch (err) {
    showAutofillMsg('Can’t fill this page.', 'err');
  } finally {
    btn.disabled = false;
  }
});

$('rememberBtn').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const target = await injectAutofill(tab.id);
    const results = await chrome.scripting.executeScript({ target, func: () => window.__applylog && window.__applylog.capture() });
    const found = results.flatMap((r) => r.result || []);
    const { answers = [] } = await chrome.storage.local.get('answers');
    const byQuestion = new Map(answers.map((x) => [x.q.toLowerCase(), x]));
    for (const x of found) byQuestion.set(x.q.toLowerCase(), x);
    await chrome.storage.local.set({ answers: [...byQuestion.values()] });
    showAutofillMsg(found.length ? `✓ Saved ${found.length} answer${found.length === 1 ? '' : 's'} for next time` : 'No new answers to save on this page.', found.length ? 'ok' : '');
  } catch (err) {
    showAutofillMsg('Can’t read this page.', 'err');
  }
});

// Save a point-in-time copy of the application answers and selected resume.
$('recordBtn').addEventListener('click', async () => {
  const btn = $('recordBtn');
  btn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const target = await injectAutofill(tab.id);
    const frames = await chrome.scripting.executeScript({ target, func: () => window.__applylog && window.__applylog.answers() });
    // Earlier steps of a multi-page form are gone from the page; autofill kept them as you went
    const stepsKey = `steps_${tab.id}`;
    const { [stepsKey]: steps } = await chrome.storage.session.get(stepsKey);
    let origin = '';
    try { origin = new URL(tab.url).origin; } catch (e) { /* leave earlier steps out */ }
    const merged = new Map(steps && steps.origin === origin && Date.now() - steps.updated < 3 * 60 * 60 * 1000 ? steps.answers : []);
    for (const { question, answer } of frames.flatMap((f) => f.result || [])) {
      if (answer) merged.set(question, answer);
    }
    const answers = [...merged].map(([question, answer]) => ({ question, answer }));
    const { lastAutofillResume } = await chrome.storage.local.get('lastAutofillResume');
    const resume = lastAutofillResume && lastAutofillResume.url === $('url').value.trim()
      ? lastAutofillResume.resume : await getActiveResume();
    const job = {
      url: $('url').value.trim(), title: $('title').value.trim(), company: $('company').value.trim(),
      savedAt: new Date().toISOString(), answers,
      resume: resume ? { id: resume.id, label: resume.label, name: resume.name, type: resume.type, size: resume.size, data: resume.data } : null
    };
    const { applicationRecords = [] } = await chrome.storage.local.get('applicationRecords');
    const records = applicationRecords.filter((x) => x.url !== job.url);
    records.unshift(job);
    await chrome.storage.local.set({ applicationRecords: records.slice(0, 20) });
    await chrome.storage.session.remove(stepsKey);
    showAutofillMsg(`✓ Saved ${answers.length} answers${resume ? ` and ${resume.label} resume` : ''} on this device.`, 'ok');
    // You've submitted it, so mark the sheet row Applied (unless it's already further along)
    if (['', 'Saved'].includes($('status').value)) $('status').value = 'Applied';
    $('jobForm').requestSubmit();
  } catch (err) {
    showAutofillMsg('Could not save this application record.', 'err');
  } finally { btn.disabled = false; }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'draftDone') return;
  if (msg.ok) showAutofillMsg(`✓ Claude answered ${msg.count} question${msg.count === 1 ? '' : 's'} (purple). Check them before submitting; any left red need you.`, 'ok');
  else showAutofillMsg(`Couldn’t draft answers: ${msg.error}`, 'err');
});

// ---------- Outreach ----------

const O_STATUSES = ['To contact', 'Request sent', 'Connected', 'Messaged', 'Replied',
  'Referral asked', 'Referral received', 'No response'];
let outreachJobUrl = '';

/** Runs inside a LinkedIn profile page you have open: reads the name and headline. */
function extractProfile() {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const h1 = document.querySelector('main h1') || document.querySelector('h1');
  const name = clean(h1 && h1.textContent) || clean(document.title.split('|')[0]).replace(/^\(\d+\)\s*/, '');
  // The headline is the first line of text after the name in the top card
  let role = '';
  const card = h1 && h1.closest('section');
  if (card) {
    const lines = [...card.querySelectorAll('div, span')]
      .filter((e) => !e.children.length).map((e) => clean(e.textContent)).filter(Boolean);
    const i = lines.indexOf(name);
    role = lines.slice(i + 1).find((t) => t.length > 3 && !/^(·|he\/him|she\/her|they\/them|\d+(st|nd|rd|th))/i.test(t)) || '';
  }
  const slug = (window.location.pathname.match(/^\/in\/([^/]+)/) || [])[1];
  return { name, role: role.slice(0, 200), profileUrl: slug ? `https://www.linkedin.com/in/${slug}/` : '' };
}

function showOMsg(text, type = '') {
  $('oMsg').textContent = text;
  $('oMsg').className = `msg ${type}`;
}

/** The last job you saved, so outreach on a profile page knows which company it's for. */
function rememberJob(company, url) {
  if (company) chrome.storage.local.set({ lastCompany: company, lastJobUrl: url || '' });
}

async function initOutreach(tab, settings) {
  for (const st of O_STATUSES) $('oStatus').add(new Option(st));
  const { lastCompany = '', lastJobUrl = '' } = await chrome.storage.local.get(['lastCompany', 'lastJobUrl']);
  const onProfile = tab && /^https:\/\/www\.linkedin\.com\/in\//.test(tab.url || '');

  if (onProfile) {
    // A profile page isn't a job, so outreach goes to the last company you saved
    $('oCompany').value = lastCompany;
    outreachJobUrl = lastJobUrl;
    try {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractProfile });
      $('oName').value = result.name || '';
      $('oRole').value = result.role || '';
      $('oProfileUrl').value = result.profileUrl || '';
      $('oStatus').value = 'Request sent';
      $('addPerson').open = true;
    } catch (e) { /* fill it in by hand */ }
    $('outreach').scrollIntoView();
  } else {
    $('oCompany').value = $('company').value.trim() || lastCompany;
    outreachJobUrl = $('company').value.trim() ? $('url').value : lastJobUrl;
  }
  if (settings.webAppUrl) loadOutreach();
}

async function loadOutreach() {
  const company = $('oCompany').value.trim();
  try {
    const data = await callSheet({ action: 'outreachList', company });
    renderDue(data);
    renderPeople(data.people, company);
  } catch (e) {
    showOMsg(e.message, 'err');
  }
}

function renderDue(data) {
  const line = $('dueLine');
  line.replaceChildren();
  line.hidden = !data.due;
  if (!data.due) return;
  line.append(`${data.due} follow-up${data.due === 1 ? '' : 's'} due: ${data.dueNames.join(', ')}${data.due > data.dueNames.length ? '…' : ''} `);
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'link-btn';
  open.textContent = 'Open sheet →';
  open.addEventListener('click', () => chrome.tabs.create({ url: data.sheetUrl }));
  line.append(open);
}

function renderPeople(people, company) {
  const list = $('people');
  list.replaceChildren();
  if (!company) return;
  if (!people.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = `No one at ${company} yet.`;
    list.append(li);
    return;
  }
  for (const p of people) {
    const li = document.createElement('li');
    const who = document.createElement('div');
    who.className = 'who';
    const name = document.createElement(/^https:\/\/(www\.)?linkedin\.com\//.test(p.profileUrl) ? 'a' : 'strong');
    name.textContent = p.name;
    if (name.tagName === 'A') { name.href = p.profileUrl; name.target = '_blank'; }
    const meta = document.createElement('span');
    meta.className = `meta${p.due ? ' is-due' : ''}`;
    meta.textContent = [p.due ? 'Follow up now' : p.followUp && `Follow up ${p.followUp}`, p.role]
      .filter(Boolean).join(' · ');
    who.append(name, meta);

    const sel = document.createElement('select');
    for (const st of O_STATUSES) sel.add(new Option(st));
    if (p.status && !O_STATUSES.includes(p.status)) sel.add(new Option(p.status));
    sel.value = p.status || 'To contact';
    sel.setAttribute('aria-label', `Status for ${p.name}`);
    sel.addEventListener('change', async () => {
      sel.disabled = true;
      try {
        await callSheet({ action: 'outreachSave', ...p, status: sel.value });
        showOMsg(`✓ ${p.name}: ${sel.value}`, 'ok');
        await loadOutreach();
      } catch (e) {
        showOMsg(e.message, 'err');
        sel.disabled = false;
      }
    });
    li.append(who, sel);
    list.append(li);
  }
}

$('oCompany').addEventListener('change', () => {
  rememberJob($('oCompany').value.trim(), outreachJobUrl);
  loadOutreach();
});

$('oAdd').addEventListener('click', async () => {
  const person = {
    name: $('oName').value.trim(),
    company: $('oCompany').value.trim(),
    role: $('oRole').value.trim(),
    profileUrl: $('oProfileUrl').value.trim(),
    jobUrl: outreachJobUrl,
    status: $('oStatus').value,
    notes: $('oNotes').value.trim()
  };
  if (!person.name || !person.company) { showOMsg('Add a name and company first.', 'err'); return; }
  const btn = $('oAdd');
  btn.disabled = true;
  try {
    const data = await callSheet({ action: 'outreachSave', ...person });
    showOMsg(data.action === 'updated' ? `✓ Updated ${person.name}` : `✓ Added ${person.name}`, 'ok');
    for (const id of ['oName', 'oProfileUrl', 'oRole', 'oNotes']) $(id).value = '';
    $('oStatus').value = 'To contact';
    await loadOutreach();
  } catch (e) {
    showOMsg(e.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

const openOptions = () => chrome.runtime.openOptionsPage();
$('openOptions').addEventListener('click', openOptions);
$('setupBtn').addEventListener('click', openOptions);

initResumePicker();
init();
