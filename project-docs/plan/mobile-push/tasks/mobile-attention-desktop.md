# mobile-attention-desktop

desktop(shell main과 renderer)을 core의 주의 모양에 붙인다: shell main이 창 focus, 마지막 입력 뒤 시간, 보고 있는 session을 core에 보고하고(`presence/report`), 터미널 coding agent의 대기·끝을 tracker가 core에 알리고(`terminal_sessions/signal`), `unseen` 점은 core가 정본이 되어 renderer가 core에서 읽는다. shell main의 `unseen` 목록과 그 IPC를 지운다. desktop의 toast와 OS 알림을 가르는 정책(`routeNotice`, `looking`)은 shell에 그대로 둔다.

- 단위: mobile-attention (wave 2)
- 선행: mobile-attention-core
- 소유(이 task만 고친다):
  - `packages/shell/main/notice`
  - `packages/shell/main/desktop/wiring/notice.ts`
  - `packages/shell/main/desktop/wiring/agent.ts`
  - `packages/shell/main/desktop/core/allowlist.ts`
  - `packages/shell/main/terminal/agent/tracker.ts`
  - `packages/shell/main/terminal/agent/agent_test.ts`
  - `packages/shell/ipc/notice.ts`
  - `packages/shell/ipc/terminal.ts`
  - `packages/shell/preload/notice-api.ts`
  - `packages/shell/renderer/desktop/connection/events`
  - `packages/shell/renderer/desktop/connection/waiting`
  - `packages/shell/renderer/parts/agent-session`
  - `packages/shell/renderer/terminal`
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/push-survey.md`의 1.2(지금의 notice 길), 2.4(desktop 변경)
  - architecture: `project-docs/architecture/app-notice.md`, `terminal-agent.md`
  - 이 task가 쓰는 core 계약: `packages/protocol/attention/`(`mobile-attention-core`가 만든 route 넷)와 그 brief `project-docs/plan/mobile-push/tasks/mobile-attention-core.md`의 "내놓는 것"
  - 지금 `unseen`이 흐르는 곳: `packages/shell/main/notice/rule.ts`(`createSessionNotices`), `wiring/notice.ts`(`publishUnseen`, `looking`, `NOTICE_DISMISS_CHANNEL` handler), `tracker.ts`(`unseen` 칸, `reconcile`, `notify`), `ipc/notice.ts`(`UnseenSession`, `LophnNoticeApi.unseen·onUnseen·dismiss`), renderer `events/sessions-store.ts`(`unseen`), `waiting/finished.ts`, `waiting/waiting-layer.tsx`(`dismiss`), `parts/agent-session/{lophn,coding}.ts`, `events/waiting-store.ts`(`agent.unseen`)
  - shell main이 core를 부르는 길: `wiring/agent.ts`의 `ctx.coreInternal("memory", "terminal_sessions", "report", …)`
- 계약:
  - 쓰는 것: `presence/report`, `terminal_sessions/signal`, `unseen/list`, `unseen/dismiss`, `StateChanged{unseen, id: sessionRef}`(모양은 `mobile-attention-core` brief)
  - 내놓는 것: 없음(밖으로 내놓는 계약이 없다). 사람이 보는 동작은 그대로다: 탭을 보면 점이 꺼지고, 못 본 끝은 Finished 줄로 남고, 폰에서 읽어도 꺼진다.

## 할 일

1. presence 보고(`packages/shell/main/notice/presence.ts` 새 file, `wiring/notice.ts`가 시작): `focused`는 lophn 창에 focus가 있는지(`wiring/notice.ts`의 `focusedWindow`), `idle_ms`는 Electron `powerMonitor.getSystemIdleTime() * 1000`, `looking`은 지금 보이는 session과 터미널의 sessionRef 목록(`looking`이 쓰는 표 `visibility`, `viewVisibility`, `TerminalFocusTable`에서. 터미널은 `terminalSessionId(terminal_ref)`)이다. 바뀔 때(창 focus·blur, `notice:visible`, 터미널 focus)와 30초마다 `ctx.coreInternal("memory", "presence", "report", …)`로 보낸다(`idle_ms`는 계속 바뀌므로 바뀜 판단에서 뺀다. 30초 주기는 늘 보낸다). headless(`ctx.headless.headless`)이면 보고하지 않는다. 실패는 다음 주기가 메운다.
2. tracker가 core에 알린다: `AgentTrackerDeps`에 `signal(info: { terminal_ref, harness, title, kind: "waiting" | "finished" | "failed", active_ms })`를 더하고, `tracker.ts`의 `notify`가 `deps.looking` 검사보다 앞에서(core가 정한다) 이미 있는 시점마다 부른다: 권한 물음(`PermissionRequested`)은 `waiting`, debounce(`FINISH_DELAY_MS`) 뒤의 끝은 `finished`·`failed`. `active_ms`는 turn이 running이 된 때부터 끝까지에서 그 사이 `waiting > 0`이던 시간을 뺀 것이고 모르면 null이다(칸 하나로 시작 시각, 하나로 기다린 합을 더한다). `wiring/agent.ts`가 `signal`을 `ctx.coreInternal("memory", "terminal_sessions", "signal", …)`로 잇는다(`title`은 `reportToCore`가 쓰는 값과 같게). `terminal_sessions/report`는 그대로 둔다.
3. `unseen`을 지운다: `createSessionNotices`의 `unseen` 목록과 `publish`, `recheck`, `dismiss`, `unseen()`(`rule.ts`)과 `wiring/notice.ts`의 `publishUnseen`, `NOTICE_DISMISS_CHANNEL` 처리(`dismissTerminal` 인자 포함), `NOTICE_UNSEEN_GET_CHANNEL`·`NOTICE_UNSEEN_CHANNEL`, `ipc/notice.ts`의 `UnseenSession`·`unseen`·`onUnseen`·`dismiss`, `preload/notice-api.ts`의 같은 것, tracker의 `unseen` 칸과 `TerminalAgent.unseen`(`ipc/terminal.ts`)과 `deps.looking`·`dismiss`로 하던 일을 지운다. toast와 OS 알림(`routeNotice`, `show`, `looking`)은 그대로 둔다. `rule_test.ts`는 `createSessionNotices`의 `unseen` test를 지우고 `routeNotice`와 `SessionVisibility` test는 남긴다.
4. renderer가 core에서 읽는다: `unseen/list`와 `StateChanged{unseen}`을 받는 store 하나를 `renderer/desktop/connection/events/`에 두고(기존 `sessions-store.ts`가 `notice.unseen()`을 읽던 자리를 그 store로 바꾼다), `waiting/finished.ts`(Finished 줄), `waiting/waiting-layer.tsx`(줄을 닫는 `dismiss` → `unseen/dismiss`), `parts/agent-session/{lophn,coding}.ts`(session 점. 터미널은 `term:<탭>`으로 찾는다), `events/waiting-store.ts`(탭 점)가 그것을 읽게 한다. core는 session 참조, kind, 시각만 가지므로 Finished 줄의 agent 이름, 얼굴, 제목은 renderer가 이미 아는 값(`sessions-store`의 session별 agent와 제목, 터미널 줄의 harness)에서 가져온다. `packages/shell/main/desktop/core/allowlist.ts`의 `RENDERER_MEMORY_ROUTES`에 `memory:unseen/list`, `memory:unseen/dismiss`를 더하고 위 주석 목록에 한 줄 쓴다.
5. 지운 IPC channel과 renderer가 호출하던 길의 흔적(fake source, test, `tools/wireframes`가 쓰는 fake)을 정리한다. `npm run dev`로 확인은 하지 않는다(shell을 띄우는 일이라 사람에게 묻는다). 대신 단위 test와 `npm run check`로 본다.

## 끝남

- `npm run check`가 통과한다. flows 단계가 지운 IPC channel(`notice:unseen` 등)과 새 route 호출 때문에 막으면 catalog를 맞춘다(`flows` skill).
- 위험 test: 없음(`tracker`의 기존 test를 새 `signal` 호출로 옮겨 "자식 틈에서는 finished를 내지 않고 debounce 뒤 한 번만 낸다"가 그대로 지켜지는지 본다. 새로 쓰는 test는 두지 않는다).
- 남지 않음: `grep -rn "NOTICE_UNSEEN\|UnseenSession\|onUnseen\|notice:unseen\|notice-unseen" packages tools tests`가 0줄이고 `grep -rn "unseen" packages/shell/main`에는 core의 `unseen`을 말하는 주석 말고 남은 목록·flag가 없다.

- flows catalog: 이 task가 더하거나 지우는 route, CLI 명령, IPC channel, test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 지운 IPC channel과 export 목록, presence 보고를 보내는 시점 목록, Finished 줄의 이름·얼굴·제목을 어디서 가져오게 했는지, core를 띄워 확인한 것과 못 한 것(shell을 띄우지 않았다면 그렇게 쓴다), lead가 고칠 목록(`flows`의 IPC·test file, `architecture/app-notice.md`·`terminal-agent.md`).
