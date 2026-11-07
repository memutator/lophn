# claude-meta

The Claude GUI shows "Ask before edit" until the first turn's `system/init`, even though the person's setting is auto; and the model shows as "Default" instead of the real model. Show the real permission mode and model from the start.

- 단위: adapter (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/claude.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/claude_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/harness-gui.md` "Claude Code adapter" ("mode와 model은 첫 turn의 `system/init`에서야 안다")
  - SDK: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (`initializationResult`, `supportedModels`, `getContextUsage` → `model`, `ModelInfo`)
  - skill: `.claude/skills/harness-gui/SKILL.md`
- 계약:
  - 쓰는 것: ACP session meta (`mode`, `model`, `models`) as is
  - 내놓는 것: 없음

## 할 일

1. Mode at start: publish the mode the CLI will actually use before the first turn. The SDK init response has no mode; read the person's Claude settings the same way the CLI does (`permissions.defaultMode` in user `~/.claude/settings.json`, project `.claude/settings.json`, `.claude/settings.local.json`; later wins; read only, never write), unless a mode is passed by lophn (`carry.mode`). On resume also prefer what the session last used if the SDK exposes it. Once `system/init` arrives, it stays authoritative. Use the injected file reading the adapter already has if any; otherwise add a small injectable reader to `ClaudeSdk`/deps so tests stay hermetic.
2. Model: when the chosen model is the "default" entry, show the resolved model name (from `getContextUsage().model`, already read in `refreshContext`, matched against `supportedModels`) instead of "Default". Keep the picker's choice semantics (choosing Default still means default).
3. One small test for each with fake data.

## 끝남

- `npm run check` passes.
- 위험 test: 없음 beyond the two small tests.

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
