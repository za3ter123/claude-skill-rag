#!/usr/bin/env node
/**
 * gen-hot-core.js — generate the HOT-core allowlist for skill-rag.
 *
 * HOT core = skills kept ALWAYS-LIVE (never deferred). Everything else is parked
 * in COLD and staged back per-prompt by skilldb. The HOT set is the cross-cutting
 * stuff the *model* reaches for reflexively (behavior, code review, planning,
 * verification, prompt/skill tooling, token/context meta) + the skills for the
 * project being actively built, where prompt-keyed staging would miss them.
 *
 * Long-tail domain skills (vendor/cloud/lang-pro/seo/integration/regional/etc.)
 * are NOT hot: when you work in that domain the prompt names it, so skilldb stages
 * the right ones that turn.
 *
 * Writes ~/.claude/skill-rag/hot-core.txt (one name per line). Run, eyeball, then:
 *   node skillrag.js coldstore-except
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const LIVE = path.join(HOME, '.claude', 'skills');
const OUT = path.join(HOME, '.claude', 'skill-rag', 'hot-core.txt');

// Exact names to keep live.
const EXACT = new Set([
  // behavior / output (always-on)
  'caveman',
  // code quality / review / simplify (reflexive, cross-task)
  'code-reviewer', 'code-review-checklist', 'code-review-excellence', 'clean-code',
  'code-simplifier', 'simplify-code', 'plankton-code-quality', 'vibe-code-auditor',
  'find-bugs', 'bug-hunter',
  // anti-slop (house quality bar)
  'stop-slop', 'unslop', 'avoid-ai-writing',
  // debugging
  'debugger', 'debugging-strategies', 'debugging-toolkit-smart-debug',
  'systematic-debugging', 'error-handling-patterns', 'error-detective',
  // architecture / planning
  'architect-review', 'architecture', 'architecture-patterns', 'software-architecture',
  'backend-architect', 'senior-architect', 'api-design',
  'brainstorming', 'planning-with-files', 'writing-plans', 'executing-plans',
  'concise-planning', 'plan-writing',
  // research / reuse (doctrine step 0)
  'deep-research', 'exa-search', 'tavily-web', 'search-specialist', 'context7-auto-research',
  // testing / verification
  'test-driven-development', 'tdd-orchestrator', 'tdd-workflow', 'testing-patterns',
  'testing-qa', 'verification-before-completion', 'verification-loop',
  // security (general — domain-specific security tooling stays cold)
  'security-auditor', 'security-audit', 'backend-security-coder',
  // prompt / skill / tool meta-instruments
  'prompt-master', 'prompt-engineer', 'prompt-engineering', 'prompt-engineering-patterns',
  'prompt-library', 'enhance-prompt', 'mcp-builder', 'agent-tool-builder', 'tool-design',
  // token / context efficiency (this very domain)
  'context-fundamentals', 'context-optimization', 'context-window-management',
  'context-compression', 'context-degradation', 'context-guardian',
  'context-management-context-save', 'context-management-context-restore',
  'prompt-caching', 'strategic-compact', 'cc-skill-strategic-compact',
  // memory / persistence
  'agent-memory-systems', 'memory-systems', 'conversation-memory',
  'hierarchical-agent-memory', 'setup-gbrain',
  // agent orchestration (I dispatch a lot)
  'agent-orchestrator', 'multi-agent-patterns', 'dispatching-parallel-agents',
  'parallel-agents', 'subagent-driven-development', 'multi-agent-task-orchestrator',
  'agent-orchestration-multi-agent-optimize', 'orchestrate-batch-refactor',
  // ACTIVE PROJECT: agent-ide design module (built right now)
  'huashu-design', 'hallmark', 'llm-council', 'council', 'clone-website',
  'pocock-grill-me', 'pocock-grill-with-docs',
  'design-review', 'design-consultation', 'design-md', 'design-html', 'design-spells',
  'design-orchestration', 'design-motion-principles', 'design-taste-frontend',
  'frontend-design', 'high-end-visual-design', 'web-design-guidelines',
  'antigravity-design-expert', 'ui-ux-designer', 'ui-ux-pro-max', 'brand-guidelines',
  'gpt-taste', 'minimalist-ui', 'baseline-ui',
  // writing (used across docs/specs)
  'beautiful-prose', 'copywriting', 'professional-proofreader',
]);

// Prefixes to keep live (safe meta clusters).
const KEEP_PREFIX = [
  'skill-',   // skill tooling: skill-creator, skill-installer, skill-router, ...
];

function isHot(name) {
  if (EXACT.has(name)) return true;
  return KEEP_PREFIX.some(p => name.startsWith(p));
}

const live = fs.readdirSync(LIVE, { withFileTypes: true })
  .filter(e => e.isDirectory()).map(e => e.name);

const hot = live.filter(isHot).sort();
const defer = live.filter(n => !isHot(n));
const unmatchedExact = [...EXACT].filter(n => !live.includes(n)).sort();

fs.writeFileSync(OUT, hot.join('\n') + '\n');

console.log(`live skills:      ${live.length}`);
console.log(`HOT (keep live):  ${hot.length}  -> ${OUT}`);
console.log(`DEFER (to cold):  ${defer.length}`);
console.log(`\nHOT core:\n  ${hot.join('\n  ')}`);
if (unmatchedExact.length) {
  console.log(`\n[warn] ${unmatchedExact.length} HOT names not found in LIVE (already cold / commands / not installed):`);
  console.log(`  ${unmatchedExact.join(', ')}`);
}
