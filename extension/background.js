// Relays draft requests from autofill.js to the native helper (native/host.js),
// which runs the claude CLI. Lives here rather than in the popup so drafting
// keeps going after the popup closes; an open native port keeps this worker alive.
const HOST = 'com.applylog.claude';

// Keep the worker self-contained: a failure to fetch an imported extension
// script prevents the service worker from starting at all.
async function getActiveResume() {
  const store = await chrome.storage.local.get(['resumes', 'resumeId', 'resume']);
  let { resumes = [], resumeId = '' } = store;
  if (store.resume && !resumes.length) {
    resumes = [{ id: Date.now().toString(36), label: 'My resume', ...store.resume }];
    resumeId = resumes[0].id;
    await chrome.storage.local.set({ resumes, resumeId });
    await chrome.storage.local.remove('resume');
  }
  if (resumes.length && !resumes.some((r) => r.id === resumeId)) resumeId = resumes[0].id;
  return resumes.find((r) => r.id === resumeId) || null;
}

function ask(message) {
  return new Promise((resolve) => {
    let port;
    try { port = chrome.runtime.connectNative(HOST); } catch (e) { resolve({ ok: false, error: e.message }); return; }
    let done = false;
    port.onMessage.addListener((reply) => { done = true; resolve(reply); port.disconnect(); });
    port.onDisconnect.addListener(() => {
      if (done) return;
      const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
      resolve({
        ok: false,
        error: /not found/i.test(err || '')
          ? 'The drafting helper isn’t installed. Run native/install.sh (see README).'
          : (err || 'The drafting helper stopped unexpectedly.')
      });
    });
    port.postMessage(message);
  });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'ping') {
    ask({ type: 'ping' }).then(reply);
    return true;
  }
  if (msg.type === 'draft') {
    (async () => {
      const { profile = {} } = await chrome.storage.local.get('profile');
      const resume = await getActiveResume();
      const res = await ask({ type: 'draft', questions: msg.questions, job: msg.job, profile, resume });
      reply(res);
      // Let an open popup update its status line
      chrome.runtime.sendMessage({ type: 'draftDone', ok: res.ok, count: (res.answers || []).length, error: res.error })
        .catch(() => {});
    })();
    return true;
  }
  return false;
});
