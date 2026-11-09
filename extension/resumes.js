// Shared by the popup, settings page and background worker.
// Resumes live in storage.local as
//   resumes:  [{ id, label, name, type, size, data (base64) }]
//   resumeId: id of the one autofill and Claude use
// Older versions kept a single `resume`; it's moved into the list on first read.

async function getResumes() {
  const store = await chrome.storage.local.get(['resumes', 'resumeId', 'resume']);
  let { resumes = [], resumeId = '' } = store;
  if (store.resume && !resumes.length) {
    resumes = [{ id: newResumeId(), label: 'My resume', ...store.resume }];
    resumeId = resumes[0].id;
    await chrome.storage.local.set({ resumes, resumeId });
    await chrome.storage.local.remove('resume');
  }
  if (resumes.length && !resumes.some((r) => r.id === resumeId)) resumeId = resumes[0].id;
  return { resumes, resumeId };
}

async function getActiveResume() {
  const { resumes, resumeId } = await getResumes();
  return resumes.find((r) => r.id === resumeId) || null;
}

function newResumeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
