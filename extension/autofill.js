/**
 * ApplyLog application autofill. Injected by the popup into every frame it can
 * reach, in the extension's isolated world, so page scripts never see your
 * profile. Defines window.__applylog = { fill, capture }.
 *
 * Fills only empty fields and never submits. Colours:
 *   green = from your profile, blue = from your saved answers (double-check),
 *   purple = drafted by Claude (read and edit it), amber = required and still empty.
 *
 * Open-ended questions ("Why do you want to work here?") are sent with the job
 * description to the background worker, which asks the native helper to draft them.
 */
(() => {
  if (window.__applylog) return; // already injected into this page

  // Order matters: specific rules first, so "company name" never hits the name rule
  const RULES = [
    ['email', /e-?mail/],
    ['linkedin', /linked ?in/],
    ['github', /git ?hub/],
    ['website', /portfolio|website|personal (site|url)|\bblog\b/],
    ['workAuth', /authori[sz]ed to work|work authori[sz]ation|eligible to work|right to work|legally (able|permitted) to work/],
    ['sponsorship', /sponsor/],
    ['over18', /18 years|at least 18|age of 18|over 18|18 or older/],
    ['relocate', /relocat/],
    ['inOffice', /in.office|on.?site|hybrid|commut|days (a|per) week|\boffice\b/],
    ['startDate', /start date|when can you start|available to start|earliest (possible )?start|notice period/],
    ['salary', /salary|compensation|pay (range|expectation)|desired pay/],
    ['howHeard', /how (did )?you (hear|heard|find|found|learn)|hear(d)? about|where did you (hear|find|see)|referral source/],
    ['gender', /\bgender\b|\bsex\b/],
    ['hispanic', /hispanic|latin[oax]/],
    ['race', /\brace\b|ethnicit/],
    ['veteran', /veteran/],
    ['disability', /disabilit/],
    ['pronouns', /pronoun/],
    ['currentCompany', /current (company|employer)|most recent (company|employer)|\bemployer\b|\borganization\b/],
    ['currentTitle', /current (job )?(title|role|position)|most recent (title|role)|\bjob title\b/],
    ['school', /school|universit|college|institution/],
    ['degree', /\bdegree\b/],
    ['major', /\bmajor\b|discipline|field of study|area of study/],
    ['gradDate', /graduat/],
    ['preferredName', /preferred (first )?name|nickname/],
    ['firstName', /first name|given name|\bfname\b/],
    ['lastName', /last name|family name|surname|\blname\b/],
    ['fullName', /full name|legal name|your name|^name$/],
    ['phone', /phone|mobile|\btel\b|\bcell\b/],
    ['zip', /\bzip\b|postal|post code|postcode/],
    ['city', /\bcity\b|\btown\b|address level2/],
    ['state', /\bstate\b|province|address level1/],
    ['country', /country/],
    ['address', /street|address line ?1|^address$|\baddress$/],
    ['location', /location|where are you (currently )?(based|located)/],
    ['website', /\burl\b/]
  ];

  const AUTOCOMPLETE = {
    'given-name': 'firstName', 'family-name': 'lastName', name: 'fullName', email: 'email', tel: 'phone',
    'tel-national': 'phone', 'address-line1': 'address', 'street-address': 'address', 'address-level2': 'city',
    'address-level1': 'state', 'postal-code': 'zip', 'country-name': 'country', country: 'country',
    organization: 'currentCompany', 'organization-title': 'currentTitle'
  };

  // How a profile value can appear among a form's options
  const SYNONYMS = {
    decline: /decline|don.?t wish|do not wish|prefer not|choose not|not to (say|disclose|answer|self)|rather not|not specified/,
    male: /^(male|man)\b/,
    female: /^(female|woman)\b/,
    'non binary': /non ?binary/,
    'not a protected veteran': /\bnot\b.*veteran|^no\b/,
    'protected veteran': /^(?!.*\bnot\b).*(protected veteran|identify as)|^yes\b/,
    'black or african american': /black|african/,
    'american indian or alaska native': /american indian|alaska/,
    'native hawaiian or other pacific islander': /hawaiian|pacific/,
    'two or more races': /two or more|multi/,
    white: /^white\b/,
    asian: /^asian\b/
  };

  // Forms list countries by full name ("United States +1" in Greenhouse's phone country picker)
  const COUNTRY_ALIASES = {
    usa: 'United States', us: 'United States', 'u s': 'United States', 'u s a': 'United States', america: 'United States',
    'united states of america': 'United States', uk: 'United Kingdom', 'u k': 'United Kingdom', britain: 'United Kingdom',
    'great britain': 'United Kingdom', england: 'United Kingdom', uae: 'United Arab Emirates'
  };
  const DIAL_CODES = {
    1: 'United States', 44: 'United Kingdom', 91: 'India', 61: 'Australia', 86: 'China', 49: 'Germany', 33: 'France',
    81: 'Japan', 82: 'South Korea', 65: 'Singapore', 971: 'United Arab Emirates', 52: 'Mexico', 55: 'Brazil', 234: 'Nigeria',
    92: 'Pakistan', 880: 'Bangladesh', 63: 'Philippines', 84: 'Vietnam', 353: 'Ireland', 31: 'Netherlands', 972: 'Israel'
  };

  const LOCATION_KEYS = new Set(['location', 'city']);
  const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'for', 'and', 'or', 'you', 'your', 'are', 'do', 'is',
    'this', 'with', 'our', 'we', 'be', 'have', 'at', 'on', 'if', 'please', 'optional', 'required']);

  const CONTAINERS = 'fieldset, [role=radiogroup], [role=group], .application-question, .field-wrapper, .field, '
    + '[data-automation-id^="formField"], [class*="fieldEntry"], [class*="field-entry"], [class*="form-field"], '
    + '[class*="FormField"], .jobs-easy-apply-form-element, [data-test-form-element]';
  const TITLES = 'legend, label, [class*="label" i], [class*="title" i], [class*="question" i], [data-automation-id="formLabel"]';
  const PLACEHOLDER_TEXT = /^(select|select one|select\.\.\.|choose|choose one|please select|--|)$/i;

  const COLORS = { profile: '#34a853', saved: '#4285f4', draft: '#a142f4', missing: '#f9ab00' };

  // Questions worth a written answer rather than a lookup
  const OPEN_ENDED = /\bwhy\b|tell (us|me)|describe|cover letter|explain|what (excites|interests|motivates|draws|attracts)|share (a|an|with|about|your)|about yourself|anything else|additional information|elaborate/i;

  let P = {};
  let LIB = [];
  let RESUME = null;
  let DRAFTS = false;
  let PAGE_JOB = null; // job details from the top page, when this form is in an iframe
  let report = null;
  let seen = new WeakSet();
  let observer = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const norm = (s) => clean((s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-\[\].:*✱?()]+/g, ' ')).toLowerCase();
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const textOf = (el) => clean(el ? el.textContent : '');

  // ---------- Working out what a field is asking ----------

  function questionFor(el, ownLabelIsOption = false) {
    if (!ownLabelIsOption) {
      const parts = [];
      if (el.labels) for (const l of el.labels) parts.push(textOf(l));
      const ids = el.getAttribute('aria-labelledby');
      if (ids) for (const id of ids.split(/\s+/)) parts.push(textOf(document.getElementById(id)));
      parts.push(el.getAttribute('aria-label') || '');
      // Labels and aria-label often repeat each other; keep each piece once
      const unique = [...new Set(parts.map(clean).filter(Boolean))];
      const t = unique.filter((x) => !unique.some((y) => y !== x && norm(y).includes(norm(x)))).join(' ');
      // Greenhouse's typed cover letter is labelled "Enter manually"; the question is the group's label
      const group = /^enter manually$/i.test(t) && el.closest('[role=group][aria-labelledby]');
      if (group) return textOf(document.getElementById(group.getAttribute('aria-labelledby'))).slice(0, 250);
      if (t) return t.slice(0, 250);
    }
    const box = el.closest(CONTAINERS);
    if (box) {
      for (const t of box.querySelectorAll(TITLES)) {
        // A label that wraps an input is an option ("Yes"), not the question
        if (t.tagName !== 'LEGEND' && t.querySelector('input, button, select, textarea')) continue;
        if (t.contains(el)) continue;
        const txt = textOf(t);
        if (txt) return txt.slice(0, 250);
      }
    }
    // Fall back to the nearest container whose only field is this one
    let node = el.parentElement;
    for (let i = 0; node && i < 4; i++, node = node.parentElement) {
      const others = [...node.querySelectorAll('input:not([type=hidden]), select, textarea')]
        .filter((f) => f !== el && !(el.name && f.name === el.name));
      if (others.length) break;
      const lab = node.querySelector(TITLES);
      if (lab && textOf(lab)) return textOf(lab).slice(0, 250);
    }
    return '';
  }

  const ruleFor = (text) => { for (const [key, re] of RULES) if (re.test(text)) return key; return null; };

  const tokens = (q) => new Set(norm(q).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w && !STOP.has(w)));
  function savedAnswer(question) {
    const a = tokens(question);
    if (a.size < 2) return null;
    let best = null;
    let bestScore = 0.75;
    for (const entry of LIB) {
      const b = tokens(entry.q);
      let shared = 0;
      for (const w of a) if (b.has(w)) shared++;
      const score = (2 * shared) / (a.size + b.size);
      if (score >= bestScore) { best = entry; bestScore = score; }
    }
    return best && best.a;
  }

  /** Returns { key, value, source } for a field, or null. */
  function answerFor(el, question) {
    let key = ruleFor(norm(question));
    if (!key && el.tagName === 'INPUT') {
      key = AUTOCOMPLETE[(el.getAttribute('autocomplete') || '').toLowerCase().split(' ').pop()]
        || ruleFor(norm([el.getAttribute('aria-label'), el.placeholder, el.name, el.id].join(' ')));
    }
    if (key && P[key]) return { key, value: P[key], source: 'profile' };
    const saved = question && savedAnswer(question);
    if (saved) return { key: key || 'saved', value: saved, source: 'saved' };
    return null;
  }

  function pickOption(options, value) {
    const v = norm(value);
    const syn = SYNONYMS[v];
    const lab = (o) => norm(o.text);
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Several partial matches ("University of Washington - Bothell / Seattle / Tacoma"):
    // take the one naming your city, otherwise leave it for you rather than guess
    const one = (list) => {
      if (list.length <= 1) return list[0] || null;
      const city = norm(P.city);
      const bare = list.filter((o) => !/[a-z]/.test(lab(o).replace(v, ''))); // "United States +1"
      if (bare.length === 1) return bare[0];
      const local = city ? list.filter((o) => lab(o).includes(city)) : [];
      return local.length === 1 ? local[0] : undefined;
    };
    const exact = options.find((o) => lab(o) === v || norm(o.value) === v);
    if (exact) return exact;
    if (syn) { const s = options.find((o) => syn.test(lab(o))); if (s) return s; }
    const prefix = one(options.filter((o) => new RegExp('^' + esc + '\\b').test(lab(o))));
    if (prefix !== null) return prefix || null;
    return (v.length > 3 && one(options.filter((o) => lab(o).includes(v)))) || null;
  }

  function pickLocation(options) {
    const city = norm(P.city);
    const state = norm(P.state);
    const inCity = options.filter((o) => norm(o.text).startsWith(city));
    return inCity.find((o) => state && norm(o.text).includes(state)) || inCity[0] || null;
  }

  /** Your country as forms spell it; if it's blank, read it from your phone number's country code. */
  function countryName(country, phone) {
    const c = norm(country);
    if (c) return COUNTRY_ALIASES[c] || country;
    const digits = (phone || '').replace(/[^\d+]/g, '');
    const code = (digits.match(/^\+(\d{1,3})/) || [])[1];
    if (code) for (let n = code.length; n >= 1; n--) if (DIAL_CODES[code.slice(0, n)]) return DIAL_CODES[code.slice(0, n)];
    return /^\d{10}$/.test(digits) ? 'United States' : '';
  }

  // ---------- Setting values in a way frameworks notice ----------

  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    el.dispatchEvent(new Event('blur'));
  }

  function press(el) {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
    }
    el.click();
  }

  async function waitFor(fn, ms = 4000) {
    for (let t = 0; t < ms; t += 200) {
      const r = fn();
      if (r) return r;
      await sleep(200);
    }
    return fn();
  }

  function mark(el, kind, question, key) {
    const target = el.closest('[class*="select__control"]') || el;
    target.style.outline = `2px solid ${COLORS[kind]}`;
    target.style.outlineOffset = '1px';
    if (kind === 'missing') report.missing.push(clean(question).replace(/[*✱]\s*$/, '').slice(0, 120));
    else report[kind === 'profile' ? 'filled' : 'saved'].push(key);
  }

  const isRequired = (el, question) => el.required || el.getAttribute('aria-required') === 'true' || /[*✱]\s*$/.test(question);

  // ---------- Field types ----------

  function bridge(el, req) {
    el.setAttribute('data-applylog-req', JSON.stringify(req));
    el.dispatchEvent(new CustomEvent('applylog:rs', { bubbles: true }));
    const res = el.getAttribute('data-applylog-res');
    el.removeAttribute('data-applylog-res');
    try { return JSON.parse(res); } catch (e) { return null; }
  }

  async function fillReactSelect(el, ans) {
    let state = bridge(el, { op: 'read' });
    if (!state) return null; // not a react-select
    if (state.value.length) return true;
    const asOptions = (s) => s.options.map((text, i) => ({ text, value: text, i }));
    let choice = pickOption(asOptions(state), ans.value);
    if (!choice && LOCATION_KEYS.has(ans.key) && !state.options.length) {
      // Location pickers search as you type
      bridge(el, { op: 'search', text: P.city || ans.value });
      state = await waitFor(() => { const s = bridge(el, { op: 'read' }); return s && s.options.length ? s : null; });
      choice = state && pickLocation(asOptions(state));
    } else if (!choice && !state.options.length) {
      bridge(el, { op: 'search', text: ans.value });
      state = await waitFor(() => { const s = bridge(el, { op: 'read' }); return s && s.options.length ? s : null; }, 3000);
      choice = state && pickOption(asOptions(state), ans.value);
    }
    if (!choice) return false;
    bridge(el, { op: 'select', index: choice.i });
    return true;
  }

  function visibleOptions(el) {
    const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    const list = id && document.getElementById(id);
    const opts = [...(list || document).querySelectorAll('[role=option]')].filter(visible);
    return opts.map((o) => ({ el: o, text: textOf(o), value: o.getAttribute('data-value') || '' }));
  }

  async function fillCombobox(el, ans) {
    if (el.value.trim()) return true;
    const query = LOCATION_KEYS.has(ans.key) ? (P.city || ans.value) : ans.value;
    el.focus();
    setValue(el, query);
    const opts = await waitFor(() => { const o = visibleOptions(el); return o.length ? o : null; }, 3000);
    const choice = opts && (LOCATION_KEYS.has(ans.key) ? pickLocation(opts) : pickOption(opts, ans.value));
    if (!choice) { setValue(el, ''); return false; }
    press(choice.el);
    return true;
  }

  async function fillListboxButton(btn, ans) {
    press(btn);
    const opts = await waitFor(() => { const o = visibleOptions(btn); return o.length ? o : null; }, 2000);
    const choice = opts && pickOption(opts, ans.value);
    if (choice) { press(choice.el); await sleep(150); return true; }
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return false;
  }

  async function fillResume(input) {
    const bytes = Uint8Array.from(atob(RESUME.data), (c) => c.charCodeAt(0));
    const file = () => {
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], RESUME.name, { type: RESUME.type || 'application/pdf' }));
      return dt;
    };
    input.files = file().files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // Some upload widgets (Ashby's dropzone) only react to a drop
    if (await waitFor(() => document.body.textContent.includes(RESUME.name), 1500)) return;
    const zone = input.closest('[role=presentation], [class*="drop" i], [class*="upload" i]') || input.parentElement;
    const dt = file();
    for (const type of ['dragenter', 'dragover', 'drop']) {
      zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  }

  // ---------- One pass over the page ----------

  async function pass() {
    const fresh = (el) => { if (seen.has(el) || !el.isConnected) return false; seen.add(el); return true; };

    // Resume upload
    const files = [...document.querySelectorAll('input[type=file]')];
    for (const input of files) {
      if (!fresh(input) || !RESUME || input.files.length || input.disabled) continue;
      const q = norm([questionFor(input), input.name, input.id, input.getAttribute('data-automation-id')].join(' '));
      if (/cover/.test(q)) continue;
      if (/resume|\bcv\b/.test(q) || files.length === 1) {
        await fillResume(input);
        mark(input.closest('div') || input, 'profile', '', 'resume');
      }
    }

    // Searchable dropdowns (react-select, Ashby, LinkedIn typeaheads)
    for (const el of document.querySelectorAll('input[role=combobox]')) {
      if (!fresh(el) || el.disabled || el.type === 'search' || !visible(el)) continue;
      const q = questionFor(el);
      const ans = answerFor(el, q);
      let ok = false;
      if (ans) {
        const rs = await fillReactSelect(el, ans);
        ok = rs === null ? await fillCombobox(el, ans) : rs;
        if (ok) mark(el, ans.source, q, ans.key);
      }
      if (!ok && isRequired(el, q) && !(bridge(el, { op: 'read' }) || { value: [] }).value.length && !el.value) {
        mark(el, 'missing', q);
      }
      await sleep(60);
    }

    // Cover letters offered as "attach or enter manually": open the text box so it gets drafted
    if (DRAFTS) {
      for (const b of document.querySelectorAll('button')) {
        if (!/^enter manually$/i.test(textOf(b)) || !fresh(b)) continue;
        const group = b.closest('[role=group], .field-wrapper, fieldset');
        const file = group && group.querySelector('input[type=file]');
        if (!group || !/cover letter/i.test(textOf(group)) || (file && file.files.length) || group.querySelector('textarea')) continue;
        if (group.getAttribute('aria-required') !== 'true' && !/cover letter\s*[*✱]/i.test(textOf(group))) continue; // optional: skip it
        press(b);
        await waitFor(() => group.querySelector('textarea'), 1500);
      }
    }

    // Plain text boxes and native dropdowns
    const SKIP = ['hidden', 'file', 'submit', 'button', 'reset', 'image', 'password', 'checkbox', 'radio', 'search'];
    for (const el of document.querySelectorAll('input, textarea, select')) {
      if (el.getAttribute('role') === 'combobox' || SKIP.includes((el.type || '').toLowerCase())) continue;
      if (!fresh(el) || el.disabled || el.readOnly || !visible(el)) continue;
      const q = questionFor(el);
      const isSelect = el.tagName === 'SELECT';
      const empty = isSelect ? (!el.value || el.selectedIndex <= 0) : !el.value.trim();
      if (!empty) continue;
      const ans = answerFor(el, q);
      let ok = false;
      if (ans) {
        if (isSelect) {
          const opt = pickOption([...el.options].map((o) => ({ text: o.text, value: o.value, o })), ans.value);
          if (opt) { setValue(el, opt.value); ok = true; }
        } else if (!(el.tagName === 'TEXTAREA' && ans.source === 'profile' && ans.key !== 'address')) {
          setValue(el, ans.value);
          ok = true;
        }
      }
      if (ok) mark(el, ans.source, q, ans.key);
      else if (DRAFTS && !isSelect && isOpenEnded(el, q)) report.open.push(el);
      else if (isRequired(el, q)) mark(el, 'missing', q);
    }

    // Radio groups
    const groups = new Map();
    for (const r of document.querySelectorAll('input[type=radio]')) {
      if (r.name && visible(r.closest('label') || r.parentElement || r)) {
        if (!groups.has(r.name)) groups.set(r.name, []);
        groups.get(r.name).push(r);
      }
    }
    for (const group of groups.values()) {
      if (!fresh(group[0]) || group.some((r) => r.checked)) continue;
      const q = questionFor(group[0], true);
      const ans = answerFor(group[0], q);
      const opts = group.map((r) => ({ el: r, text: [...(r.labels || [])].map(textOf).join(' ') || r.value, value: r.value }));
      const choice = ans && pickOption(opts, ans.value);
      if (choice) { choice.el.click(); mark(choice.el.closest('label') || choice.el, ans.source, q, ans.key); }
      else if (isRequired(group[0], q) || /[*✱]/.test(q)) mark(group[0].closest(CONTAINERS) || group[0], 'missing', q);
    }

    // Yes/No button pairs (Ashby and others)
    const pairs = new Set();
    for (const b of document.querySelectorAll('button')) {
      if (/^(yes|no)$/i.test(textOf(b)) && b.parentElement) pairs.add(b.parentElement);
    }
    for (const box of pairs) {
      const btns = [...box.querySelectorAll('button')].filter((b) => /^(yes|no)$/i.test(textOf(b)));
      if (btns.length < 2 || !fresh(box) || !visible(box)) continue;
      if (btns.some((b) => b.getAttribute('aria-pressed') === 'true' || /active|selected/i.test(b.className))) continue;
      const q = questionFor(btns[0], true);
      const ans = answerFor(btns[0], q);
      const choice = ans && pickOption(btns.map((b) => ({ el: b, text: textOf(b), value: '' })), ans.value);
      if (choice) { choice.el.click(); mark(box, ans.source, q, ans.key); }
      else if (/[*✱]/.test(q)) mark(box, 'missing', q);
    }

    // Dropdown buttons that open a listbox (Workday)
    for (const btn of document.querySelectorAll('button[aria-haspopup=listbox]')) {
      if (!fresh(btn) || btn.disabled || !visible(btn) || !PLACEHOLDER_TEXT.test(textOf(btn))) continue;
      const q = questionFor(btn, true);
      const ans = answerFor(btn, q);
      if (ans && await fillListboxButton(btn, ans)) mark(btn, ans.source, q, ans.key);
      else if (/[*✱]/.test(q) || btn.getAttribute('aria-required') === 'true') mark(btn, 'missing', q);
    }
  }

  // ---------- Drafting open-ended answers ----------

  function isOpenEnded(el, question) {
    if (!question || el.hasAttribute('data-applylog-drafting') || ruleFor(norm(question))) return false;
    if (el.tagName === 'INPUT' && !['text', ''].includes((el.getAttribute('type') || '').toLowerCase())) return false;
    if (/cover letter/i.test(question) && !isRequired(el, question)) return false; // only when they ask for one
    return el.tagName === 'TEXTAREA' || OPEN_ENDED.test(question);
  }

  /** The posting itself: structured data if the page has it, else the biggest description block. */
  function jobContext() {
    const job = { title: '', company: '', url: location.href, description: '' };
    const strip = (html) => {
      const d = document.createElement('div');
      d.innerHTML = html || '';
      return d.textContent;
    };
    const find = (node) => {
      if (!node || typeof node !== 'object') return null;
      if (Array.isArray(node)) { for (const n of node) { const r = find(n); if (r) return r; } return null; }
      if ([].concat(node['@type']).includes('JobPosting')) return node;
      return find(node['@graph']);
    };
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const jp = find(JSON.parse(s.textContent));
        if (!jp) continue;
        job.title = clean(jp.title);
        job.company = clean(jp.hiringOrganization && jp.hiringOrganization.name);
        job.description = strip(jp.description);
        break;
      } catch (e) { /* malformed JSON-LD */ }
    }
    if (job.description.length < 300) {
      const SEL = '.job__description, [class*="job-description" i], [class*="jobDescription" i], [class*="job-post" i], '
        + '[data-automation-id="jobPostingDescription"], [class*="description" i], #content, article, main';
      let best = '';
      for (const el of document.querySelectorAll(SEL)) {
        if (el.querySelector('input:not([type=hidden]), textarea, select')) continue; // that's the form
        const t = el.innerText || '';
        if (t.length > best.length) best = t;
      }
      if (best.length > job.description.length) job.description = best;
    }
    job.description = job.description.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim().slice(0, 15000);
    const og = (n) => (document.querySelector(`meta[property="${n}"]`) || {}).content || '';
    job.title = job.title || clean(og('og:title')) || textOf(document.querySelector('h1')) || clean(document.title);
    // "Job Application for Program Manager at Discord"
    job.company = job.company || clean(og('og:site_name')) || (clean(document.title).match(/\bat ([^|–—-]+)$/) || [])[1] || '';
    return job;
  }

  function setDrafting(el, on) {
    if (on) {
      el.setAttribute('data-applylog-drafting', el.placeholder || '');
      el.placeholder = 'ApplyLog: drafting an answer with Claude…';
      el.style.outline = `2px dashed ${COLORS.draft}`;
      el.style.outlineOffset = '1px';
    } else {
      el.placeholder = el.getAttribute('data-applylog-drafting') || '';
      el.removeAttribute('data-applylog-drafting');
    }
  }

  async function draftAnswers(fields) {
    const questions = fields.map((el, i) => {
      el.setAttribute('data-applylog-qid', `q${i + 1}`);
      setDrafting(el, true);
      const q = clean(questionFor(el)).replace(/[*✱]\s*$/, '');
      return { id: `q${i + 1}`, q, maxLength: el.maxLength > 0 ? el.maxLength : undefined };
    });
    let res;
    try {
      let job = jobContext();
      if (PAGE_JOB && PAGE_JOB.description.length > job.description.length) job = PAGE_JOB;
      res = await chrome.runtime.sendMessage({ type: 'draft', questions, job });
    } catch (e) {
      res = { ok: false, error: e.message };
    }
    const byId = new Map(((res && res.answers) || []).map((a) => [a.id, a.text]));
    for (const el of fields) {
      setDrafting(el, false);
      const text = byId.get(el.getAttribute('data-applylog-qid'));
      el.removeAttribute('data-applylog-qid');
      if (text && !el.value.trim()) { // don't overwrite anything you typed meanwhile
        setValue(el, el.maxLength > 0 ? text.slice(0, el.maxLength) : text);
        el.style.outline = `2px solid ${COLORS.draft}`;
        el.title = 'Drafted by Claude from your resume and the job description. Read and edit before submitting.';
      } else if (!el.value.trim()) {
        el.style.outline = `2px solid ${COLORS.missing}`;
        el.title = `ApplyLog couldn't draft this: ${(res && res.error) || 'no answer returned'}`;
      } else {
        el.style.outline = ''; // you answered it yourself
      }
    }
  }

  // ---------- Public API ----------

  async function fill({ profile = {}, answers = [], resume = null, drafts = false, job = null }) {
    P = { ...profile };
    P.fullName = [P.firstName, P.lastName].filter(Boolean).join(' ');
    P.preferredName = P.preferredName || P.firstName;
    P.location = [P.city, P.state].filter(Boolean).join(', ');
    P.country = countryName(P.country, P.phone);
    LIB = answers;
    RESUME = resume && resume.data ? resume : null;
    DRAFTS = drafts;
    PAGE_JOB = job && job.description ? job : null;
    report = { filled: [], saved: [], missing: [], open: [] };
    seen = new WeakSet();
    await pass();
    const result = { ...report, drafting: report.open.map((el) => clean(questionFor(el)).replace(/[*✱]\s*$/, '').slice(0, 120)) };
    delete result.open;
    if (report.open.length) draftAnswers(report.open);

    // Multi-step forms (Workday, LinkedIn Easy Apply) swap in new fields without
    // reloading. Keep filling fields we haven't seen for the next 30 minutes.
    if (observer) observer.disconnect();
    let timer = null;
    let running = false;
    observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (running) return;
        running = true;
        report = { filled: [], saved: [], missing: [], open: [] };
        try {
          await pass();
          if (report.open.length) draftAnswers(report.open);
        } finally { running = false; }
      }, 800);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer && observer.disconnect(), 30 * 60 * 1000);

    return result;
  }

  /** Collects answers you typed on this page, for questions the profile doesn't cover. */
  function capture() {
    const out = new Map();
    const add = (q, a) => {
      q = clean(q).replace(/[*✱]\s*$/, '').trim();
      a = clean(a);
      if (!q || !a || a.length > 200 || PLACEHOLDER_TEXT.test(a)) return;
      if (ruleFor(norm(q)) || /\bwhy\b|tell us|describe|cover letter|explain/i.test(q)) return;
      out.set(norm(q), { q, a });
    };
    for (const el of document.querySelectorAll('input[role=combobox]')) {
      const s = bridge(el, { op: 'read' });
      add(questionFor(el), s ? s.value.join(', ') : el.value);
    }
    for (const el of document.querySelectorAll('input:not([type]), input[type=text], input[type=number], input[type=email], input[type=tel], input[type=url]')) {
      if (el.getAttribute('role') !== 'combobox' && visible(el)) add(questionFor(el), el.value);
    }
    for (const el of document.querySelectorAll('select')) {
      if (el.selectedIndex > 0 && visible(el)) add(questionFor(el), el.options[el.selectedIndex].text);
    }
    for (const r of document.querySelectorAll('input[type=radio]:checked')) {
      add(questionFor(r, true), [...(r.labels || [])].map(textOf).join(' ') || r.value);
    }
    for (const b of document.querySelectorAll('button[aria-pressed=true]')) {
      if (/^(yes|no)$/i.test(textOf(b))) add(questionFor(b, true), textOf(b));
    }
    for (const b of document.querySelectorAll('button[aria-haspopup=listbox]')) {
      if (!PLACEHOLDER_TEXT.test(textOf(b))) add(questionFor(b, true), textOf(b));
    }
    return [...out.values()];
  }

  window.__applylog = { fill, capture, job: jobContext };
})();
