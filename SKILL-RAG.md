# skill-rag — lazy skill loading for Claude Code (0-token, all skills usable)

Built 2026-05-29. Gives "all skills usable, ~0 token cost" by deferring rarely-used
skills out of Claude Code's scanned dir and staging the relevant ones back in on each
prompt via skilldb (semantic RAG).

## Why it works (proven on CC 2.1.156)

Claude Code injects every installed skill's NAME into context every turn (~8.3k tokens
for 1,600 skills). There's no native way to hide a skill while keeping it invocable
(`skillOverrides: off`/`user-invocable-only` both DISABLE model invocation; the listing
budget only trims descriptions, never names). BUT: **the skill list is rebuilt AFTER
UserPromptSubmit hooks run, in the same message** (proven with a canary). So a hook can
inject only the relevant skills per prompt.

## Architecture

- `~/.claude/skills/`      = LIVE  (scanned by Claude Code → listed + invocable → costs tokens)
- `~/.claude/skills-cold/` = COLD  (NOT scanned → 0 tokens). Source of truth for deferred skills.
- INVARIANT: LIVE and COLD are disjoint. A skill is in exactly one.
- `stage` (UserPromptSubmit hook): reads your prompt → `skilldb query` (top-8) → copies
  matching COLD skills into LIVE for that turn, removes the ones it staged last turn.
  Fail-open: any error leaves LIVE untouched; only ever removes skills it staged AND that
  exist in COLD (can never delete a real/live skill).

## Commands

    node tools/skill-rag/skillrag.js status                 # LIVE / COLD / staged counts
    node tools/skill-rag/skillrag.js coldstore <names>      # defer specific skills (LIVE→COLD)
    node tools/skill-rag/skillrag.js coldstore-except [hot] # defer EVERYTHING not in the HOT core
    node tools/skill-rag/skillrag.js restore                # KILL-SWITCH: all back to LIVE, COLD emptied
    echo '{"prompt":"..."}' | node .../skillrag.js stage    # manual stage test

## HOT core (`~/.claude/skill-rag/hot-core.txt`)

The HOT core = skills kept ALWAYS-LIVE (never deferred): behavior (caveman), code
review / debug / planning / verification, prompt+skill tooling, token/context meta, and
the active project's skills — the cross-cutting stuff the model reaches for reflexively,
where prompt-keyed staging would miss them. Regenerate with `node gen-hot-core.js`
(edit the EXACT set / KEEP_PREFIX rules there), then `coldstore-except`.

`coldstore-except` defers all LIVE skills not in the hot file. The `stage` hook also
**auto-absorbs new installs**: any LIVE skill that isn't HOT and wasn't just staged is
deferred on the next prompt — so installing skills never re-inflates the listed set.

## Kill-switch

If anything misbehaves (a skill you need isn't staged, latency, weirdness):

    node ~/tools/skill-rag/skillrag.js restore

Instantly copies every deferred skill back to LIVE (full list restored) and clears
staged state. Reversible — run `coldstore` again to re-defer.

## Status as of 2026-05-29

- Wired into `.claude/settings.json` UserPromptSubmit (sync, 10s timeout).
- First conservative batch deferred: 147 skills (azure-*/odoo-*/leiloeiro-*/junta-* —
  clearly never used ad-hoc). LIVE 1609 → 1462. ~735 tokens/turn saved so far.
- Latency: skilldb query ~0.4-0.7s added per prompt.

## TODO (next increments)

- Scale the cold set toward all ~1,600 minus a HOT always-live core (the skills used
  often enough that per-prompt staging would miss them). Expand in batches, validating.
- Auto-defer newly installed skills (hook into skilldb ingest) so new skills don't
  re-inflate the live list.
- Optional: persistent skilldb server to cut the per-prompt latency.
- When Claude Code ships native SkillSearch (#29711), retire this in favor of it.
