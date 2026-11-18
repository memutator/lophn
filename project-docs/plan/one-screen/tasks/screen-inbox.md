# screen-inbox

다른 기계의 승인 대기, 질문, 끝난 turn, 앱의 동의·공유 요청이 이 컴퓨터의 Inbox와 알림(toast, OS 알림)에 기계 꼬리표를 달고 한데 뜬다. 읽음과 "보고 있음"(presence)은 지금처럼 그 기계에 알린다. `core-setup`이 다른 기계의 창에 열었던 Settings 항목은 Settings 안에서 기계를 골라 연다.

- 단위: screen (wave 3)
- 선행: screen-lists.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/connection/`(`waiting/`, `toasts/`, `events/{waiting-store,unseen-store}.ts`)
  - `packages/shell/renderer/workspace/kinds/inbox.tsx`, `packages/shell/renderer/desktop/settings/{settings-space.tsx,settings-screen.tsx,model.ts}`, `packages/shell/renderer/desktop/machines/context.tsx`
  - `packages/shell/main/desktop/wiring/notice.ts`, `packages/shell/main/notice/`, `packages/shell/ipc/notice.ts`, `packages/shell/preload/notice-api.ts`
  - `tools/wireframes/pages/screens/{overlays,settings}.tsx`
  - `packages/design/i18n/catalog/{data,workspace-settings}.ts`
  - `project-docs/flows/areas/sessions.yaml`, `project-docs/architecture/attention.md`
- 읽을 것:
  - 계획 README "정한 것 › 저장과 알림"의 Inbox와 Settings
  - architecture: `project-docs/architecture/attention.md`(presence, unseen, 기기 kind computer의 보고), `remote.md`(screen-base-scope 초안, 구독자는 screen-base-core), `settings.md`
  - 조사 `reports/multi-device/survey-n1-one-screen.md` G9, 2.4 표의 Inbox·unseen 줄, 부록 B의 Inbox id(activation id = release, share id = app)
  - review `reports/multi-device/review-core-setup.md` "Facts the next plans build on"(`MACHINE_PANES`, `useMachineGrant`, 보호 secret 창)
  - 지금 code: `events/waiting-store.ts`(`:56-66` 항목 id), `waiting/waiting-panel.tsx`, `toasts/toast-host.tsx`, `shell/main/notice/presence.ts`, `wiring/notice.ts`, `settings/model.ts`의 `MACHINE_PANES`
- 계약:
  - 쓰는 것: `useMachineData(m).stores.waiting`·`.stores.unseen`, `OnMachine<T>`, `MachineData.settings`·`settingsPanels`·`grant()`(screen-base-scope), `ctx.machines`(screen-base-core)의 `watch(machine, owner, conditions)`·`onFrame`·`link`, 보호 secret 창 열기의 `machine`(screen-base-core)
  - 내놓는 것: 없음

## 할 일

1. wireframe 먼저(`ui-design` skill): `overlays.tsx`의 `overlay-inbox`·`inbox-tab`에 다른 기계의 줄(기계 꼬리표)과 꺼진 기계 한 줄을 그리는 page `overlay-inbox-machines`, `inbox-tab-machines`를 더한다. `settings.tsx`에 `settings-machine-picker`(Settings 머리의 기계 고르기, 다른 기계를 고르면 `MACHINE_PANES`만 서고 나머지 항목은 "이 컴퓨터의 설정" 한 줄), `settings-machine-no-grant`(허락 없음)를 더한다. `screen-lists`가 지운 `shell-machine-settings*`·`shell-machine-sign-in`의 상태를 이 page로 옮긴다.
2. **Inbox.** 기계마다의 `WaitingState`를 `OnMachine`으로 합친 목록을 Inbox overlay·탭·sidebar 배지가 쓴다. 합친 목록의 항목 key는 `<machine>:<id>`다(activation id와 share id가 기계를 건너 같은 앱 id로 겹친다. 이 task가 갖는 규칙). 결정(승인, 답, 동의)은 그 항목의 기계 범위의 source로 부른다. 꺼진 기계의 항목은 마지막으로 본 채 흐리게 남고 결정 단추가 없다.
3. **읽음.** 못 본 끝(`unseen`)은 기계마다의 store 그대로이고, 지우기(`unseen/dismiss`)는 그 기계로 간다.
4. **toast와 OS 알림.** renderer toast는 기계마다의 event client를 듣는다(`toast-host.tsx`). OS 알림: shell main의 `notice.ts`가 `ctx.machines.watch(machine, "notice", <지금 이 컴퓨터에 거는 알림 조건>)`로 기계마다 걸고 `onFrame`으로 받아 같은 규칙(`shell/main/notice/rule.ts`)으로 띄운다. 알림 글에 기계 이름이 붙고, 누르면 그 기계의 session을 연다(`Route.machine`). 알림에 필요한 event가 기기 event 목록에 없으면(예: 터미널 coding agent의 `TerminalAgentSignaled`) "등록할 것"에 적는다(lead).
5. **presence.** 창이 보이는 session을 알리는 `shell:notice-visible`에 `machine`을 싣는다. `presence.ts`가 기계마다 보고를 지어 그 기계에는 `machines/call presence/report`로(받는 기계는 kind computer 기기로 본다), 이 컴퓨터에는 지금처럼 보낸다. 30초마다, focus가 바뀔 때, link가 다시 ready일 때 보낸다. 창이 닫히면 기계마다 비운 보고를 한 번 보낸다. 기계 창이 하던 presence(`wiring/machine-windows.ts`)는 같은 wave의 `screen-windows`가 지운다. 그 file은 고치지 않는다.
6. **Settings.** `settings-space.tsx`의 기계 갈래(`useWindowMachine`)를 Settings 안의 기계 고르기로 바꾼다. 고른 기계의 `MachineData.settings`·`settingsPanels`를 쓰고, 허락은 그 묶음의 `grant()`로 항목을 열 때마다 다시 묻는다(`useMachineGrant` in `context.tsx`). provider key는 보호 secret 창을 그 기계로 연다.
7. 글은 `data.ts`(Inbox), `workspace-settings.ts`(Settings)의 key. `attention.md`의 presence 절("다른 기계의 창"을 "이 창이 기계마다 보고한다"로)과 flows `sessions.yaml`(Inbox)을 고친다(`flows` skill). `shell-desktop.yaml`·`ipc.yaml`(알림, presence, `shell:notice-visible`의 `machine`)은 같은 wave의 `screen-windows`가 가지므로 바꿀 줄을 "넘길 줄"에 적는다.

### 정한 것
- OS 알림은 shell main의 구독자 하나(`notice`)로 받는다: 창이 없어도 떠야 하고, renderer 구독과 서로 덮지 않는다(screen-base-core의 구독자들의 합).
- Inbox 항목 key에 기계를 붙인다: 같은 앱의 동의 요청이 두 기계에서 하나로 접히지 않는다.

## 끝남

- `npm run check`가 통과한다. `npm run wireframes`가 되고 gallery의 `overlay-inbox-machines`, `inbox-tab-machines`, `settings-machine-picker`, `settings-machine-no-grant`가 renderer component로 그려진다. `node packages/shell/renderer/build.ts`가 선다. `waiting-store.ts`를 폰이 import하므로 `cd packages/mobile && npm ci && npm run typecheck && npm test`도 통과한다.
- 위험 test: 없음(결정은 그 기계 범위의 source로 가고, 그 길은 screen-base-core의 위험 test가 지킨다). 합친 Inbox의 key 규칙은 `waiting-store_test.ts`에 한 줄 더해도 된다.
- 남지 않음: `grep -rn "useWindowMachine" packages/shell/renderer/desktop/settings packages/shell/renderer/desktop/connection`이 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
