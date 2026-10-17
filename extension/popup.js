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

/**
 * Runs inside the application page (every frame we can reach). Must be fully
 * self-contained. Fills empty fields whose label/name/id/placeholder matches a
 * profile entry. Never overwrites what's already typed and never submits.
 */
function autofillPage(profile) {
  const p = { ...profile };
  p.fullName = [p.firstName, p.lastName].filter(Boolean).join(' ');
  p.location = [p.city, p.state].filter(Boolean).join(', ');

  // Order matters: specific rules first, so "company name" never hits the name rule
  const RULES = [
    ['email', /e-?mail/],
    ['linkedin', /linked ?in/],
    ['github', /git ?hub/],
    ['website', /portfolio|website|personal (site|url)|\bblog\b/],
    ['workAuth', /authori[sz]ed to work|work authori[sz]ation|eligible to work|right to work/],
    ['sponsorship', /sponsor/],
    ['currentCompany', /current (company|employer)|most recent (company|employer)|\bemployer\b|\borganization\b/],
    ['currentTitle', /current (job )?(title|role|position)|most recent (title|role)|\bjob title\b|organization title/],
    ['school', /school|universit|college|institution/],
    ['degree', /\bdegree\b/],
    ['major', /\bmajor\b|discipline|field of study|area of study/],
    ['gradDate', /graduat/],
    ['firstName', /first name|given name|fname|preferred name/],
    ['lastName', /last name|family name|surname|lname/],
    ['fullName', /full name|legal name|your name|^name$/],
    ['phone', /phone|mobile|\btel\b|cell/],
    ['pronouns', /pronoun/],
    ['zip', /\bzip\b|postal|post code|postcode/],
    ['city', /\bcity\b|\btown\b|address level2/],
    ['state', /\bstate\b|province|region|address level1/],
    ['country', /country/],
    ['address', /street|address line ?1|^address$|\baddress$/],
    ['location', /location/],
    ['website', /\burl\b/]
  ];

  const norm = (s) => (s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-\[\].:*?()]+/g, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
  const textOf = (el) => (el ? el.textContent : '');

  function labelFor(el) {
    const parts = [];
    if (el.labels) for (const l of el.labels) parts.push(textOf(l));
    const ids = el.getAttribute('aria-labelledby');
    if (ids) for (const id of ids.split(/\s+/)) parts.push(textOf(document.getElementById(id)));
    if (parts.join('').trim()) return parts.join(' ');
    // Fall back to the nearest container that holds only this field
    let node = el.parentElement;
    for (let i = 0; node && i < 4; i++, node = node.parentElement) {
      const fields = node.querySelectorAll('input:not([type=hidden]), select, textarea');
      const others = [...fields].filter((f) => f !== el && !(el.type === 'radio' && f.name === el.name));
      if (others.length) break;
      const lab = node.querySelector('label, legend, [class*="label" i], [class*="question" i]');
      if (lab && textOf(lab).trim()) return textOf(lab);
    }
    return '';
  }

  function keyFor(el) {
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    const byAc = { 'given-name': 'firstName', 'family-name': 'lastName', name: 'fullName', email: 'email',
      tel: 'phone', 'tel-national': 'phone', 'address-line1': 'address', 'street-address': 'address',
      'address-level2': 'city', 'address-level1': 'state', 'postal-code': 'zip', 'country-name': 'country',
      country: 'country', organization: 'currentCompany', 'organization-title': 'currentTitle' }[ac.split(' ').pop()];
    if (byAc) return byAc;
    const label = norm(labelFor(el)).slice(0, 200);
    // The visible label is the most trustworthy signal; try it alone first
    const candidates = [label, norm([el.getAttribute('aria-label'), el.placeholder, el.name, el.id].join(' '))];
    for (const text of candidates) {
      if (!text) continue;
      for (const [key, re] of RULES) if (re.test(text)) return key;
    }
    return null;
  }

  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

  // Set values through the native setter so React/Vue forms notice the change
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    for (const type of ['input', 'change', 'blur']) el.dispatchEvent(new Event(type, { bubbles: true }));
  }

  function pickOption(options, value) {
    const v = value.toLowerCase();
    const label = (o) => norm(o.text || o.label || o.value);
    return options.find((o) => label(o) === v || (o.value || '').toLowerCase() === v)
      || options.find((o) => new RegExp('^' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(label(o)))
      || (v.length > 2 && options.find((o) => label(o).includes(v)));
  }

  const highlight = (el) => { el.style.outline = '2px solid #34a853'; el.style.outlineOffset = '1px'; };
  const filled = [];
  const doneRadioGroups = new Set();

  for (const el of document.querySelectorAll('input, textarea, select')) {
    const type = (el.type || '').toLowerCase();
    if (el.disabled || el.readOnly || !visible(el)) continue;
    if (['hidden', 'file', 'submit', 'button', 'reset', 'image', 'password', 'checkbox', 'search'].includes(type)) continue;

    if (type === 'radio') {
      if (!el.name || doneRadioGroups.has(el.name)) continue;
      doneRadioGroups.add(el.name);
      const group = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
      if (group.some((r) => r.checked)) continue;
      // The question is the text of the smallest container holding the whole group
      let box = el.closest('fieldset, [role=radiogroup]') || el.parentElement;
      while (box && !group.every((r) => box.contains(r))) box = box.parentElement;
      while (box && box.parentElement && norm(textOf(box)).length < 15 + group.length * 4) box = box.parentElement;
      const legend = box && box.querySelector('legend');
      const question = norm(legend ? textOf(legend) : textOf(box)).slice(0, 300);
      const key = RULES.find(([, re]) => re.test(question));
      const value = key && p[key[0]];
      if (!value) continue;
      const choice = pickOption(group.map((r) => ({ el: r, text: [...(r.labels || [])].map(textOf).join(' '), value: r.value })), value);
      if (choice) { choice.el.click(); highlight(choice.el); filled.push(key[0]); }
      continue;
    }

    const key = keyFor(el);
    const value = key && p[key];
    if (!value) continue;

    if (el.tagName === 'SELECT') {
      if (el.value && el.selectedIndex > 0) continue;
      const opt = pickOption([...el.options], value);
      if (!opt) continue;
      setValue(el, opt.value);
    } else {
      if (el.value.trim()) continue;
      setValue(el, value);
    }
    highlight(el);
    filled.push(key);
  }
  return filled;
}

$('autofillBtn').addEventListener('click', async () => {
  const msg = $('autofillMsg');
  const { profile } = await chrome.storage.local.get('profile');
  if (!profile || !Object.values(profile).some(Boolean)) {
    msg.textContent = 'Add your details under ⚙ Settings → Autofill profile first.';
    msg.className = 'msg err';
    return;
  }
  const btn = $('autofillBtn');
  btn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let results;
    try {
      // Many application forms (e.g. Greenhouse embeds) live in an iframe
      results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: autofillPage, args: [profile] });
    } catch (e) {
      results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: autofillPage, args: [profile] });
    }
    const filled = results.flatMap((r) => r.result || []);
    msg.textContent = filled.length
      ? `✓ Filled ${filled.length} field${filled.length === 1 ? '' : 's'}. Review them before submitting.`
      : 'No matching empty fields found on this page.';
    msg.className = filled.length ? 'msg ok' : 'msg';
  } catch (err) {
    msg.textContent = 'Can’t fill this page.';
    msg.className = 'msg err';
  } finally {
    btn.disabled = false;
  }
});

const openOptions = () => chrome.runtime.openOptionsPage();
$('openOptions').addEventListener('click', openOptions);
$('setupBtn').addEventListener('click', openOptions);

init();
