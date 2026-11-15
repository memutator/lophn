# mobile-coding-state

core가 shell main이 올린 coding session(harness GUI handle)의 ACP 상태를 메모리에 접어 두고, 폰이 쓰는 기존 `acp/snapshot`, `acp/send`, `AcpUpdated`로 그대로 내게 한다. 목록과 switch route(`coding_sessions/{list,switch_plan,switch}`), 올라온 보고의 새 칸, 연결이 끊길 때의 정리, 개발용 fake host 도구를 짓는다. shell main 쪽은 `mobile-coding-shell`이 한다.

- 단위: coding-relay (wave 2)
- 선행: mobile-host-link
- 소유(이 task만 고친다):
  - `packages/core/coding-relay`(새 폴더 전체: `mod.ts`, `relay.ts`, `ports.ts`와 `*_test.ts`)
  - `packages/core/main/daemon/wiring/coding-relay.ts`(새 file)와 `coding-relay_test.ts`(새 file)
  - `packages/core/main/daemon/wiring/acp.ts`
  - `packages/core/main/daemon/wiring/acp-send.ts`
  - `packages/core/main/daemon/wiring/session-lifecycle.ts`
  - `packages/core/lophn-agent/session/lifecycle.ts`와 `lifecycle_test.ts`
  - `packages/protocol/coding-agent/relay.ts`(새 file)
  - `packages/protocol/lophn-agent/session-lifecycle.ts`
  - `packages/protocol/lophn-agent/session-tag.ts`
  - `packages/shell/renderer/terminal/model.ts`와 `model_test.ts`(`guiSessionId`를 옮기는 만큼만)
  - `tools/fake-coding-host.ts`(새 file)
- 한 줄씩 허락(공유 file. 한 줄만 더하고 "넘길 줄"에 적는다): `packages/core/main/daemon/assembly.ts`(import와 `WIRINGS`에서 `sessionLifecycleWiring` 바로 뒤 한 줄. 맨 뒤 wiring은 `remoteWiring`이 그대로여야 한다), `packages/core/main/daemon/wiring/context.ts`(`codingRelay` 칸), `packages/protocol/coding-agent/registry.ts`(`ROUTES`에 새 route)와 `packages/protocol/coding-agent/mod.ts`(내보내기), `packages/protocol/events/changes.ts`(`CHANGE_NAMES`에 `coding_sessions`), `packages/shell/renderer/terminal/terminal-gui.tsx`(`guiSessionId` import 한 줄), `project-docs/module-catalog.yaml`(`packages/core/coding-relay` 항목), `project-docs/flows/`의 area file와 `tests/*.yaml` 줄
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/coding-agent-relay-survey.md`의 1.1, 1.2, 2(설계 2, 3, 4, 5), 3(contract), 5. 이 brief가 survey와 다르면 이 brief가 맞다(README "정한 것")
  - architecture: `project-docs/architecture/harness-gui.md`(불변식 2: handle id와 session id, 4: `tab-current`, 6: CLI session은 한 process만), `acp.md`, `terminal-agent.md`, `event.md`
  - `mobile-host-link`가 낸 것: `packages/protocol/host-link/frames.ts`(frame과 요청 종류), `ctx.hostLink`(`onFrame`, `onOpen`, `onClose`), queue의 `callCoding`
  - 본보기: `packages/core/main/daemon/wiring/acp.ts`(`snapshot`, `publishUpdates`, `redactDeep`, `acpSend` 등록 자리), `acp-send.ts`(입력을 ledger route로 옮기는 자리), `session-lifecycle.ts`(wiring)와 `core/lophn-agent/session/lifecycle.ts`(`reportTerminals`, `sweep`, `ATTACHED_MS` 뒤 비우기), `packages/protocol/acp/reduce.ts`의 `reduceAcp`
  - 같은 계획의 다른 task: `mobile-coding-shell`(shell main 쪽)이 이 task의 frame 쓰임새를 보낸다. frame 모양은 `mobile-host-link` brief가 정했고 그대로다
  - 다른 계획: `project-docs/plan/mobile-push/tasks/mobile-attention-core.md`가 `wiring/session-lifecycle.ts`를 읽고 `terminal_sessions/signal`을 `protocol/attention/`에 짓는다. 이 task의 `report` 칸 추가(`view`, `handoff`, `foreground`)와 겹치지 않는다
- 계약:
  - 쓰는 것: `hostFrameSchema`의 `coding_report`, `coding_sync`, `coding_closed`와 요청 `coding_input`, `coding_switch`(wave 1이 정했다), `reduceAcp`
  - 내놓는 것(뒤 task들이 기댄다):
    - `TerminalSessionReport`(`session-lifecycle.ts`)에 칸 셋: `view: "gui"|"tui"`, `handoff: "restart"|"shared"|null`(handle이 없으면 null), `foreground: boolean`(그 터미널의 foreground가 coding agent TUI인가). `SessionInfo.terminal`에는 더하지 않는다(앱 목록이 보지 않는다)
    - session id helper: `guiSessionId(terminalRef: string): string`(`ses_<ULID>`)을 `packages/protocol/lophn-agent/session-tag.ts`로 옮긴다. renderer의 `model.ts`가 지니고 있던 것이다. renderer는 그것을 import한다(옛 정의는 지운다)
    - route(`packages/protocol/coding-agent/relay.ts`, 모두 actor `user`, 모두 memory 기반, ledger 없음. 오류 code는 `invalid_input|not_found|forbidden|unauthorized|conflict|unavailable`만):
      - `coding_sessions/list` read `{project?: prj}` -> `{shell: "attached"|"absent", sessions: CodingSession[]}`. `CodingSession = {session: ses, terminal: string, harness: string, label: string, project: prj, cwd: string|null, title: string|null, state: "running"|"waiting"|"idle"|"unknown", view: "gui"|"tui", handoff: "restart"|"shared"|null, cli_session: string|null, last_active_at: string|null, switch: null | {blocked: "no_session"|"not_running"|"extension_off"|"unsupported_os"}}`. shell이 없거나 보고가 비면 `sessions: []`. 이름이 `read`라서 `coding_sessions`가 바뀌면 `StateChanged{coding_sessions}`가 나간다
      - `coding_sessions/switch_plan` read `{session: ses}` -> `{to: "gui"|"tui", stops: {turn: boolean, tasks: number, queued: number}, blocked: null | "no_session"|"not_running"|"unsupported_os"}`. `view`가 tui면 to는 gui(`turn`은 보고의 state가 running, `tasks`와 `queued`는 0), gui면 to는 tui(사본 상태의 도는 turn, running task 수, queued 수)
      - `coding_sessions/switch` memory `{session: ses, to: "gui"|"tui", confirmed: z.literal(true), key: string}` -> `{ok: true}`. `confirmed`가 `true`가 아니면 입력 검사에서 `invalid_input`이고 host 요청은 나가지 않는다. 이미 그 view면 `conflict`, host가 없거나 연결이 닫혔으면 `unavailable`, session이 없으면 `not_found`, `coding_switch`의 error는 그 code 그대로(`details.reason` 유지). 성공하면 `StateChanged{coding_sessions}`. 같은 `key`를 다시 보내면 한 번만 보낸다
    - 서비스 `ctx.codingRelay`(다른 wiring이 쓴다): `list(project?): CodingSession[]`(표와 사본에서 만든 줄. route의 `sessions`와 같은 것), `terminalKnown(terminalRef: string): boolean`(그 터미널이 지금 목록에 있는가), `onChange(listener)`(목록이 바뀌었다. 터미널이 목록에서 빠지는 것 포함). `mobile-terminal-core`가 쓴다
    - 기존 route의 분기: `acp/snapshot {session}`은 사본이 있으면 그 `AcpState`(redaction을 거친 것)를, `acp/send`는 사본이 있는 session이면 입력 전체를 `coding_input`으로 host에 보내고 답을 그대로 올린다(handle 없음 `not_found`, 연결 없음 `unavailable`). 사본이 없고 ledger에도 없으면 지금처럼 `not_found`
    - event: relay가 받은 `updates`는 하나씩 그대로 `AcpUpdated {session, update}`로 Bus에 낸다. 새 `snapshot`이 사본을 갈아 끼우면 `StateChanged{coding_sessions, id: session}`을 낸다(폰이 다시 읽는다)

## 할 일

1. `packages/protocol/coding-agent/relay.ts`에 위 route와 `CodingSession`을 쓴다(`defineRead`, `defineMemory`). `registry.ts`·`mod.ts`에 한 줄씩. `changes.ts`에 `coding_sessions`.
2. `session-lifecycle.ts`(protocol)에서 report schema에 세 칸을 필수로 더한다. 보내는 쪽은 `mobile-coding-shell`이 고친다(그 사이 옛 route `terminal_sessions/report`를 부르는 shell 코드는 schema에 안 맞지만 shell을 띄우지 않는 wave 3까지는 문제가 아니다. cleanup이 그 route를 지운다). `lifecycle.ts`가 `coding_report` frame의 목록을 `reportTerminals`로 받게 이어 주고 `lifecycle_test.ts`를 맞춘다. 연결이 닫히면 `ATTACHED_MS`(3초) 유예 뒤 표를 비우는 규칙을 `ctx.hostLink.onClose`에도 건다(`host/take` heartbeat에만 걸려 있던 것).
3. `guiSessionId`를 `session-tag.ts`로 옮기고 `model.ts`의 정의를 지우고 importer(`terminal-gui.tsx`, `model_test.ts`)를 고친다.
4. `packages/core/coding-relay`: 사본 표(`ses` -> `{terminal_ref, state: AcpState, keys}`), 최대 64 session(넘으면 가장 오래 안 쓴 것부터 버린다), `coding_sync`를 받으면 `snapshot`은 갈아 끼우고 `updates`는 `reduceAcp`로 접는다. 접기 전에 relay가 snapshot과 update를 제품 redactor(`redactDeep`, `acp.ts`의 `env.redact`와 같은 것)로 거른다. `coding_closed`와 연결 닫힘(유예 뒤)이면 지운다(지울 때 `StateChanged`). keyed 입력(`send.id`와 `key`, `stop.key`, `set_model.key`처럼 `key`가 있는 `AcpInput`)은 session마다 200개 기억한 key를 다시 받으면 host에 보내지 않고 성공으로 답한다(adapter가 key를 거르지 않고 폰은 재접속 뒤 다시 보낸다). 상태가 바뀌는 입력의 결과는 host가 `coding_sync`로 올리므로 core는 입력을 사본에 적용하지 않는다.
5. `wiring/coding-relay.ts`(`ctx.codingRelay`)와 `wiring/acp.ts`·`acp-send.ts`의 분기: `snapshot`과 `send`가 `ctx.codingRelay.has(session)`이면 위 계약대로 한다. 승인 card의 `decide`는 `AcpInput`의 `decide`로 host에 간다(core의 `turn_requests`는 건드리지 않는다). `coding_sessions/*` handler는 list를 `reportTerminals`의 표와 사본으로 만든다(`view`, `handoff`는 보고에서, 사본이 있으면 `state`는 사본의 turn과 pending으로 덮는다).
6. `tools/fake-coding-host.ts`: 개발 core(`npm run dev:core`가 뜬 `.dev-data`)에 사람 자격으로 붙어 `/host-link`를 열고(`tools/remote-dev.ts`가 `controlConnect`로 자격을 얻는 길을 본다), canned coding session 둘(`view: "gui"`로 승인 card와 도는 turn이 있는 Claude Code, `view: "tui"`인 Codex)을 `coding_report`와 `coding_sync`로 올리고, `coding_input`을 받으면 알맞은 `updates`로 답하고(`send`는 글 하나를 더하고, `decide`는 card를 닫는다), `coding_switch`를 받으면 view를 바꿔 다시 올린다. 폰과 core 개발에서 실제 shell main 대신 쓴다. root `package.json`의 `dev:coding-host` script는 lead가 더한다(보고에 한 줄).
7. flows catalog와 test.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "relay가 접은 snapshot과 `AcpUpdated` payload에는 vault의 알려진 secret이 없다(tool `body`와 메시지 글 안의 secret을 가린다)"
  - "`coding_sessions/switch`는 `confirmed: true` 없이는 `invalid_input`이고 host에 요청이 나가지 않으며, agent 자격의 호출은 `forbidden`이다"
  - "같은 `id`·`key`의 `send`를 다시 보내도 host에는 한 번만 간다"
  - "연결이 닫히면 유예 뒤 목록이 비고, 사본이 없는 session의 `acp/send`는 `unavailable`이나 `not_found`이며 진행 중이던 `coding_switch`는 실패로 끝난다"
- 남지 않음: `grep -rn "function guiSessionId" packages`가 `session-tag.ts` 하나다.
- 확인: `npm run dev:core`와 `tools/fake-coding-host.ts`로 사람 자격 client(`tools/remote-client.ts`나 `lophn` CLI의 control 길)가 `coding_sessions/list`, `acp/snapshot`, `acp/send`(`decide`)를 부르고 결과가 맞는지 한 번 본다. 끝나면 띄운 process를 모두 정리한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 새 route 입력·출력 예, 사본 표의 상한과 버리는 규칙, fake host의 사용법, 확인한 것과 못 한 것, lead가 flows와 `harness-gui.md`·`acp.md`에서 고칠 것, `PRODUCT`와 어긋난 곳.
