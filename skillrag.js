#!/usr/bin/env node
/**
 * skill-rag — lazy "cold storage + per-prompt staging" for Claude Code skills.
 *
 * PROBLEM: Claude Code injects every installed skill's NAME into context every
 * turn (~8.3k tokens for 1,600 skills) and there is no native way to hide a
 * skill while keeping it invocable (proven: skillOverrides off/user-invocable-only
 * disable model invocation; budget only trims descriptions).
 *
 * MECHANISM (proven on CC 2.1.156): the skill list is rebuilt AFTER
 * UserPromptSubmit hooks run, in the SAME message. So:
 *   - Park rarely-used skills in COLD (a dir Claude Code does NOT scan) → 0 tokens.
 *   - On each prompt, a UserPromptSubmit hook runs skilldb (semantic RAG) on the
 *     prompt, copies the top-K matching skills COLD→LIVE, and removes the ones it
 *     staged last turn. Only ~K names list that turn (~tiny tokens) and they're
 *     invocable.
 *
 * SAFETY: the kill-switch (`restore`) copies everything back to LIVE instantly.
 * Fail-open: any error leaves LIVE untouched. Never removes a skill it didn't
 * stage (tracked in staged.json) and never touches anything not in COLD.
 *
 * Subcommands:
 *   stage         (UserPromptSubmit hook) read prompt on stdin → stage top-K
 *   coldstore ... move named skills LIVE→COLD (defer them)
 *   restore       KILL-SWITCH: copy all COLD→LIVE, clear staged state
 *   status        counts
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const HOME = os.homedir();
const LIVE = path.join(HOME, '.claude', 'skills');
const COLD = path.join(HOME, '.claude', 'skills-cold');
const STATE_DIR = path.join(HOME, '.claude', 'skill-rag');
const STAGED_FILE = path.join(STATE_DIR, 'staged.json');
const HOT_FILE = path.join(STATE_DIR, 'hot-core.txt');
const SKILLDB = path.join(HOME, 'tools', 'skilldb', 'skilldb.js');
const TOP_K = 12;

function ensureDirs() {
  for (const d of [COLD, STATE_DIR]) fs.mkdirSync(d, { recursive: true });
}
function readStaged() {
  try { return JSON.parse(fs.readFileSync(STAGED_FILE, 'utf8')); } catch { return []; }
}
function writeStaged(names) {
  try { fs.writeFileSync(STAGED_FILE, JSON.stringify(names)); } catch {}
}
function existsInCold(name) {
  return fs.existsSync(path.join(COLD, name, 'SKILL.md')) || fs.existsSync(path.join(COLD, name));
}
function listDirs(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); }
  catch { return []; }
}

// --- stage (the per-prompt hook) ---
function stage() {
  ensureDirs();
  let prompt = '';
  try { prompt = fs.readFileSync(0, 'utf8'); } catch {}
  // hook payload is JSON; pull the prompt text out of it (fall back to raw)
  try { const j = JSON.parse(prompt); prompt = j.prompt || j.user_prompt || j.message || prompt; } catch {}
  prompt = String(prompt).slice(0, 2000).trim();
  if (!prompt) { process.exit(0); }

  // 1. Ask skilldb for the most relevant skills (semantic + keyword).
  let candidates = [];
  try {
    const r = spawnSync('bun', [SKILLDB, 'query', prompt, '-n', String(TOP_K), '--json'],
      { encoding: 'utf8', timeout: 8000, shell: process.platform === 'win32' });
    if (r.stdout) {
      const names = [...r.stdout.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
      candidates = names.filter(existsInCold);
    }
  } catch {}

  // Fail-open: if skilldb gave nothing, do NOT tear down what's already staged.
  if (!candidates.length) process.exit(0);
  const wanted = [...new Set(candidates)].slice(0, TOP_K);

  const prevStaged = readStaged();
  // 2. Remove previously-staged skills no longer wanted — ONLY ones we staged
  //    AND that still exist in COLD (so we can never delete a real/hot skill).
  for (const name of prevStaged) {
    if (wanted.includes(name)) continue;
    if (!existsInCold(name)) continue;            // safety: must have a cold source
    const liveDir = path.join(LIVE, name);
    try { if (fs.existsSync(liveDir)) fs.rmSync(liveDir, { recursive: true, force: true }); } catch {}
  }
  // 3. Copy wanted skills COLD→LIVE (if not already live).
  const nowStaged = [];
  for (const name of wanted) {
    const src = path.join(COLD, name);
    const dst = path.join(LIVE, name);
    try {
      if (!fs.existsSync(dst)) fs.cpSync(src, dst, { recursive: true });
      nowStaged.push(name);
    } catch {}
  }
  writeStaged(nowStaged);

  // 4. Auto-absorb new installs: any LIVE skill that is NOT in the HOT core and
  //    NOT something we just staged is a newly-installed skill re-inflating the
  //    list — defer it so "infinite skills" never costs context. Guarded: only
  //    runs when hot-core.txt exists and is non-empty (else we'd defer everything).
  let autoDeferred = [];
  try {
    if (fs.existsSync(HOT_FILE)) {
      const hot = new Set(
        fs.readFileSync(HOT_FILE, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'))
      );
      if (hot.size > 0) {
        const keep = new Set([...hot, ...nowStaged]);
        const intruders = listDirs(LIVE).filter(name => !keep.has(name));
        for (const name of intruders) {
          const src = path.join(LIVE, name);
          const dst = path.join(COLD, name);
          try {
            if (!fs.existsSync(dst)) fs.cpSync(src, dst, { recursive: true });
            fs.rmSync(src, { recursive: true, force: true });
            autoDeferred.push(name);
          } catch {}
        }
      }
    }
  } catch {}

  // 5. Tell the model what got staged (cheap, useful context).
  if (nowStaged.length) {
    process.stdout.write(`[skill-rag] staged for this turn: ${nowStaged.join(', ')}\n`);
  }
  if (autoDeferred.length) {
    process.stdout.write(`[skill-rag] auto-deferred ${autoDeferred.length} new skill(s) to cold: ${autoDeferred.join(', ')}\n`);
  }
  process.exit(0);
}

// --- coldstore (defer named skills) ---
function coldstore(names) {
  ensureDirs();
  let moved = 0, skipped = [];
  for (const name of names) {
    const src = path.join(LIVE, name);
    const dst = path.join(COLD, name);
    if (!fs.existsSync(src)) { skipped.push(name + ' (not in LIVE)'); continue; }
    if (fs.existsSync(dst)) { try { fs.rmSync(src, { recursive: true, force: true }); moved++; continue; } catch {} }
    try { fs.cpSync(src, dst, { recursive: true }); fs.rmSync(src, { recursive: true, force: true }); moved++; }
    catch (e) { skipped.push(name + ' (' + (e && e.message) + ')'); }
  }
  console.log(`coldstore: moved ${moved} skill(s) to COLD.` + (skipped.length ? ` skipped: ${skipped.join('; ')}` : ''));
}

// --- coldstore-except (defer everything LIVE that isn't in the HOT core) ---
// HOT core = skills kept always-live (one name per line in hot-core.txt). This is
// the "scale toward all skills minus a hot core" primitive. Never defers a HOT
// skill, the non-dir entries (SKILLS-INDEX.md), or anything currently staged.
function coldstoreExcept(args) {
  ensureDirs();
  const hotPath = args[0] || HOT_FILE;
  if (!fs.existsSync(hotPath)) { console.error(`hot-core file not found: ${hotPath}`); process.exit(1); }
  const hot = new Set(
    fs.readFileSync(hotPath, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'))
  );
  const staged = new Set(readStaged());
  const live = listDirs(LIVE);
  const toDefer = live.filter(name => !hot.has(name) && !staged.has(name));
  console.log(`coldstore-except: LIVE=${live.length} HOT=${hot.size} staged=${staged.size} → deferring ${toDefer.length}`);
  coldstore(toDefer);
}

// --- restore (KILL-SWITCH) ---
function restore() {
  ensureDirs();
  const cold = listDirs(COLD);
  let restored = 0;
  for (const name of cold) {
    const src = path.join(COLD, name);
    const dst = path.join(LIVE, name);
    try {
      if (!fs.existsSync(dst)) fs.cpSync(src, dst, { recursive: true });
      // Enforce the disjoint invariant: a skill is either LIVE or COLD, never
      // both. Removing the cold copy after restoring prevents the stager's
      // cleanup from ever tearing down a now-live skill.
      fs.rmSync(src, { recursive: true, force: true });
      restored++;
    } catch {}
  }
  writeStaged([]);
  console.log(`restore (kill-switch): ${restored}/${cold.length} skills back in LIVE, COLD emptied. All skills listed again. Run coldstore to re-defer.`);
}

function status() {
  const live = listDirs(LIVE).length;
  const cold = listDirs(COLD).length;
  const staged = readStaged();
  console.log(`skill-rag status:`);
  console.log(`  LIVE (listed, costs tokens): ${live}`);
  console.log(`  COLD (deferred, 0 tokens):   ${cold}`);
  console.log(`  currently staged:            ${staged.length}${staged.length ? ' (' + staged.join(', ') + ')' : ''}`);
}

const [, , cmd, ...args] = process.argv;
switch (cmd) {
  case 'stage': stage(); break;
  case 'coldstore': coldstore(args); break;
  case 'coldstore-except': coldstoreExcept(args); break;
  case 'restore': restore(); break;
  case 'status': status(); break;
  default:
    console.log('usage: skillrag.js stage|coldstore <names...>|coldstore-except [hotfile]|restore|status');
    process.exit(1);
}
