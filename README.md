# claude-skill-rag

Token-efficiency tooling for [Claude Code](https://claude.com/claude-code). Two parts:

1. **skill-rag** — make an unlimited number of skills usable at near-zero per-turn context cost.
2. **LLM-Lang** — a measured, fidelity-gated encoding spec for token-minimal LLM context.

---

## 1. skill-rag — lazy skill loading

**Problem:** Claude Code injects every installed skill's *name* into context on every turn.
At ~1,600 skills that's **~6.9k tokens per turn**, and there is no native way to hide a skill
while keeping it invocable (`skillOverrides: off` disables invocation; the listing budget only
trims descriptions, never names).

**Fix:** park rarely-used skills in a directory Claude Code does **not** scan (0 tokens), and a
`UserPromptSubmit` hook stages the relevant ones back per prompt via semantic search.

> Why it works (Claude Code 2.1.x): the skill list is rebuilt *after* `UserPromptSubmit` hooks run,
> in the same message. So a hook can inject only the skills relevant to the current prompt.

**Measured on a real setup:** LIVE skills 1,464 → 133, skill-list injection **6,930 → ~594 tok/turn
(~6.3k saved/turn)**, every skill still usable via per-prompt staging. Verified live across 5 domains.

### How it fits together

- `~/.claude/skills/` = **LIVE** (scanned → listed + invocable → costs tokens)
- `~/.claude/skills-cold/` = **COLD** (not scanned → 0 tokens). Disjoint from LIVE.
- `~/.claude/skill-rag/hot-core.txt` = the **HOT core** kept always-live (behavior + the
  cross-cutting skills the model reaches for reflexively, where prompt-keyed staging would miss them).
- A per-prompt hook queries a local skill index, stages the top matches COLD→LIVE, and removes last
  turn's. It also **auto-absorbs new installs** so the list can never re-inflate.

Requires a local skill search index that answers `query "<text>" --json` with `{"name": ...}` rows
(this repo was built against a small SQLite + embeddings indexer at `~/tools/skilldb/skilldb.js`;
point `SKILLDB` in `skillrag.js` at your own, or adapt the `stage()` candidate step).

### Commands

```bash
node skillrag.js status                 # LIVE / COLD / staged counts
node skillrag.js coldstore <names...>   # defer specific skills (LIVE→COLD)
node skillrag.js coldstore-except [hot] # defer EVERYTHING not in the HOT core
node skillrag.js restore                # KILL-SWITCH: all back to LIVE, COLD emptied
node gen-hot-core.js                    # (re)generate hot-core.txt from rules in this file
```

Wire `node /path/to/skillrag.js stage` as a `UserPromptSubmit` hook in `~/.claude/settings.json`.
**Fail-open:** any error leaves LIVE untouched; the stager only ever removes skills it staged and
that still exist in COLD, so it can never delete a real skill. Kill-switch restores everything instantly.

See [SKILL-RAG.md](SKILL-RAG.md) for the full design notes.

## 2. LLM-Lang — token-minimal encoding spec

[LLM-LANG-SPEC.md](LLM-LANG-SPEC.md) is a measured spec for encoding the text an LLM re-reads every
turn (system prompts, rule files, memory) into fewer tokens **without losing meaning**.

Grounded in a real experiment, not vibes:

- The cost is the **tokenizer**, not character count. "Dense" human languages (Chinese, Japanese)
  cost **more** BPE tokens, not fewer — measured +22–93%.
- The winner is **compressed-English + a thin 1-token symbol layer** (−20–37% on verbose prose,
  full comprehension on a fidelity quiz).
- **Honest negative result (§7):** applying it to 10 already-terse rule files saved only ~4% and made
  2 files *worse* (exotic glyphs tokenized to more tokens). Lesson: compress verbose prose only;
  measure with the real tokenizer, never `chars/4`; the fidelity gate proves meaning survived, not
  that tokens dropped.

## License

MIT — see [LICENSE](LICENSE).
