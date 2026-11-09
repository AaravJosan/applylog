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
  // Lists that load from the server as you type (Greenhouse's schools, degrees and disciplines) only
  // search on real keystrokes, so ask their loader directly and keep what it found for 'read' and 'select'
  const loaderProps = (el) => {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    for (let f = key && el[key]; f; f = f.return) if (f.memoizedProps && typeof f.memoizedProps.loadOptions === 'function') return f.memoizedProps;
    return null;
  };
  const loaded = new WeakMap();
  const searching = new WeakMap();
  const flat = (opts) => (opts || []).flatMap((o) => o.options || [o]);

  document.addEventListener('applylog:rs', (e) => {
    const el = e.target;
    let res = null;
    try {
      const req = JSON.parse(el.getAttribute('data-applylog-req') || '{}');
      const p = selectProps(el);
      if (p) {
        const own = flat(p.options);
        const opts = own.length ? own : loaded.get(el) || [];
        if (req.op === 'read') {
          res = { options: opts.map(label), value: (p.getValue ? p.getValue() : []).map(label), multi: !!(p.isMulti || (p.selectProps && p.selectProps.isMulti)) };
        } else if (req.op === 'search') {
          const loader = !own.length && loaderProps(el);
          if (loader) {
            loaded.delete(el);
            const search = {}; // a slower earlier search mustn't land over this one
            searching.set(el, search);
            if (req.text) {
              const keep = (opts) => { if (searching.get(el) === search) loaded.set(el, opts); };
              Promise.resolve(loader.loadOptions(req.text, [], loader.additional))
                .then((r) => keep(flat(r && r.options)), () => keep([]));
            }
          } else p.selectProps.onInputChange(req.text, { action: 'input-change', prevInputValue: '' });
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
