/**
 * Injected into the page's main world. React-select dropdowns (Greenhouse and
 * others) can only be driven through their React props, which the isolated
 * autofill script can't see. autofill.js writes a request into
 * data-applylog-req and fires `applylog:rs`; this replies in data-applylog-res.
 * Profile data never passes through here, only the one value being filled.
 */
(() => {
  if (window.__applylogBridge) return;
  window.__applylogBridge = true;

  const selectProps = (el) => {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    let f = key && el[key];
    while (f && !(f.memoizedProps && typeof f.memoizedProps.selectOption === 'function')) f = f.return;
    return f && f.memoizedProps;
  };
  const label = (o) => (typeof o.label === 'string' ? o.label : String(o.value ?? ''));

  document.addEventListener('applylog:rs', (e) => {
    const el = e.target;
    let res = null;
    try {
      const req = JSON.parse(el.getAttribute('data-applylog-req') || '{}');
      const p = selectProps(el);
      if (p) {
        const opts = (p.options || []).flatMap((o) => o.options || [o]);
        if (req.op === 'read') {
          res = { options: opts.map(label), value: (p.getValue ? p.getValue() : []).map(label) };
        } else if (req.op === 'search') {
          p.selectProps.onInputChange(req.text, { action: 'input-change', prevInputValue: '' });
          res = { ok: true };
        } else if (req.op === 'select' && opts[req.index]) {
          p.selectOption(opts[req.index]);
          res = { ok: true };
        }
      }
    } catch (err) { res = null; }
    el.removeAttribute('data-applylog-req');
    el.setAttribute('data-applylog-res', JSON.stringify(res));
  }, true);
})();
