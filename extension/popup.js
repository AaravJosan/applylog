const $ = (id) => document.getElementById(id);
const DETAIL_FIELDS = ['title', 'company', 'location', 'url'];
const TRACK_FIELDS = ['status', 'connected', 'contact', 'referral', 'notes'];

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
    if (id) out.url = `https://www.linkedin.com/jobs/view/${id}/`;
  } else if (host.includes('indeed.')) {
    out.title = out.title || txt(['[data-testid="jobsearch-JobInfoHeader-title"]', 'h1']).replace(/\s*-\s*job post$/i, '');
    out.company = out.company || txt(['[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]']);
    out.location = out.location || txt(['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]']);
    const jk = new URLSearchParams(window.location.search).get('vjk') || new URLSearchParams(window.location.search).get('jk');
    if (jk) out.url = `https://${host}/viewjob?jk=${jk}`;
  } else if (host.includes('greenhouse.io')) {
    out.title = out.title || txt(['.app-title', '.job__title h1', 'h1']);
    out.company = out.company || txt(['.company-name']).replace(/^at\s+/i, '') || titleCase(pathParts[0]);
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
    out.location = out.location || txt(['[data-automation-id="locations"] dd']);
    out.company = out.company || titleCase(host.split('.')[0]);
  }

  // 3. Generic fallbacks
  out.title = out.title || meta('og:title') || txt('h1') || clean(document.title);
  out.company = out.company || meta('og:site_name');

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
    const data = await callSheet({ action: 'lookup', url });
    if (data.found) {
      setValues(data.job, TRACK_FIELDS);
      $('existingBanner').hidden = false;
      $('saveBtn').textContent = 'Update row in sheet';
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
    showMsg(data.action === 'updated' ? `✓ Updated row ${data.row}` : `✓ Added to row ${data.row}`, 'ok');
    $('existingBanner').hidden = false;
    btn.textContent = 'Update row in sheet';
  } catch (err) {
    showMsg(err.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

const openOptions = () => chrome.runtime.openOptionsPage();
$('openOptions').addEventListener('click', openOptions);
$('setupBtn').addEventListener('click', openOptions);

init();
