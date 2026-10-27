const $ = (id) => document.getElementById(id);

function showMsg(text, type = '') {
  $('msg').textContent = text;
  $('msg').className = `msg ${type}`;
}

function isValidUrl(u) {
  return /^https:\/\/script\.google\.com\/(a\/macros\/[^/]+|macros)\/s\/[^/]+\/exec$/.test(u);
}

async function load() {
  const { webAppUrl, secret } = await chrome.storage.sync.get({ webAppUrl: '', secret: '' });
  $('webAppUrl').value = webAppUrl;
  $('secret').value = secret;
}

$('optForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const webAppUrl = $('webAppUrl').value.trim();
  if (!isValidUrl(webAppUrl)) {
    showMsg('That doesn’t look like a web app URL. It should end in /exec.', 'err');
    return;
  }
  await chrome.storage.sync.set({ webAppUrl, secret: $('secret').value });
  showMsg('✓ Saved', 'ok');
});

$('testBtn').addEventListener('click', async () => {
  const webAppUrl = $('webAppUrl').value.trim();
  if (!isValidUrl(webAppUrl)) { showMsg('Enter a valid web app URL first.', 'err'); return; }
  showMsg('Testing…');
  try {
    const res = await fetch(webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'ping', secret: $('secret').value })
    });
    const data = await res.json();
    if (data.ok) showMsg(`✓ Connected to sheet "${data.sheet}"`, 'ok');
    else showMsg(data.error || 'Connection failed', 'err');
  } catch (err) {
    showMsg('Couldn’t reach the web app. Check the URL and that access is set to "Anyone".', 'err');
  }
});

load();

// Autofill profile: kept in storage.local (this device only), never sent to the sheet
const profileForm = $('profileForm');

async function loadProfile() {
  const { profile = {} } = await chrome.storage.local.get('profile');
  for (const el of profileForm.elements) if (el.name && profile[el.name]) el.value = profile[el.name];
}

profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const profile = {};
  for (const el of profileForm.elements) if (el.name) profile[el.name] = el.value.trim();
  await chrome.storage.local.set({ profile });
  $('profileMsg').textContent = '✓ Profile saved';
  $('profileMsg').className = 'msg ok';
});

loadProfile();

// Resumes: stored as base64 so autofill can attach them to upload fields (see resumes.js)
async function showResumes() {
  const { resumes, resumeId } = await getResumes();
  const list = $('resumeList');
  list.textContent = '';
  if (!resumes.length) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="empty">No resumes saved yet.</span>';
    list.append(li);
    return;
  }
  const save = (next, id = resumeId) => chrome.storage.local.set({ resumes: next, resumeId: id }).then(showResumes);
  resumes.forEach((r, i) => {
    const li = document.createElement('li');
    const text = document.createElement('div');
    const label = document.createElement('input');
    label.value = r.label;
    label.setAttribute('aria-label', `Name for ${r.name}`);
    label.addEventListener('change', () => {
      resumes[i] = { ...r, label: label.value.trim() || r.name };
      save(resumes);
    });
    const file = document.createElement('div');
    file.className = 'q';
    file.textContent = `${r.name} (${Math.round(r.size / 1024)} KB)`;
    if (r.id === resumeId) {
      const tag = document.createElement('span');
      tag.className = 'default';
      tag.textContent = 'Selected';
      file.append(tag);
    }
    text.append(label, file);
    const del = document.createElement('button');
    del.type = 'button';
    del.title = 'Remove';
    del.setAttribute('aria-label', `Remove ${r.label}`);
    del.textContent = '×';
    del.addEventListener('click', () => {
      const rest = resumes.filter((x) => x.id !== r.id);
      save(rest, r.id === resumeId ? (rest[0] || {}).id || '' : resumeId);
    });
    li.append(text, del);
    list.append(li);
  });
}

$('resumeFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { $('resumeInfo').textContent = 'That file is over 5 MB.'; return; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const { resumes, resumeId } = await getResumes();
  const label = $('resumeLabel').value.trim() || file.name.replace(/\.[^.]+$/, '');
  const resume = { id: newResumeId(), label, name: file.name, type: file.type, size: file.size, data: btoa(bin) };
  await chrome.storage.local.set({ resumes: [...resumes, resume], resumeId: resumeId || resume.id });
  e.target.value = '';
  $('resumeLabel').value = '';
  $('resumeInfo').textContent = `✓ Added "${label}"`;
  showResumes();
});

// Saved answers for questions the profile doesn't cover
async function showAnswers() {
  const { answers = [] } = await chrome.storage.local.get('answers');
  const list = $('answerList');
  list.textContent = '';
  if (!answers.length) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="empty">No saved answers yet.</span>';
    list.append(li);
    return;
  }
  answers.forEach((x, i) => {
    const li = document.createElement('li');
    const text = document.createElement('div');
    const q = document.createElement('div');
    q.className = 'q';
    q.textContent = x.q;
    const a = document.createElement('div');
    a.className = 'a';
    a.textContent = x.a;
    text.append(q, a);
    const del = document.createElement('button');
    del.type = 'button';
    del.title = 'Delete';
    del.setAttribute('aria-label', `Delete answer to ${x.q}`);
    del.textContent = '×';
    del.addEventListener('click', async () => {
      answers.splice(i, 1);
      await chrome.storage.local.set({ answers });
      showAnswers();
    });
    li.append(text, del);
    list.append(li);
  });
}

$('answerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('newQ').value.trim();
  const a = $('newA').value.trim();
  const { answers = [] } = await chrome.storage.local.get('answers');
  const rest = answers.filter((x) => x.q.toLowerCase() !== q.toLowerCase());
  await chrome.storage.local.set({ answers: [...rest, { q, a }] });
  $('newQ').value = '';
  $('newA').value = '';
  showAnswers();
});

// Lists change when the popup remembers answers
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.answers) showAnswers();
  if (area === 'local' && changes.resumeId) showResumes();
});

showResumes();
showAnswers();

async function showApplicationRecords() {
  const { applicationRecords = [] } = await chrome.storage.local.get('applicationRecords');
  const list = $('recordList');
  list.replaceChildren();
  if (!applicationRecords.length) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="empty">No application records yet. On an application form, click “Save what I submitted” in the popup.</span>';
    list.append(li);
    return;
  }
  applicationRecords.forEach((record, index) => {
    const li = document.createElement('li');
    li.style.display = 'block';
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `${record.title || 'Application'} · ${record.company || 'Unknown company'} · ${new Date(record.savedAt).toLocaleDateString()}`;
    details.append(summary);
    const meta = document.createElement('p');
    meta.className = 'hint';
    meta.textContent = `${record.answers.length} saved answers${record.resume ? ` · Resume: ${record.resume.label} (${record.resume.name})` : ' · No resume selected'}`;
    details.append(meta);
    if (record.resume && record.resume.data) {
      const download = document.createElement('button');
      download.type = 'button'; download.className = 'secondary'; download.textContent = 'Download saved resume';
      download.addEventListener('click', () => {
        const bin = atob(record.resume.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: record.resume.type || 'application/octet-stream' }));
        const a = document.createElement('a'); a.href = url; a.download = record.resume.name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      details.append(download);
    }
    const answers = document.createElement('ul');
    answers.className = 'answers';
    record.answers.forEach((item) => {
      const row = document.createElement('li');
      const text = document.createElement('div');
      const q = document.createElement('div'); q.className = 'q'; q.textContent = item.question;
      const a = document.createElement('div'); a.className = 'a'; a.textContent = item.answer;
      text.append(q, a); row.append(text); answers.append(row);
    });
    details.append(answers);
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'secondary'; del.textContent = 'Delete record';
    del.addEventListener('click', async () => {
      const { applicationRecords: current = [] } = await chrome.storage.local.get('applicationRecords');
      current.splice(index, 1);
      await chrome.storage.local.set({ applicationRecords: current });
      showApplicationRecords();
    });
    details.append(del);
    li.append(details); list.append(li);
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.applicationRecords) showApplicationRecords();
});
showApplicationRecords();

// Drafting written answers through the native helper
async function loadDrafts() {
  const { draftsEnabled = true } = await chrome.storage.local.get('draftsEnabled');
  $('draftsEnabled').checked = draftsEnabled;
}

$('draftsEnabled').addEventListener('change', (e) => chrome.storage.local.set({ draftsEnabled: e.target.checked }));

$('testDrafts').addEventListener('click', async () => {
  const msg = $('draftsMsg');
  msg.textContent = 'Checking…';
  msg.className = 'msg';
  const res = await chrome.runtime.sendMessage({ type: 'ping' });
  if (!res.ok) { msg.textContent = res.error; msg.className = 'msg err'; return; }
  if (res.loggedIn === false) {
    msg.textContent = `Helper works (Claude Code ${res.claude}), but the claude CLI isn’t logged in. Run claude in Terminal and log in.`;
    msg.className = 'msg err';
    return;
  }
  msg.textContent = `✓ Helper works with Claude Code ${res.claude}`;
  msg.className = 'msg ok';
});

loadDrafts();
