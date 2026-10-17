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

// Resume: stored as base64 so autofill can attach it to upload fields
async function showResume() {
  const { resume } = await chrome.storage.local.get('resume');
  const info = $('resumeInfo');
  info.textContent = '';
  if (!resume) { info.textContent = 'No resume saved yet.'; return; }
  info.append(`Saved: ${resume.name} (${Math.round(resume.size / 1024)} KB) `);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'link-btn';
  remove.textContent = 'Remove';
  remove.addEventListener('click', async () => { await chrome.storage.local.remove('resume'); showResume(); });
  info.append(remove);
}

$('resumeFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { $('resumeInfo').textContent = 'That file is over 5 MB.'; return; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  await chrome.storage.local.set({ resume: { name: file.name, type: file.type, size: file.size, data: btoa(bin) } });
  e.target.value = '';
  showResume();
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
});

showResume();
showAnswers();
