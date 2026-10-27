/**
 * ApplyLog application autofill. Injected by the popup into every frame it can
 * reach, in the extension's isolated world, so page scripts never see your
 * profile. Defines window.__applylog = { fill, capture, answers, job }.
 *
 * Fills only empty fields and never submits. Colours:
 *   green = from your profile, blue = from your saved answers (double-check),
 *   purple = drafted or picked by Claude (check it), red = couldn't be filled (yours to answer).
 *
 * Open-ended questions ("Why do you want to work here?") and required multiple-choice
 * questions your profile can't answer are sent with the job description to the
 * background worker, which asks the native helper (Claude) to answer them.
 * Legal status, demographics, salary and consent questions are never sent.
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
    ['degree', /\bdegree\b|level of education|education level|highest (level of )?education/],
    ['major', /\bmajor\b|discipline|field of study|area of study/],
    ['gradMonth', /graduation month|month (of|you) (will )?graduat/],
    ['gradYear', /graduation year|year (of|you) (will )?graduat|\bclass of\b/],
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

  // Degrees by level, however they're written: "B.S.", "BS", "Bachelor's", "Bachelors", "Bachlor of Science"
  const DEGREE_LEVELS = [
    ['bachelor', /\bbach[a-z]*l[a-z]*r|baccalaureate|\bb ?(s|a|sc|eng|tech|s ?e|b ?a)\b/],
    ['master', /\bmast[a-z]*r|\bm ?(s|a|sc|eng|phil|ed|b ?a)\b/],
    ['doctorate', /\bph ?d\b|doctor/],
    ['associate', /\bassociate/]
  ];
  const degreeLevel = (t) => { for (const [level, re] of DEGREE_LEVELS) if (re.test(t)) return level; return null; };
  // Science, arts or engineering, so "B.S." picks "Bachelor of Science" over "Bachelor of Arts"
  const degreeField = (t) => (/\bmba\b|business admin/.test(t) ? 'business' : /\b[bm] ?sc?\b|of science/.test(t) ? 'science'
    : /\b[bm] ?a\b|of arts/.test(t) ? 'arts' : /\b[bm] ?(eng|s ?e)\b|of engineering/.test(t) ? 'engineering' : '');

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

  const COLORS = { profile: '#34a853', saved: '#4285f4', draft: '#a142f4', missing: '#d93025' };

  // Never guessed by Claude: legal status, demographics and money stay yours to answer
  const NEVER_ASK = new Set(['workAuth', 'sponsorship', 'over18', 'gender', 'hispanic', 'race', 'veteran', 'disability', 'pronouns', 'salary']);
  const NEVER_ASK_TEXT = /acknowledg|consent|certif|attest|\bagree|privacy|criminal|convict|felony|background check|signature|lgbt|sexual orientation|transgender|gender identity|ethnicit|\brace\b|disabilit|veteran|religio/i;
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

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
  // Forms like Ashby's save each change over a copy of the previous answers, so changes made
  // in the same instant overwrite each other. Give each one time to land before the next.
  const settle = () => sleep(120);
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const norm = (s) => clean((s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-\[\].:*✱?()]+/g, ' ')).toLowerCase();
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const textOf = (el) => clean(el ? el.textContent : '');

  // SmartRecruiters (and other forms built from web components) keep each real <input>
  // in a shadow root, which document.querySelectorAll never looks inside
  function roots(root = document) {
    const out = [root];
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out.push(...roots(el.shadowRoot));
    return out;
  }
  const all = (sel, root = document) => roots(root).flatMap((r) => [...r.querySelectorAll(sel)]);
  // Parent and id lookups that step out of a shadow root to its host
  const up = (el) => el.parentElement || el.getRootNode().host || null;
  const byId = (el, id) => (el.getRootNode().getElementById && el.getRootNode().getElementById(id)) || document.getElementById(id);
  // Text of the custom elements a field sits in ("resume-upload"), since its own label may just say "Choose a file"
  const hostHints = (el) => {
    const out = [];
    for (let h = el.getRootNode().host; h; h = h.getRootNode().host) out.push(h.getAttribute('data-test'), h.getAttribute('label'));
    return out.filter(Boolean).join(' ');
  };

  // ---------- Working out what a field is asking ----------

  function questionFor(el, ownLabelIsOption = false) {
    if (!ownLabelIsOption) {
      const parts = [];
      if (el.labels) for (const l of el.labels) parts.push(textOf(l));
      const ids = el.getAttribute('aria-labelledby');
      if (ids) for (const id of ids.split(/\s+/)) parts.push(textOf(byId(el, id)));
      parts.push(el.getAttribute('aria-label') || '');
      // Labels and aria-label often repeat each other; keep each piece once
      const unique = [...new Set(parts.map(clean).filter(Boolean))];
      const t = unique.filter((x) => !unique.some((y) => y !== x && norm(y).includes(norm(x)))).join(' ');
      // Greenhouse's typed cover letter is labelled "Enter manually"; the question is the group's label
      const group = /^enter manually$/i.test(t) && el.closest('[role=group][aria-labelledby]');
      if (group) return textOf(byId(group, group.getAttribute('aria-labelledby'))).slice(0, 250);
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
    let node = up(el);
    for (let i = 0; node && i < 4; i++, node = up(node)) {
      const others = all('input:not([type=hidden]), select, textarea', node)
        .filter((f) => f !== el && !(el.name && f.name === el.name));
      if (others.length) break;
      const lab = node.querySelector(TITLES);
      if (lab && textOf(lab)) return textOf(lab).slice(0, 250);
    }
    // Some custom application forms render the prompt as a plain paragraph
    // immediately before the textarea, without label/ARIA markup or a known
    // field wrapper class. Walk up to the nearest single-field container and
    // use its preceding prompt text so open-ended questions still reach Claude.
    node = el;
    for (let i = 0; node && i < 7; i++, node = up(node)) {
      const parent = up(node);
      if (!parent) break;
      const fields = all('input:not([type=hidden]), select, textarea', parent)
        .filter((f) => visible(f));
      if (fields.length > 1) break;
      let sibling = node.previousElementSibling;
      while (sibling) {
        const text = textOf(sibling);
        if (text && !sibling.querySelector('input, select, textarea, button')) return text.slice(0, 250);
        sibling = sibling.previousElementSibling;
      }
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
    // "BS", "B.S. Computer Science", "Bachelors" and "Bachelor of Science" are the same degree, either way round
    const level = degreeLevel(v);
    if (level) {
      // Same level, and not a different field: a B.A. never becomes "B.S.", nor an MBA "M.S."
      const field = degreeField(v);
      const fits = options.filter((o) => degreeLevel(lab(o)) === level && (!field || !degreeField(lab(o)) || degreeField(lab(o)) === field));
      if (fits.length === 1) return fits[0];
      // Several: "Bachelor of Science" for a B.S., a plain "Bachelor's Degree" for a plain "Bachelor's" (never "MBA" for "Master's")
      const best = fits.filter((o) => degreeField(lab(o)) === field && (field || /\bbach|\bmast|associate|doctor/.test(lab(o))));
      if (best.length === 1) return best[0];
    }
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
    const next = String(value);
    // Focus and blur are real DOM transitions. Some form libraries only run
    // validation after blur, and synthetic blur events alone don't update
    // document.activeElement or trigger the browser's normal focus sequence.
    el.focus();
    // Phone inputs often have a mask that formats the displayed number but
    // only commits its internal value as characters arrive. A single bulk
    // input event can leave those widgets looking filled while still invalid.
    if (el instanceof HTMLInputElement && el.type === 'tel') {
      let digits = next.replace(/\D/g, '');
      if (/^\s*\+/.test(next)) {
        const dial = Object.entries(DIAL_CODES).find(([, country]) => country === P.country);
        if (dial && digits.startsWith(dial[0]) && digits.length > dial[0].length + 6) digits = digits.slice(dial[0].length);
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, '');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      for (const digit of digits) {
        setter.call(el, el.value + digit);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: digit }));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      return;
    }
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, next);
    // React and other controlled-field handlers listen for `input`. Supplying
    // InputEvent metadata is closer to normal typing than a generic Event and
    // is required by a few form implementations.
    try {
      if (el instanceof HTMLSelectElement) throw new Error('select');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: next }));
    } catch (_) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
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
    if (kind === 'missing') { if (key !== 'optional') report.missing.push(clean(question).replace(/[*✱]\s*$/, '').slice(0, 120)); }
    else report[kind === 'profile' ? 'filled' : 'saved'].push(key);
  }

  // Red outline on anything left empty; only required ones are listed in the popup
  const unfilled = (el, question, required) => mark(el, 'missing', question, required ? '' : 'optional');

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
    const list = id && byId(el, id);
    const opts = all('[role=option]', list || document).filter(visible);
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

  // Greenhouse renders phone country codes as a separate required picker next
  // to the tel input. Filling only the number leaves the form invalid even
  // though the number is visible, so select the matching country first.
  async function fillPhoneCountry(input) {
    if (!P.country) return false;
    let group = up(input);
    for (let depth = 0; group && depth < 5; depth++, group = up(group)) {
      const candidates = all('select, button, [role="combobox"], [aria-haspopup="listbox"]', group)
        .filter((el) => el !== input && visible(el));
      const scored = candidates.map((el) => {
        const hint = norm([el.getAttribute('aria-label'), el.getAttribute('title'), el.name,
          el.getAttribute('data-testid'), el.textContent].join(' '));
        const score = (/country|calling code|dial code/.test(hint) ? 4 : 0)
          + (/^\+?\d{1,4}$/.test(clean(el.textContent)) ? 2 : 0)
          + (el.matches('[aria-haspopup="listbox"], [role="combobox"]') ? 1 : 0);
        return { el, score };
      }).filter((x) => x.score >= 2).sort((a, b) => b.score - a.score);
      if (!scored.length) continue;
      const picker = scored[0].el;
      if (picker instanceof HTMLSelectElement) {
        const choice = pickOption([...picker.options].map((o) => ({ text: o.text, value: o.value, o })), P.country);
        if (!choice) return false;
        setValue(picker, choice.value);
        return true;
      }
      press(picker);
      const options = await waitFor(() => { const found = visibleOptions(picker); return found.length ? found : null; }, 1800);
      const choice = options && pickOption(options, P.country);
      if (choice) { press(choice.el); await sleep(120); return true; }
      picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }
    return false;
  }

  async function listboxOptions(btn) {
    press(btn);
    const opts = await waitFor(() => { const o = visibleOptions(btn); return o.length ? o : null; }, 2000);
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(150);
    return opts ? opts.map((o) => o.text).filter((t) => t && !PLACEHOLDER_TEXT.test(t)) : [];
  }

  /** "May 2027", "05/2027" or "2027-05-15" as a date or month input's value. */
  function dateValue(text, type) {
    const t = norm(text);
    let y = (t.match(/\b(19|20)\d\d\b/) || [])[0];
    let m = MONTHS.findIndex((x) => t.includes(x) || t.split(' ').includes(x.slice(0, 3))) + 1;
    let d = 1;
    const iso = (text || '').match(/(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
    const us = (text || '').match(/\b(\d{1,2})\/(?:(\d{1,2})\/)?(\d{4})\b/);
    if (iso) { y = iso[1]; m = +iso[2]; d = +(iso[3] || 1); } else if (us) { y = us[3]; m = +us[1]; d = +(us[2] || 1); }
    if (!y || !m) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return type === 'month' ? `${y}-${pad(m)}` : `${y}-${pad(m)}-${pad(d)}`;
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
    if (await waitFor(() => roots().some((r) => (r === document ? r.body : r).textContent.includes(RESUME.name)), 1500)) return;
    const zone = input.closest('[role=presentation], [class*="drop" i], [class*="upload" i]') || up(input);
    const dt = file();
    for (const type of ['dragenter', 'dragover', 'drop']) {
      zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  }

  // ---------- One pass over the page ----------

  async function pass() {
    const fresh = (el) => { if (seen.has(el) || !el.isConnected) return false; seen.add(el); return true; };

    // Resume upload
    const files = all('input[type=file]');
    for (const input of files) {
      if (!fresh(input) || !RESUME || input.files.length || input.disabled) continue;
      const q = norm([questionFor(input), input.name, input.id, input.getAttribute('data-automation-id'), hostHints(input)].join(' '));
      // SmartRecruiters' "Apply with resume" box parses the file into the form, over what we fill
      if (/cover|apply with/.test(q)) continue;
      if (/resume|\bcv\b/.test(q) || files.length === 1) {
        await fillResume(input);
        mark(input.closest('div') || input, 'profile', '', 'resume');
      }
    }

    // Searchable dropdowns (react-select, Ashby, LinkedIn typeaheads)
    for (const el of all('input[role=combobox]')) {
      if (!fresh(el) || el.disabled || el.type === 'search' || !visible(el)) continue;
      const q = questionFor(el);
      const ans = answerFor(el, q);
      let ok = false;
      if (ans) {
        const rs = await fillReactSelect(el, ans);
        ok = rs === null ? await fillCombobox(el, ans) : rs;
        if (ok) mark(el, ans.source, q, ans.key);
      }
      const st = bridge(el, { op: 'read' });
      if (!ok && !(st || { value: [] }).value.length && !el.value) {
        if (st && st.options.length && canAsk(q)) {
          askChoice(el, q, st.options, (i) => bridge(el, { op: 'select', index: i }),
            () => !(bridge(el, { op: 'read' }) || { value: [] }).value.length, { multi: st.multi, required: isRequired(el, q) });
        } else unfilled(el, q, isRequired(el, q));
      }
      await sleep(60);
    }

    // Uploads offered as "attach or enter manually" (cover letters and the like): open the text box so Claude drafts it.
    // Not the resume: that's your file, attached above.
    if (DRAFTS) {
      for (const b of all('button')) {
        if (!/^enter manually$/i.test(textOf(b)) || !fresh(b)) continue;
        const group = b.closest('[role=group], .field-wrapper, fieldset');
        const file = group && group.querySelector('input[type=file]');
        if (!group || (file && file.files.length) || group.querySelector('textarea')) continue;
        const label = group.getAttribute('aria-labelledby') && byId(group, group.getAttribute('aria-labelledby'));
        if (/resume|\bcv\b/i.test(label ? textOf(label) : textOf(group))) continue;
        press(b);
        await waitFor(() => group.querySelector('textarea'), 1500);
      }
    }

    // Plain text boxes and native dropdowns
    const SKIP = ['hidden', 'file', 'submit', 'button', 'reset', 'image', 'password', 'checkbox', 'radio', 'search'];
    for (const el of all('input, textarea, select')) {
      if (el.getAttribute('role') === 'combobox' || SKIP.includes((el.type || '').toLowerCase())) continue;
      if (!fresh(el) || el.disabled || el.readOnly || !visible(el)) continue;
      if (el.getAttribute('aria-hidden') === 'true') continue; // dropdowns' hidden "required" inputs
      const q = questionFor(el);
      if (el instanceof HTMLInputElement && el.type === 'tel') await fillPhoneCountry(el);
      const isSelect = el.tagName === 'SELECT';
      const empty = isSelect ? (!el.value || el.selectedIndex <= 0) : !el.value.trim();
      if (!empty) continue;
      const ans = answerFor(el, q);
      const type = (el.getAttribute('type') || '').toLowerCase();
      const isDate = ['date', 'month'].includes(type);
      let ok = false;
      if (ans) {
        if (isSelect) {
          const opt = pickOption([...el.options].map((o) => ({ text: o.text, value: o.value, o })), ans.value);
          if (opt) { setValue(el, opt.value); ok = true; }
        } else if (isDate) {
          const d = dateValue(ans.value, type);
          if (d) { setValue(el, d); ok = el.value === d; }
        } else if (!(el.tagName === 'TEXTAREA' && ans.source === 'profile' && ans.key !== 'address')) {
          setValue(el, ans.value);
          ok = true;
        }
      }
      const real = isSelect ? [...el.options].filter((o) => o.value && !PLACEHOLDER_TEXT.test(o.text.trim())) : [];
      const required = isRequired(el, q);
      if (ok) { mark(el, ans.source, q, ans.key); await settle(); }
      else if (!isSelect && isOpenEnded(el, q) && canAsk(q)) askText(el, q);
      else if (isSelect && real.length && canAsk(q)) {
        askChoice(el, q, real.map((o) => clean(o.text)), (i) => setValue(el, real[i].value), () => el.selectedIndex <= 0 || !el.value, { required });
      } else if (!isSelect && el.tagName === 'INPUT' && canAsk(q) && !['email', 'tel', 'password'].includes(type)) {
        askText(el, q, { short: true, type, required }); // "GPA", "Expected graduation date", "Years of experience"
      } else unfilled(el, q, required);
    }

    // Radio groups
    const groups = new Map();
    for (const r of all('input[type=radio]')) {
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
      const box = group[0].closest(CONTAINERS) || group[0];
      if (choice) { choice.el.click(); mark(choice.el.closest('label') || choice.el, ans.source, q, ans.key); await settle(); }
      else if (canAsk(q)) {
        askChoice(box, q, opts.map((o) => clean(o.text)), (i) => opts[i].el.click(), () => !group.some((r) => r.checked),
          { required: isRequired(group[0], q) || /[*✱]/.test(q) });
      } else unfilled(box, q, isRequired(group[0], q) || /[*✱]/.test(q));
    }

    // Checkbox lists ("Select all that apply"). A lone checkbox is a consent box and stays yours.
    const boxes = new Map();
    for (const c of all('input[type=checkbox]')) {
      const box = c.closest('fieldset, [role=group], .checkbox-group, [class*="checkbox" i][class*="group" i], .field-wrapper');
      if (box && visible(c.closest('label') || c.parentElement || c)) {
        if (!boxes.has(box)) boxes.set(box, []);
        boxes.get(box).push(c);
      }
    }
    for (const [box, list] of boxes) {
      if (list.length < 2 || !fresh(box) || list.some((c) => c.checked)) continue;
      const q = questionFor(list[0], true);
      const opts = list.map((c) => ({ el: c, text: clean([...(c.labels || [])].map(textOf).join(' ') || c.value) }));
      const required = box.getAttribute('aria-required') === 'true' || /[*✱]\s*$/.test(q);
      const ans = answerFor(list[0], q);
      const choice = ans && pickOption(opts, ans.value);
      if (choice) { choice.el.click(); mark(box, ans.source, q, ans.key); await settle(); }
      else if (canAsk(q)) {
        askChoice(box, q, opts.map((o) => o.text), (i) => { if (!opts[i].el.checked) opts[i].el.click(); },
          () => !list.some((c) => c.checked), { multi: true, required });
      } else unfilled(box, q, required);
    }
    for (const c of all('input[type=checkbox]')) {
      const inList = [...boxes.values()].some((l) => l.length > 1 && l.includes(c));
      if (inList || c.checked || !fresh(c) || !visible(c.closest('label') || c)) continue;
      const q = questionFor(c) || questionFor(c, true);
      if (isRequired(c, q) || /[*✱]\s*$/.test(q)) mark(c.closest('label') || c, 'missing', q); // consent: tick it yourself
    }

    // Yes/No button pairs (Ashby and others)
    const pairs = new Set();
    for (const b of all('button')) {
      if (/^(yes|no)$/i.test(textOf(b)) && b.parentElement) pairs.add(b.parentElement);
    }
    for (const box of pairs) {
      const btns = [...box.querySelectorAll('button')].filter((b) => /^(yes|no)$/i.test(textOf(b)));
      if (btns.length < 2 || !fresh(box) || !visible(box)) continue;
      if (btns.some((b) => b.getAttribute('aria-pressed') === 'true' || /active|selected/i.test(b.className))) continue;
      const q = questionFor(btns[0], true);
      const ans = answerFor(btns[0], q);
      const choice = ans && pickOption(btns.map((b) => ({ el: b, text: textOf(b), value: '' })), ans.value);
      if (choice) { press(choice.el); mark(box, ans.source, q, ans.key); await settle(); }
      else if (canAsk(q)) {
        askChoice(box, q, btns.map(textOf), (i) => press(btns[i]),
          () => !btns.some((b) => b.getAttribute('aria-pressed') === 'true' || /active|selected/i.test(b.className)),
          { required: /[*✱]/.test(q) });
      } else unfilled(box, q, /[*✱]/.test(q));
    }

    // Dropdown buttons that open a listbox (Workday)
    for (const btn of all('button[aria-haspopup=listbox]')) {
      if (!fresh(btn) || btn.disabled || !visible(btn) || !PLACEHOLDER_TEXT.test(textOf(btn))) continue;
      const q = questionFor(btn, true);
      const ans = answerFor(btn, q);
      const required = /[*✱]/.test(q) || btn.getAttribute('aria-required') === 'true';
      if (ans && await fillListboxButton(btn, ans)) { mark(btn, ans.source, q, ans.key); continue; }
      const options = canAsk(q) ? await listboxOptions(btn) : [];
      if (options.length) {
        askChoice(btn, q, options, async (i) => {
          press(btn);
          const opts = await waitFor(() => { const o = visibleOptions(btn); return o.length ? o : null; }, 2000);
          const pick = opts && opts.find((o) => o.text === options[i]);
          if (pick) press(pick.el); else btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }, () => PLACEHOLDER_TEXT.test(textOf(btn)), { required });
      } else unfilled(btn, q, required);
    }
  }

  // ---------- Drafting open-ended answers ----------

  function isOpenEnded(el, question) {
    if (!question || el.hasAttribute('data-applylog-drafting') || ruleFor(norm(question))) return false;
    if (el.tagName === 'INPUT' && !['text', ''].includes((el.getAttribute('type') || '').toLowerCase())) return false;
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

  const outlineTarget = (el) => el.closest('[class*="select__control"]') || el;
  const tidy = (q) => clean(q).replace(/[*✱]\s*$/, '').slice(0, 300);

  /** Claude may answer this only if it isn't about legal status, demographics, money or consent. */
  function canAsk(question) {
    if (!DRAFTS || !question) return false;
    const key = ruleFor(norm(question));
    // Sensitive questions: Claude may only translate an answer you set in your profile onto this form's wording
    if ((key && NEVER_ASK.has(key)) || NEVER_ASK_TEXT.test(question)) return !!(key && NEVER_ASK.has(key) && P[key]) && !/acknowledg|consent|certif|attest|\bagree|signature/i.test(question);
    return true;
  }

  /** Your own profile answer for a question, passed to Claude so it maps rather than guesses. */
  const HINT_LABELS = {
    workAuth: 'authorized to work', sponsorship: 'needs visa sponsorship', over18: '18 or older', relocate: 'willing to relocate',
    inOffice: 'OK working in office', startDate: 'earliest start date', gradDate: 'graduation date', gradMonth: 'graduation month',
    gradYear: 'graduation year', degree: 'degree', major: 'major', school: 'school', gender: 'gender', race: 'race',
    hispanic: 'Hispanic or Latino', veteran: 'veteran status', disability: 'disability status', pronouns: 'pronouns', salary: 'salary expectation'
  };
  const hintFor = (question) => {
    const key = ruleFor(norm(question));
    return key && P[key] ? `${HINT_LABELS[key] || key}: ${P[key]}` : undefined;
  };

  function pending(el) {
    const t = outlineTarget(el);
    t.style.outline = `2px dashed ${COLORS.draft}`;
    t.style.outlineOffset = '1px';
  }

  function askText(el, q, { short = false, type = '', required = true } = {}) {
    el.setAttribute('data-applylog-drafting', el.placeholder || '');
    el.placeholder = short ? 'ApplyLog: asking Claude…' : 'ApplyLog: drafting an answer with Claude…';
    pending(el);
    report.asks.push({ el, q: tidy(q), short, type, required, hint: hintFor(q), maxLength: el.maxLength > 0 ? el.maxLength : undefined });
  }

  function askChoice(el, q, options, apply, stillEmpty, { multi = false, required = true } = {}) {
    pending(el);
    report.asks.push({ el, q: tidy(q), options, apply, stillEmpty, multi, required, hint: hintFor(q) });
  }

  /** Sends written and multiple-choice questions to Claude in one batch, then fills what comes back. */
  async function draftAnswers(asks) {
    const questions = asks.map((a, i) => {
      a.id = `q${i + 1}`;
      return a.options
        ? { id: a.id, q: a.q, options: a.options, multi: a.multi || undefined, hint: a.hint }
        : { id: a.id, q: a.q, maxLength: a.maxLength, short: a.short || undefined, type: a.type || undefined, hint: a.hint };
    });
    let res;
    try {
      let job = jobContext();
      if (PAGE_JOB && PAGE_JOB.description.length > job.description.length) job = PAGE_JOB;
      res = await chrome.runtime.sendMessage({ type: 'draft', questions, job });
    } catch (e) {
      res = { ok: false, error: e.message };
    }
    const byId = new Map(((res && res.answers) || []).map((a) => [a.id, clean(a.text) ? a.text : '']));
    const why = (res && res.ok) ? 'Claude couldn\'t tell from your profile and resume' : `ApplyLog couldn't ask Claude: ${(res && res.error) || 'no answer returned'}`;
    const done = (el, color, title) => { outlineTarget(el).style.outline = color ? `2px solid ${color}` : ''; el.title = title || ''; };
    for (const a of asks) {
      const text = byId.get(a.id);
      const unanswered = () => done(a.el, COLORS.missing, why);
      if (a.options) {
        const wanted = text ? (a.multi ? text.split(/\s*\|\s*/) : [text]) : [];
        const picks = [...new Set(wanted.map((w) => a.options.findIndex((o) => norm(o) === norm(w))).filter((i) => i >= 0))];
        if (picks.length && a.stillEmpty()) {
          for (const i of a.multi ? picks : picks.slice(0, 1)) { await a.apply(i); await settle(); }
          done(a.el, COLORS.draft, 'Picked by Claude from your profile and resume. Check it before submitting.');
        } else if (a.stillEmpty()) unanswered();
        else done(a.el, '');
        continue;
      }
      const el = a.el;
      el.placeholder = el.getAttribute('data-applylog-drafting') || '';
      el.removeAttribute('data-applylog-drafting');
      const value = text && (['date', 'month'].includes(a.type) ? dateValue(text, a.type) : text);
      if (value && !el.value.trim()) { // don't overwrite anything you typed meanwhile
        setValue(el, el.maxLength > 0 ? value.slice(0, el.maxLength) : value);
        await settle();
        done(el, COLORS.draft, a.short ? 'Filled by Claude from your profile and resume. Check it before submitting.'
          : 'Drafted by Claude from your resume and the job description. Read and edit before submitting.');
      } else if (!el.value.trim()) unanswered();
      else done(el, ''); // you answered it yourself
    }
  }

  // ---------- Public API ----------

  async function fill({ profile = {}, answers = [], resume = null, drafts = false, job = null }) {
    P = { ...profile };
    P.fullName = [P.firstName, P.lastName].filter(Boolean).join(' ');
    P.preferredName = P.preferredName || P.firstName;
    P.location = [P.city, P.state].filter(Boolean).join(', ');
    P.country = countryName(P.country, P.phone);
    const grad = norm(P.gradDate);
    const gm = MONTHS.findIndex((m) => grad.includes(m) || grad.split(' ').includes(m.slice(0, 3)));
    P.gradMonth = gm >= 0 ? MONTHS[gm][0].toUpperCase() + MONTHS[gm].slice(1) : '';
    P.gradYear = (grad.match(/\b(19|20)\d\d\b/) || [''])[0];
    LIB = answers;
    RESUME = resume && resume.data ? resume : null;
    DRAFTS = drafts;
    PAGE_JOB = job && job.description ? job : null;
    report = { filled: [], saved: [], missing: [], asks: [] };
    seen = new WeakSet();
    await pass();
    const result = { ...report, drafting: report.asks.map((a) => a.q.slice(0, 120)) };
    delete result.asks;
    if (report.asks.length) draftAnswers(report.asks);
    trackSteps();

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
        report = { filled: [], saved: [], missing: [], asks: [] };
        try {
          await pass();
          if (report.asks.length) draftAnswers(report.asks);
        } finally { running = false; }
      }, 800);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer && observer.disconnect(), 30 * 60 * 1000);

    return result;
  }

  /** Every visible answer on this page, labelled by its question; blank fields have answer ''. */
  function answersOnPage() {
    const labelFor = (el) => {
      const labels = el.labels ? [...el.labels].map(textOf) : [];
      return clean(el.getAttribute('aria-label') || labels[0] || el.name || el.id || 'Unlabeled field');
    };
    const values = new Map();
    for (const el of all('input,select,textarea')) {
      if (el.type === 'hidden' || el.type === 'file' || el.type === 'submit' || el.type === 'button' || el.disabled) continue;
      if (!visible(el)) continue;
      let value = '';
      if (el.type === 'radio') {
        if (!el.checked) continue;
        value = el.labels && el.labels[0] ? textOf(el.labels[0]) : el.value;
      } else if (el.type === 'checkbox') value = el.checked ? 'Yes' : 'No';
      else if (el.tagName === 'SELECT') value = [...el.selectedOptions].map(textOf).join(', ');
      else value = clean(el.value);
      const question = labelFor(el);
      if (!values.get(question)) values.set(question, value);
    }
    return [...values].map(([question, answer]) => ({ question, answer }));
  }

  // Multi-step forms unmount each step once you move on, so "Save what I submitted"
  // on the last step would only see that step. Hand each step's answers to the
  // background worker as you go; it keeps them per tab until you save.
  let stepPending = new Map();
  let stepTimer = null;
  function sendStep() {
    clearTimeout(stepTimer);
    if (!stepPending.size) return;
    const answers = [...stepPending].map(([question, answer]) => ({ question, answer }));
    stepPending = new Map();
    chrome.runtime.sendMessage({ type: 'stepAnswers', answers }).catch(() => {});
  }
  function noteStep() {
    // Read now, before a "Next" click swaps the step out; send a moment later
    for (const { question, answer } of answersOnPage()) stepPending.set(question, answer);
    clearTimeout(stepTimer);
    stepTimer = setTimeout(sendStep, 300);
  }
  let trackingSteps = false;
  function trackSteps() {
    if (trackingSteps) return;
    trackingSteps = true;
    for (const type of ['input', 'change', 'click']) document.addEventListener(type, noteStep, true);
    window.addEventListener('pagehide', () => { noteStep(); sendStep(); });
    noteStep();
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
    for (const el of all('input[role=combobox]')) {
      const s = bridge(el, { op: 'read' });
      add(questionFor(el), s ? s.value.join(', ') : el.value);
    }
    for (const el of all('input:not([type]), input[type=text], input[type=number], input[type=email], input[type=tel], input[type=url]')) {
      if (el.getAttribute('role') !== 'combobox' && visible(el)) add(questionFor(el), el.value);
    }
    for (const el of all('select')) {
      if (el.selectedIndex > 0 && visible(el)) add(questionFor(el), el.options[el.selectedIndex].text);
    }
    for (const r of all('input[type=radio]:checked')) {
      add(questionFor(r, true), [...(r.labels || [])].map(textOf).join(' ') || r.value);
    }
    for (const b of all('button[aria-pressed=true]')) {
      if (/^(yes|no)$/i.test(textOf(b))) add(questionFor(b, true), textOf(b));
    }
    for (const b of all('button[aria-haspopup=listbox]')) {
      if (!PLACEHOLDER_TEXT.test(textOf(b))) add(questionFor(b, true), textOf(b));
    }
    return [...out.values()];
  }

  window.__applylog = { fill, capture, answers: answersOnPage, job: jobContext };
})();
