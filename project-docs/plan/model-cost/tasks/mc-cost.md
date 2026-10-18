# mc-cost

- 단위: mc-cost (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/usage/**`
  - `packages/shell/renderer/conversation/**`
  - `packages/design/wording/catalog/conversation.ts` and its regenerated `*.placeholders.ts` (run `deno task wording`; never hand-edit placeholders)
  - `tools/wireframes/**`

## The task

Make the per-call estimated cost count cache tokens once and at their own rates, and show the session's estimated cost under the conversation composer. Follow the plan README "정한 것" exactly. Follow `.claude/skills/ui-design/SKILL.md` and `.claude/skills/wording/SKILL.md`.

1. Core (`packages/core/lophn-agent/usage/cost.ts`):
   - new input tokens: `cache_in_input === true` → `input - cache_read - cache_write` (never below 0); `false` or `null` → `input` as is.
   - charge new input at `rate.input`, cache read at `rate.cache_read`, cache write at `rate.cache_write`; a null cache rate falls back to `rate.input`.
   - keep the reasoning-rate branch and everything else as is. Keep `rate_basis` honest about which rates were used.
   - fix the comments that describe the old rule.
   - one risk test (`.claude/skills/write-test`), in memory: the same token counts reported OpenAI-style (`cache_in_input: true`) and Anthropic-style (`false`) give the right amounts with distinct cache rates, and a null cache rate falls back to the input rate.
2. Renderer (`packages/shell/renderer/conversation/**`): under the composer of a conversation tab, one line with the session's estimated cost from `ReadAgentUsage` (`agent-usage` read, `session` filter, `from_at` = session opened, `through_at` = now):
   - sum the USD amounts of `kind` `estimated` and `reported`; show `$0.0123` (four decimals under one cent, two above);
   - add "Price unknown N" (wording per the wording skill) when `kind: "unknown"` has calls; show both parts joined with " · " when both exist;
   - no line when there is no amount and no unknown call;
   - re-read when a turn of that session ends; put the read in the conversation tab's source (core and fake), next to the existing reads.
   Find the right spot next to the existing line under the composer (folder and permissions); keep it quiet (secondary text).
3. Fakes and gallery (`tools/wireframes`): pages `new-conversation-cost` (amount only) and `new-conversation-cost-unknown` (amount plus unknown count). Register them like other conversation pages.

Checks: `deno task check:full`, `deno run -A packages/shell/renderer/build.ts`, `deno task wording --check`, `deno task wireframes`, two core boots. Report the page ids.
