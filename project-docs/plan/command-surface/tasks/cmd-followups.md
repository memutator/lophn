# cmd-followups

wave 1에서 남은 작은 것 셋: `preview.call`을 명령으로 옮기고, 너무 긴 앱 command 이름을 선언 검사가 막고, 낡은 주석을 고친다.

- 단위: cli (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/agent-tools/{preview.ts,mod.ts}`
  - `packages/cli/commands/{preview.ts,preview_test.ts}`
  - `packages/core/agent-places/{tool-lists.ts,tool-lists_test.ts}`
  - `packages/protocol/apps/declaration/{tools.ts,validate_test.ts}`
  - `packages/protocol/domains/values.ts`
  - `packages/protocol/lophn-agent/tool-catalog.ts`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/command-surface.md`
  - 본보기: `packages/cli/commands/preview.ts`(`preview.start`, `preview.stop`), `packages/cli/commands/types.ts`의 `CommandContext.caller`, `packages/core/lophn-agent/tools/lophn/command-tool.ts`
  - 호출 확인: `packages/core/apps/calls/caller.ts`(`verifyCaller`)
- 계약:
  - 쓰는 것: `CommandContext.caller`(`{session, turn, tool_call}`, `lophn` tool이 채우고 binary는 없다), `app.call_tool` 입력 `{target, kind, name, input?, caller}`

## 할 일

1. `preview.call`을 `PREVIEW_COMMANDS`의 셋째 명령으로 옮긴다. 입력 `{app, kind, name, input?}`, places `["app"]`, routes `previewsGet`, `appCallTool`. caller는 `ctx.caller`가 있으면 `{kind: "agent", ...ctx.caller}`이고, 없으면(binary) `{kind: "person"}`이다. `packages/core/apps/agent-tools/preview.ts`, `PREVIEW_TOOLS`, `tool-lists.ts`의 `preview.call`을 지운다.
2. 선언 검사(`packages/protocol/apps/declaration/tools.ts`)가 command의 agent wire 이름(`<domain>_<command의 . → _>`)이 64자를 넘으면 거절한다. 지금은 그런 command가 말없이 불리지 않는다.
3. 낡은 주석: `packages/protocol/domains/values.ts`(~11), `packages/protocol/lophn-agent/tool-catalog.ts`(~4), `packages/protocol/apps/declaration/tools.ts`(~175)가 앱 tool을 provider tool로 말하는 줄을 지금 모양(`lophn <domain> <command>`)으로 고친다.

## 끝남

- `npm run check:full`이 통과하고 `boot.sh`가 두 번 `exit 0`이다.
- 위험 test: "다른 place의 session이 `lophn preview call`로 남의 앱 preview를 부르면 core가 `forbidden`이다"(지금 `caller.ts`의 test가 보면 그것으로 된다. 없으면 하나 둔다)
- 남지 않음: `grep -rn '"preview.call"' packages/core/agent-places`가 0줄이다.

## 보고

- 바꾼 file, 통과한 check
- 정한 것, 넘길 줄
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
