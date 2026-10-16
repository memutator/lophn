# screens-project-reactions

project 창을 data 층(대기 목록, toast)에 잇는다. 위쪽 바에 대기 pill과 panel을 꽂고, 보이는 동안 toast 행동 처리기를 등록한다. 권한 요청·허락 요청·질문·앱 재시작 멈춤 toast의 [Review]·[Open session]이 이 창에서 동작하고, 계약 위반 toast는 눌러야만 그 project의 Project Manager session으로 간다(reaction이 이미 연 session이 있으면 그 session, 꺼져 있으면 위반을 붙여 새로 연다). 대기 목록의 coding 물음 카드는 그 session의 터미널 탭으로 focus를 옮긴다.

- 단위: screens-project (wave 3)
- 선행: screens-project-window (`workspace.tsx`, `kinds/host.ts`의 새 모양), screens-data-waiting (`WaitingLayer`, `useWaitingPanel`), screens-data-toast (`registerToastActionHandler`), screens-project-terminal (`focusSession`)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/workspace.tsx`의 위쪽 바 slot과 처리기 등록 부분(window task가 끝난 뒤이므로 이 task가 고친다)
  - `packages/shell/renderer/workspace/kinds/agent.tsx`의 `openAgent`와 chip 전달
  - `packages/shell/renderer/workspace/reactions/` (새로: toast 처리기와 Project Manager 열기)
  - `packages/design/wording/catalog/project.ts`와 생성물 `catalog/project.placeholders.ts` (wording-split이 만든 영역 file. ownership.md에 없어 추가 소유, lead 승인 2026-10-16)
- 읽을 것:
  - spec: S1 8장(반응 표: `ContextViolationFound` → toast, 누르면 reaction이 이미 연 Project Manager session으로, 꺼져 있으면 그때 위반을 붙여 새로 연다; coding agent의 `PermissionRequested`는 터미널 탭으로 focus) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - spec: S6 2장 5 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/coding-agent.md`
  - inventory: `U2.1#3`(대기 개수 pill: 이 창에서 센다), `U3.1#9`(toast 문구와 "눌러서 agent 부르기": 문구 key는 screens-data-toast가 만들었고 이 task는 눌렀을 때 동작), `U2.3#1`(계약 위반 toast: 이 창이 overlay toast로 받는다. 옛 `contexts/violation-toast.tsx`와 inline toast는 window task와 screens-contexts가 걷는다), `U6.1#1`
  - 결정: `../README.md` 3장 #57(`project_manager`)
  - 지금 코드: `workspace/workspace.tsx`(`SpaceDecisions`를 쓰던 줄, `openRole("context_engineer", chips)`), `workspace/kinds/agent.tsx`(`openAgent`, 새 session을 가진 Agent 탭 열기, `chips`·`hint` 탭 필드), `workspace/agent/tab-fields.ts`(`chipsOf`, `hintOf`)
  - 본보기(화면): `tools/wireframes/frames/compositions/contexts/violation-toast.tsx`·`pm-session.tsx`(위반을 붙인 Project Manager 대화), `compositions/waiting/waiting-pages.tsx`(`over()`: 위쪽 바에 대기 층을 꽂는 모양)
- 계약:
  - 쓰는 것:
    - `WaitingLayer`, `useWaitingPanel` (screens-data-waiting), `registerToastActionHandler`, `ToastAction` (screens-data-toast), `useSessions`, `useWaiting` (screens-data-events), `TerminalStore.focusSession` (screens-project-terminal)
    - ui-chrome의 `TopBar` slot(`desktop/top-bar`)
    - `ContextViolationFound` payload(`project`, `context`, `check`): contract-events. 위반의 파일과 규칙은 context 위반 읽기(contract-calls-places)로 읽는다
  - 내놓는 것: 없음. 이 창이 보일 때 다음이 동작한다.
    - 위쪽 바 오른쪽 slot에 `WaitingLayer`
    - toast 행동 `waiting` → panel 열기, `session` → 이 project의 session이면 그 Agent 탭을 열고(이미 열려 있으면 그 탭을 고르고) 다른 project의 것이면 처리하지 않고 `false`를 돌려 기본 처리기가 다른 화면으로 가게 한다, `project-manager` → 아래 2번

## 할 일

1. 위쪽 바에 대기 pill과 panel을 꽂는다. 옛 `SpaceDecisions`/`WaitingPill`(`desktop/notification-chip/space-decisions.tsx`)를 걷고 `WaitingLayer`를 ui-chrome `TopBar`의 오른쪽 slot에 넘긴다. 이 project의 것만 세는 것이 아니라 모든 session의 대기 요청을 센다(대기 목록은 한 목록). core 끊김 안내(`ConnectionNotice`)는 그대로다. callback: `onOpenSession(session)`은 그 session의 Agent 탭을 연다(다른 project의 session이면 Workspace 라우터로 간다: 기본 처리기가 한다), `onAnswerInTerminal(session)`은 `TerminalStore.focusSession(session)`을 부른다. 근거: `U2.1#3`, S1 8장.
2. toast 행동 처리기를 등록한다. 이 창이 마운트된 동안 `registerToastActionHandler`로 처리기 하나를 등록하고 해제한다(`workspace/reactions/toast-handler.ts`). 근거: `U3.1#9`.
   - `{ kind: "waiting" }` → `useWaitingPanel().setOpen(true)`
   - `{ kind: "session", session, app? }` → `session`이 있고 이 project의 session이면 Agent 탭을 연다. `session`이 `null`이고 `app`이 있으면 그 앱의 App Engineer 열린 session을 `useSessions`에서 찾아 연다(앱 공간으로 가는 일은 기본 처리기 몫이므로 이 창에서 못 열면 `false`). 아니면 `false`.
   - `{ kind: "project-manager", project, context, check }` → 이 project이면 `openProjectManager`. 아니면 `false`.
3. `openProjectManager`(`workspace/reactions/project-manager.ts`). 이 project의 Project Manager session 가운데 그 위반의 reaction이 연 것(열려 있고 archive되지 않은 것. `useSessions`의 열린 session 가운데 시작 근거가 그 `check`의 domain event seq인 것)이 있으면 그 session의 Agent 탭을 열고 고른다. 없으면(reaction이 꺼져 있었거나 그 session이 닫혔다) 위반(`check`로 읽은 파일과 어긴 규칙)을 context chip으로 붙인 새 session 탭을 연다. 사람이 글을 쓰지 않아도 열리고 아무것도 보내지 않는다. 열기는 `kinds/agent.tsx`의 `openAgent`에 chips를 실어 넘기는 기존 방식을 쓴다(`chipsOf`/`hintOf`). 근거: `U2.3#1`, S1 8장.
4. 옛 toast 장치가 이 창에 남지 않았는지 확인하고 남은 것을 지운다. window task가 걷은 inline `ViolationToast`·`toasts` state 외에 `[Ask Context Engineer]` 호출부가 있으면 지운다.
5. 문구가 필요하면 wording key를 쓴다(영역 `project-workspace`: 대기 pill 접근성 이름 등. toast 문구는 `waiting.toast-*`).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (연결과 열기)
- 남지 않음: `grep -rn "SpaceDecisions\|WaitingPill\|ViolationToast\|openRole(\"context_engineer\"" packages/shell/renderer/workspace/workspace.tsx packages/shell/renderer/workspace/kinds`가 0줄이다.
- (화면) gallery page는 고치지 않는다(`new-waiting-toasts`는 screens-data-toast, `new-violation-toast`는 screens-contexts 소유). 이 task는 `deno task dev:mock`으로 위 연결이 실제 `Workspace`에서 동작하는지 손으로 본다.

## 보고

- 바꾼 file
- 등록할 것: `desktop/main.tsx`(screens-workspace)가 기본 toast 처리기와 `ToastHost`를 마운트하는지 lead가 확인. app space(`screens-app-space`)도 같은 방식으로 `WaitingLayer`와 처리기를 꽂아야 한다.
- 안 쓰게 된 export: `desktop/notification-chip/space-decisions.tsx`의 `SpaceDecisions`·`WaitingPill`·`useRequestOverview`(app space와 launcher가 갈아탄 뒤 cleanup이 지운다)
- 정한 것: reaction이 연 Project Manager session을 찾는 기준(위반 근거 seq가 session 정보에 있는지. 없으면 가장 최근 열린 Project Manager session), 다른 project의 toast를 이 창이 처리하지 않는 것
- 계약 바꾸기 요청(wave 3): `SessionEntry`에 reaction의 근거 seq가 없으면 여기 적는다
