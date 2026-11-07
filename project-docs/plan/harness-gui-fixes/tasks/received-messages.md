# received-messages

Harness GUI adapters stop drawing messages that the person did not type (task notifications, lophn calls and replies, messages from other sessions) as the person's own messages, using ACP's existing `actor: "received"`, `sender`, `call` and `reply_to`.

- 단위: adapter (wave 2)
- 선행: claude-fixes, harness-empty-resume. They edit the same adapter files.
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/received.ts` (new)
  - `packages/shell/main/extensions/bundled/harness-gui/received_test.ts` (new, only if a risky rule needs it)
  - `packages/shell/main/extensions/bundled/harness-gui/claude.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/claude_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/codex.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/codex_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/opencode.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/opencode_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/omp.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/omp_test.ts`
- 읽을 것:
  - issue: `project-docs/issues/harness-gui.md`, section "다른 agent·CLI가 넣은 메시지가 GUI에서 사람 메시지로 그려진다"
  - ACP: `packages/protocol/acp/items.ts` (`acpMessageItemSchema`: `actor`, `sender`, `call`, `reply_to`, `origin`), `project-docs/architecture/acp.md`
  - lophn call tags: `packages/core/lophn-agent/run-loop/input-text.ts` (`<lophn-call from=… call=… reply=…>`, `<lophn-reply call=… from=… status=…>`), `packages/protocol/lophn-agent/input-tags.ts`
  - screen: `packages/shell/renderer/conversation/thread/received-message.tsx` and `receivedMessage` in `agent-thread.tsx` (already renders `received`; do not change the screen)
  - reference (read-only): `/home/pyosechang/projects/harness-lab/t3code/t3code-web/apps/server/src/provider/Adapters/ClaudeAdapterV2.ts` (around the `origin.kind` handling), `/home/pyosechang/projects/harness-lab/emdash/emdash-desktopapp/packages/plugins/src/agents/impl/claude/acp-transform.ts`
- 계약:
  - 쓰는 것: `acpMessageItemSchema`, `acpSenderSchema` as they are (`agent` with `agent: null` and a name, or `program`). Do not extend ACP; if it cannot express something, report a request.
  - 내놓는 것: 없음

## 할 일

1. `received.ts`: one small shared function that classifies a user text (and, for Claude, transcript fields) into person vs received, and parses `<lophn-call …>` / `<lophn-reply …>` into sender name (`from`), `call` / `reply_to` and the body text. Unknown wrappers stay person messages as today.
2. Claude: in `replay`, classify user entries by transcript fields (`origin.kind` human vs others such as `task-notification`, `turnOrigin` such as `peer`) and lophn tags. Received ones become `message_added` with `actor: "received"`, a sender (`program` for task notifications, `agent` with name for lophn calls and other sessions), `origin: null`, and they do not create rewind points or bookmarks. In the live path, root user messages that are not the person's own (today ignored by `onUser` for root) are drawn the same way if the SDK stream delivers them; check the SDK types and existing fixtures, and report if there is no evidence of what arrives live.
3. Codex, OpenCode, omp: check whether resumed history or live events contain user messages that the person did not type (lophn call tags at least). Apply the same classification where they do. Report per harness what you found.
4. Tests: one or two small tests with hand-made transcript lines (say they are hand-made).

## 끝남

- `npm run check` passes.
- 위험 test: 없음 beyond the small tests above.
- 남지 않음: no `TODO`/`FIXME` added.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`, or "없음"
- **알려진 미완 동작**: or "없음"
