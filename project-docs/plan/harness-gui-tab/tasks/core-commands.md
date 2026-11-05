# core-commands

lophn agent의 `/` 명령이 acp-more의 새 명령 칸을 채운다. 내장 명령은 `source: "app"`과 `opens`를 받고, skill은 출처에 맞는 `source`를 받고, 별칭이 붙는다. screen-thread가 화면의 명령 이름 switch(`agent-view.tsx`의 `source === "builtin"` 분기)를 지워도 lophn agent의 내장 아홉(`new, rename, archive, compact, fork, mcp, skills, permissions, status`)은 그대로 돈다(정한 것 5: lophn agent의 동작은 그대로). 정한 것 16의 화면 동작 중 lophn agent가 이미 가진 것(model, effort, rewind, usage·context)도 명령 목록에 넣고, `/clear`는 `new`의 별칭으로 둔다.

- 단위: acp (wave 5)
- 선행: acp-more
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/commands.ts`
  - `packages/core/lophn-agent/commands/{registry.ts,reads.ts}`
  - `packages/core/main/daemon/wiring/{acp-build.ts,acp-build_test.ts,acp-send.ts,acp-send_test.ts}`
- 읽을 것:
  - 점검 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/ui-reference.md` §1(묶음 "lophn", 순위의 출처 순서), `audit-claude.md` §5.4 A(내장 목록과 별칭)
  - 화면의 지금 분기: `packages/shell/renderer/conversation/agent-view.tsx`의 `runSlash`(내장 아홉이 하는 일. 읽기만)
  - architecture: `project-docs/architecture/acp.md`, `agent-chat.md`
- 계약:
  - 쓰는 것: acp-more의 `AcpCommand`(`source`, `aliases`, `opens`), `ListCommands`(`commandsList`), `readSessionMeta`와 draft meta(`acp-build.ts`)
  - 내놓는 것: lophn session meta와 draft meta의 `commands`가 새 칸을 채운다. 내장마다 어느 `opens`인지는 이 task가 정해 보고한다. screen-thread의 fake source는 같은 값을 손으로 적는다.

할 일: (살 단계가 채운다)
