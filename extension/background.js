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

// Answers from each step of a multi-page application, per tab, so the popup can
// save the whole thing from the last step. The popup reads and clears them.
const STEPS_MAX_AGE = 3 * 60 * 60 * 1000;
let stepWrites = Promise.resolve();

function rememberStep(sender, answers) {
  if (!sender.tab) return;
  let origin = sender.origin;
  try { origin = new URL(sender.tab.url).origin; } catch (e) { /* no tab URL; use the frame's */ }
  const key = `steps_${sender.tab.id}`;
  // One write at a time, or two frames' steps would overwrite each other
  stepWrites = stepWrites.then(async () => {
    const { [key]: prev } = await chrome.storage.session.get(key);
    // Another site, or an application from hours ago, starts over
    const same = prev && prev.origin === origin && Date.now() - prev.updated < STEPS_MAX_AGE;
    const merged = new Map(same ? prev.answers : []);
    for (const { question, answer } of answers) {
      if (answer) merged.set(question, answer); else merged.delete(question);
    }
    await chrome.storage.session.set({ [key]: { origin, updated: Date.now(), answers: [...merged] } });
  }).catch(() => {});
}

chrome.tabs.onRemoved.addListener((tabId) => { chrome.storage.session.remove(`steps_${tabId}`); });

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'stepAnswers') {
    rememberStep(sender, msg.answers || []);
    return false;
  }
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
