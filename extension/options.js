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
