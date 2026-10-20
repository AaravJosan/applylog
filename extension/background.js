// Relays draft requests from autofill.js to the native helper (native/host.js),
// which runs the claude CLI. Lives here rather than in the popup so drafting
// keeps going after the popup closes; an open native port keeps this worker alive.
importScripts('resumes.js');

const HOST = 'com.applylog.claude';

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
