#!/usr/bin/env node
/**
 * ApplyLog native messaging host. Chrome starts this when the extension asks for
 * drafts, passes one JSON message on stdin, and reads one reply on stdout
 * (each framed by a 4-byte little-endian length).
 *
 * It runs the official `claude` CLI in print mode, so drafts use the Claude
 * subscription you're logged in with. Claude only gets the Read tool, confined
 * to a temporary folder holding your resume.
 *
 * Messages in:  { type: 'ping' }
 *               { type: 'draft', questions: [{ id, q, maxLength }], job: { title, company, url, description },
 *                 profile: {...}, resume: { name, type, data } }
 * Messages out: { ok: true, version, claude } | { ok: true, answers: [{ id, text }] } | { ok: false, error }
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLAUDE = process.env.APPLYLOG_CLAUDE || 'claude';
const MODEL = process.env.APPLYLOG_MODEL || ''; // empty = your Claude Code default
const TIMEOUT_MS = 4 * 60 * 1000;

function readMessage() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (c) => {
      chunks.push(c);
      const buf = Buffer.concat(chunks);
      if (buf.length >= 4) {
        const len = buf.readUInt32LE(0);
        if (buf.length >= 4 + len) resolve(JSON.parse(buf.subarray(4, 4 + len).toString('utf8')));
      }
    });
    process.stdin.on('end', () => reject(new Error('No message from Chrome')));
  });
}

function send(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]), () => process.exit(0));
}

function run(args, cwd, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Claude took too long (over 4 minutes).')); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(e.code === 'ENOENT' ? `Can't find the claude CLI (${CLAUDE}). Re-run native/install.sh.` : e.message));
    });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    if (input) child.stdin.end(input); else child.stdin.end();
  });
}

const SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] }
    }
  },
  required: ['answers']
});

const SYSTEM = `You draft answers to open-ended questions on job applications, written as the candidate in the first person.

Ground every claim in the candidate's resume and profile. Never invent employers, projects, numbers, dates or skills. If the resume doesn't support a point, leave it out rather than guess.

Tailor each answer to this company and role using the job description: connect specific things the candidate has done to specific things the role needs, and name the company. Avoid generic praise, clichés ("I am passionate about", "fast-paced environment"), and restating the question.

Write plain text with no markdown, headings, bullet points or sign-off placeholders. Short answers run 80 to 180 words unless the question implies otherwise; a cover letter runs 200 to 350 words in three or four paragraphs. Never exceed a field's character limit when one is given.

The candidate reviews and edits every draft before submitting, so make it specific and ready to use.`;

const PROFILE_LABELS = {
  firstName: 'First name', lastName: 'Last name', pronouns: 'Pronouns', city: 'City', state: 'State', country: 'Country',
  school: 'School', degree: 'Degree', major: 'Major', gradDate: 'Graduation', currentCompany: 'Current company',
  currentTitle: 'Current title', linkedin: 'LinkedIn', github: 'GitHub', website: 'Website', startDate: 'Earliest start',
  relocate: 'Willing to relocate', inOffice: 'OK in office/hybrid'
};

function buildPrompt({ questions, job, profile }, resumeFile) {
  const prof = Object.entries(PROFILE_LABELS)
    .filter(([k]) => profile && profile[k])
    .map(([k, label]) => `${label}: ${profile[k]}`).join('\n');
  const qs = questions.map((x) => `- id ${x.id}: ${x.q}${x.maxLength ? ` (limit ${x.maxLength} characters)` : ''}`).join('\n');
  return [
    resumeFile
      ? `The candidate's resume is in ${resumeFile}. Read it first.`
      : 'No resume is available; rely on the profile only and keep claims modest.',
    '',
    '<profile>', prof || '(empty)', '</profile>',
    '',
    `<job title="${job.title || ''}" company="${job.company || ''}" url="${job.url || ''}">`,
    job.description || '(No job description found on the page.)',
    '</job>',
    '',
    'Draft an answer for each of these application questions:',
    qs,
    '',
    'Return one answer per id through the structured output.'
  ].join('\n');
}

function saveResume(resume, dir) {
  if (!resume || !resume.data) return null;
  const ext = (path.extname(resume.name || '') || '.pdf').toLowerCase();
  const file = path.join(dir, `resume${ext}`);
  fs.writeFileSync(file, Buffer.from(resume.data, 'base64'));
  if (['.doc', '.docx', '.rtf'].includes(ext)) {
    // The Read tool handles PDF and text; convert Word and RTF with macOS textutil
    try {
      execFileSync('/usr/bin/textutil', ['-convert', 'txt', file, '-output', path.join(dir, 'resume.txt')]);
      return 'resume.txt';
    } catch (e) { return null; }
  }
  return path.basename(file);
}

async function draft(msg) {
  if (!Array.isArray(msg.questions) || !msg.questions.length) return { ok: true, answers: [] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'applylog-'));
  try {
    const resumeFile = saveResume(msg.resume, dir);
    const args = [
      '-p', '--output-format', 'json', '--json-schema', SCHEMA,
      '--system-prompt', SYSTEM,
      '--tools', 'Read', '--allowedTools', 'Read', '--permission-mode', 'dontAsk',
      '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence'
    ];
    if (MODEL) args.push('--model', MODEL);
    const { code, out, err } = await run(args, dir, buildPrompt({ ...msg, job: msg.job || {} }, resumeFile));
    let res;
    try { res = JSON.parse(out); } catch (e) {
      throw new Error((err || out || `claude exited with code ${code}`).trim().slice(0, 300));
    }
    if (res.is_error) {
      const text = String(res.result || 'Claude returned an error');
      if (/authenticat|log ?in|oauth/i.test(text)) throw new Error('The claude CLI isn\'t logged in. Run `claude` in Terminal and log in with your Claude account.');
      throw new Error(text.slice(0, 300));
    }
    let answers = (res.structured_output && res.structured_output.answers) || [];
    if (!answers.length) {
      // Fall back to JSON written into the plain result text
      try { answers = JSON.parse(String(res.result).match(/\{[\s\S]*\}/)[0]).answers || []; } catch (e) { /* no JSON */ }
    }
    if (!answers.length) throw new Error('Claude didn\'t return any drafts.');
    return { ok: true, answers };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => {
  try {
    const msg = await readMessage();
    if (msg.type === 'ping') {
      const { out } = await run(['--version'], os.tmpdir());
      let loggedIn = null;
      try { loggedIn = JSON.parse((await run(['auth', 'status'], os.tmpdir())).out).loggedIn; } catch (e) { /* older CLI */ }
      send({ ok: true, version: 1, claude: out.trim(), loggedIn });
    } else if (msg.type === 'draft') {
      send(await draft(msg));
    } else {
      send({ ok: false, error: `Unknown message type ${msg.type}` });
    }
  } catch (e) {
    send({ ok: false, error: e.message });
  }
})();
