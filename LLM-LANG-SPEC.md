# LLM-Lang v1 — a token-minimal encoding for LLM-to-LLM / LLM-context text

> The operational form of the "a language only for LLMs" idea. Grounded in a
> measured experiment, not vibes: `~/.claude/boss/research/lang-experiment/FINDINGS.md`.
> Goal: same meaning, fewest BPE tokens, full model comprehension. NOT for humans
> primarily (still readable), NOT for end-users — for text the model ingests every turn
> (system prompts, rules, memory, doctrine, agent handoffs).

## 0. The one fact that decides everything

The cost is the **tokenizer**, not the character count. Modern LLM tokenizers (BPE,
o200k-class) charge:

- common English word ≈ **~1 token** (often the whole word)
- CJK / exotic glyph ≈ **1–3 tokens PER CHARACTER** (~0.67 tok/char vs English ~0.21)

So a "dense" human language (Chinese: half the characters) costs **MORE** tokens, measured:
Chinese +22–26%, Japanese +73–93%. **A bespoke symbol alphabet loses too** unless every
symbol is a single high-frequency BPE token AND decodes with zero extra "thinking" tokens
(the decode-cost trap). Therefore the cheapest LLM language is **already-common English
words, stripped of everything the model can infer, plus a thin symbol layer for structure.**

Measured winners (vs English baseline, 9/9 comprehension on real Sonnet subagents):
- **Compressed-English (telegraphic prose):** −20–28%. Safest. Use for logic/doctrine.
- **Symbolic-DSL (structure):** −21–37%. Densest. Use for config/tables/metadata.

## 1. Encoding rules — compressed-English (prose, logic, doctrine)

Drop what the model reconstructs for free; keep every load-bearing token.

| Drop | Keep |
|---|---|
| articles (a/an/the) | nouns, verbs, numbers, named entities |
| copulas (is/are/be) when implied | negation (not/never/no) — **never drop** |
| filler (just/really/very/in order to/please) | conditionals (if/unless/when) — **never drop** |
| hedges (perhaps/I think/it seems) | quantifiers (all/none/each/≥/≤) — **never drop** |
| pleasantries, meta-narration | modality (must/may/should) — **preserve exact strength** |
| redundant restatement | exceptions/edge-cases — **preserve fully** |

- Imperative voice: "Validate input at boundaries" not "You should always make sure to validate."
- One idea per line. Fragments OK. No transitional prose between bullets.
- Keep code blocks, commands, regexes, paths **verbatim** — never compress literals.

## 2. DSL layer — symbols for structure & relations (config/tables/metadata)

Each symbol below is chosen to be 1 token in o200k-class tokenizers and unambiguous.

| Symbol | Means | Example |
|---|---|---|
| `→` | leads to / then / produces | `fail→retry→escalate` |
| `∴` | therefore / conclusion | `tests red ∴ block merge` |
| `⊃` | requires / depends on | `deploy ⊃ green CI` |
| `≠` | is not / separate from | `writer ≠ reviewer` |
| `\|` | OR / alternatives | `haiku\|sonnet\|opus` |
| `&` | AND / both | `lint & test` |
| `>` | preferred over | `reuse > build` |
| `@` | at / in context | `validate @boundaries` |
| `#N` | count / threshold | `files <800 #lines` |
| `!` | hard rule / must | `!no hardcoded secrets` |
| `?` | optional / conditional | `?cache expensive ops` |
| `✓/✗` | do / don't | `✓early-return ✗deep-nest` |
| `k:v` | key-value | `cov:80% fn:<50ln` |

- Tables stay tables (already dense). Convert prose lists of attributes → `k:v` rows.
- Frontmatter / config → `k:v`. Never DSL-ify a literal command or code.

## 3. Encode procedure

1. Read source. Mark load-bearing tokens (rules 1, "never drop" column).
2. Strip droppable tokens; rewrite to imperative telegraphic lines.
3. Convert attribute-lists / config / metadata to DSL `k:v` + symbols.
4. Keep all literals (code, paths, commands, numbers, names) verbatim.
5. Measure: `python tokens.py` or chars/4 proxy. Target ≥20% reduction.

## 4. Fidelity gate (MANDATORY before adopting on any live governance doc)

Terseness is safe on facts/structure, **riskiest on subtle conditional logic**. So:

1. From the **original**, generate ≥8 comprehension questions covering every conditional,
   exception, threshold, and "never" rule (the load-bearing parts).
2. A **fresh-context** agent (writer ≠ grader) reads **only the compressed version** and
   answers them.
3. Grade vs the original-derived answer key.
4. **ADOPT only if:** ≥90% correct **AND** zero CRITICAL behavioral rules lost/altered
   (a flipped modality, dropped negation, or lost exception = automatic FAIL regardless of score).
5. On FAIL: keep the original, log which item was lost, re-encode that section less aggressively.

## 5. When NOT to use

- ✗ user-facing copy, marketing, anything a human reads as the product → normal English.
- ✗ literals (code/commands/paths/regex) → verbatim.
- ✗ legal / safety-critical exact wording → verbatim.
- ✓ system prompts, rule files, memory indexes, agent-to-agent handoffs, doctrine — the
  text the model re-reads every turn. That is where −20–37%/turn compounds.

## 6. Why this is the right "LLM language" (and a custom alphabet is not)

A novel glyph language *feels* more "for LLMs only," but it must (a) tokenize to 1 token/symbol
and (b) be decoded losslessly with no extra reasoning. English common words already satisfy (a)
for free and (b) perfectly (zero decode cost — the model is native). A custom alphabet risks both.
**The proven, shippable LLM-Lang is disciplined compressed-EN + a 1-token symbol layer.** Revisit a
bespoke symbol set only if a future tokenizer makes it pay, and only behind the §4 gate.

## 7. Empirical re-test on real rule files (2026-05-31) — READ THIS BEFORE COMPRESSING

Ran the full §3 encode + §4 gate over the 10 always-on `ecc/common/*.md` rule files (40 agents).
All 10 passed the fidelity gate at 100/100 — meaning was preserved. **But measuring the REAL token
delta (tiktoken o200k, not chars/4) exposed the catch:**

- **Net savings only 4.1% (150 tok across 10 files).** chars/4 proxy over-reported by ~2×.
- **2 of 10 files got WORSE** (hooks.md +4.7%, security.md −0.5%): the symbol layer (`✗ @ ! → ≥`)
  tokenized to MORE BPE tokens than the plain words it replaced. The decode-cost-trap warning in §0
  is real and bites on short tokens.
- Only genuinely **verbose prose** won (patterns.md −19%, development-workflow.md −9%). Already-terse,
  table-heavy, or code-heavy docs are **incompressible** — the tokenizer already packs them.
- **Decision: reverted all 10.** 4% with glyph-noise in governance files + 2 regressions ≠ worth it.

**Hard lessons (binding):**
1. **Measure tokens with the real tokenizer, never chars/4 — and never trust the encoder agent's own
   estimate.** chars/4 and the agent both lied here by ~2×.
2. **Only compress genuinely verbose PROSE.** Skip tables, code blocks, and already-terse docs.
3. **The symbol-DSL layer is net-negative on short/terse content** (each glyph ≥1 token, often >1, with
   no surrounding fat to trim). Use the word-dropping (compressed-EN) layer; reserve symbols for genuinely
   repetitive structured metadata where they replace multi-word phrases, and prove it pays per §4 + real tokens.
4. The fidelity gate proves *meaning survived*; it does NOT prove *tokens dropped*. They are separate axes —
   gate for safety, tokenizer for value. Ship only when BOTH pass.
