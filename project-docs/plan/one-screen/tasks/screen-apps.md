# screen-apps

다른 기계의 앱 화면(탭의 앱 화면, 앱 panel)을 이 컴퓨터의 창이 그린다. 화면 file은 그 기계의 core가 주고, view binding과 앱에 시키는 것은 그 기계로 가며, 격리 자리(partition)와 origin에 기계가 들어 같은 앱 id라도 기계가 다르면 저장소가 섞이지 않는다. 폰이 이미 같은 길(`app_views/*`, `apps/screen_file`)로 화면을 받는다. 앱 preview와 App details는 지금처럼 이 컴퓨터의 것만 연다.

- 단위: screen (wave 2)
- 선행: screen-base-core, screen-base-scope.
- 소유(이 task만 고친다):
  - `packages/shell/main/app-frame/`, `packages/shell/main/desktop/wiring/{app-views,app-calls}.ts`
  - `packages/shell/ipc/{app,app-frame,app-agent,app-agents,app-projects,app-sessions}.ts`, `packages/shell/preload/{app,app-tool,views-api}.ts`
  - `packages/shell/renderer/app-frame/`(`machine-deps.ts` 포함), `packages/shell/renderer/workspace/kinds/{app-screen,app-panel}.tsx`
  - `tools/wireframes/pages/screens/app-space.tsx`, `tools/wireframes/pages/screens/app-space/`
  - `packages/design/i18n/catalog/app-space.ts`
  - `project-docs/flows/areas/{app-runtime,app-surface}.yaml`, `project-docs/architecture/app-call.md`
- 읽을 것:
  - 계획 README "정한 것 › 열리는 것"의 앱 화면, "같은 앱은 한 줄이다"
  - architecture: `project-docs/architecture/app-call.md`(view binding, partition, `AppRemoved`), `phone-screen.md`(폰이 view를 묶고 화면 file을 받는 길), `workspace-layout.md` "`<webview>` 그릇과 층 순서", `remote.md`(기기 route 목록)
  - 조사 `reports/multi-device/survey-n1-one-screen.md` G6, 부록 A "App screen", 부록 C의 앱 줄, 8 "Not determined"의 처음 셋
  - 지금 code: `packages/shell/main/app-frame/session-policy.ts`(`appPartition`, `appHostLabel`), `app-protocol.ts`, `binding.ts`, `app-connection.ts`(CSP host), `packages/shell/main/desktop/wiring/app-views.ts`(`createCoreUpstream`, `coreInternal`의 `app_views/open`), `packages/protocol/apps/views.ts`, `packages/core/apps/views/mod.ts`, renderer `app-frame/app-views.tsx`(`coreAppRead`, `coreAppScreens`)
- 계약:
  - 쓰는 것: `machineAppViews`(screen-base-scope가 만든 자리), `useMachineData`, `TabScope`, `TabItem.machine`, `ctx.machines`(screen-base-core)의 `link(machine)`·`watch(machine, owner, conditions)`·`onFrame`(shell main 안의 구독자. owner `app-views`)
  - 내놓는 것: `machineAppViews(machine, …)`가 다른 기계에도 `AppViewsDeps`를 준다(그러면 `workspace-window.tsx`의 앱 화면 갈래가 screen-base-scope 규칙대로 열린다).

## 할 일

1. **먼저 알아낸다(조사가 정하지 못한 것).** code를 열어 답하고 보고에 적는다.
   - (a) 이 컴퓨터의 창이 다른 기계 앱의 탭·panel 화면 목록을 무엇으로 읽나: `apps/list`·`apps/get`의 답에 선언의 화면과 자리(tab, panel)가 오는지. `apps/phone_screens`는 phone 자리만 준다.
   - (b) 기기 owner(`device:<이 컴퓨터>`)의 `app_views/open`이 `place: tab|panel`을 받는지(`packages/core/apps/views/`의 open과 table).
   - (c) CSP의 fetch host(`app-connection.ts`)를 다른 기계에서 어떻게 얻나: `apps/tools`는 기기 route이고 `app_grants/list`는 아니다.
   - (d) `AppViewChanged`, `AppRemoved`가 기기 event가 아닐 때 다른 기계의 view가 다시 묶이거나 닫히는 길(폰은 `StateChanged`에 다시 읽는다).
   - 답이 이미 있는 route를 기기 목록에 더하는 것이면 "등록할 것"에 적는다(`packages/protocol/remote/allowlist.ts`는 lead가 고친다). 새 route나 route 모양을 바꿔야 하면 고치지 말고 "계약 바꾸기 요청"에 모양과 이유를 적고, 그것에 기대지 않는 나머지를 끝낸다.
2. **격리 자리(이 task가 갖는 규칙).** 이 컴퓨터의 앱은 지금 그대로다(`persist:app-<app>:live`, host `app-<ulid>`: 사람의 앱 저장소를 그대로 지킨다). 다른 기계의 앱 화면은 partition `persist:app-<app>:machine-<mch ULID>`, host label `app-<app ULID>-<mch ULID>`(소문자, 63자 안)다. `appPartition`·`appHostLabel`이 기계를 받고, protocol handler와 network 판정이 host에서 기계를 다시 읽는다.
3. **main.** view를 열 때 기계가 있으면: binding은 그 기계의 `machines/call app_views/open`(owner는 그 기계가 보는 이 컴퓨터), 화면 file upstream은 `machines/call apps/screen_file`(file 답은 base64, 8 MiB 상한), 앱 호출(`app:call-operation` 등 앱 preload IPC)은 그 view의 기계로 간다. 받는 기계의 기기 목록에 없는 것은 그 기계가 `forbidden`으로 거절하고 view에 그 오류를 돌려준다(화면이 숨기지 않는다). `AppViewEvent`는 shell main의 구독자 `app-views`로 그 기계에 걸어 받는다. link가 끊기면 그 기계가 view를 닫으므로(`host.ts`의 `closeOwner`) 다시 붙으면 다시 묶는다.
4. **renderer.** `machine-deps.ts`가 다른 기계에 `AppViewsDeps`를 짓는다(`app`·`screens`·`icon`은 그 기계의 core, `views`는 기계를 실은 shell 통로, `enableRun`은 없다: App details는 이 컴퓨터만). `kinds/app-screen.tsx`·`app-panel.tsx`는 탭의 기계 묶음(`host.machineData(tab.machine ?? host.machine)`)을 쓰고 `thisComputerOnly`를 지운다. 이 기계에 그 앱이 있으면 이 기계의 것을 연다(README "같은 앱은 한 줄").
5. wireframe 먼저(`ui-design` skill): `app-space.tsx`에 `app-screen-other-machine`(탭 머리 줄의 기계 꼬리표), `app-screen-other-machine-offline`(그 기계가 꺼짐)을 더한다. 앱 화면 자리는 지금처럼 고정 그림이다. 글은 `app-space.ts`.
6. 문서와 flows: `app-call.md`에 다른 기계의 view(binding owner, partition·origin 규칙, 거절이 오는 곳). flows `app-runtime.yaml`·`app-surface.yaml`의 view 열기·호출 줄(`flows` skill).

### 정한 것
- 다른 기계의 앱은 live 화면만 연다: preview와 App details는 개발과 관리라 README 범위 밖(이 컴퓨터만)이다.
- 이 컴퓨터의 partition 이름은 바꾸지 않는다: 바꾸면 사람의 앱 cookie·storage를 옮기는 step이 필요하다.

## 끝남

- `npm run check`가 통과한다. `npm run wireframes`가 되고 gallery의 `app-screen-other-machine`, `app-screen-other-machine-offline`이 renderer component로 그려진다. `node packages/shell/renderer/build.ts`가 선다.
- 위험 test(`packages/shell/main/app-frame/registry_test.ts`에 더한다. 새 test file을 만들지 않는다): "같은 앱 id의 view를 이 컴퓨터, 기계 A, 기계 B에서 열면 세 view의 partition과 origin이 모두 다르고, 기계 A의 view가 부른 앱 호출은 A의 link로만 간다."
- 진짜 Electron에서 view가 뜨는지는 lead가 본다(gallery는 열기 검사를 건너뛴다). browser를 띄우는 test와 E2E는 만들지 않는다.
- 남지 않음: `grep -n "thisComputerOnly" packages/shell/renderer/workspace/kinds/{app-screen,app-panel}.tsx`가 0줄이다.

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
