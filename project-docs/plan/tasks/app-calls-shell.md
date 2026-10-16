# app-calls-shell

shell main의 앱 view 연결을 새 호출 모델로 바꾼다: 앱 페이지의 `lophnApp.call`이 core의 `app.call_api`를 부르고(서명 연결, proof, confirm 흐름 없음), 화면 byte는 core의 `app.screen_file`로 받고, 앱 view가 project를 갖는다. SDK `ui-action`에서 사람 확인(`confirm`) 표시를 걷고 이름을 app-api로 바꾼다.

- 단위: app-calls (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/app-frame/app-call.ts`
  - `packages/shell/main/app-frame/app-connection.ts`
  - `packages/shell/main/app-frame/app-invoke.ts` (지운다)
  - `packages/shell/main/app-frame/app-ipc.ts`
  - `packages/shell/main/app-frame/app-protocol.ts`
  - `packages/shell/main/app-frame/binding.ts`
  - `packages/shell/main/app-frame/blueprint-source.ts`
  - `packages/shell/main/app-frame/registry.ts`, `view-model.ts`, `view-ipc.ts`, `view-error.ts`, `visibility.ts`, `session-policy.ts`, `view-closed.ts` (이 일곱은 ownership.md상 screens-app-space 몫이지만 서명 연결 binding을 쓰는 file이라 이 task가 받는다. 보고의 "소유 바꾸기"에 적혀 있다)
  - `packages/shell/main/desktop/wiring/app-calls.ts` (shell-wiring이 만든 앱 호출 조립. `createAppCall`, `createAppConnector`, `registerAppIpc`, blueprint 읽기)
  - `packages/sdk/ui-action/`
- 읽을 것:
  - spec: S5 4장 표(앱 화면), 2·9장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): `I1.2#16`, `I1.5#4`(`view-closed.ts`), `I1.5#9`(`app-call.ts`의 confirm 분기, `use-command.ts`의 `CommandSpec.confirm`), `I2.5#18`(이름), `I2.5#27`, `I2.5#28`, `I2.9#7`(주석의 옛 요구·작업 번호), `I2.12#1`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/ui-inventory.md`): `U2.4#15`
  - 문맥(screens-app-space 몫): `U2.4#11`, `U2.4#12`, `U3.4#5`(project 고르기 화면)
  - 결정: `/home/pyosechang/projects/lophn/project-docs/plan/README.md` 3장 #8, #18
  - 지금 코드: 위 소유 file. `packages/shell/main/desktop/core/{client,routes,allowlist}.ts`(main이 core를 부르는 법. platform 소유라 읽기만 한다)
- 계약:
  - 쓰는 것: `protocol/apps/calls`의 `appCallApi`(입력 `{target, api, input?, project?, caller}`, 출력 `{invocation, outcome}`)·`appScreenFile`, `protocol/apps/blueprint/read.ts`의 `appAppApi`(blueprint 읽기), core 읽기 `app.runtime`(`appRuntime`)·`previews.get`(그대로), `shell/ipc/app-frame.ts`의 `project` 칸·`VIEW_PROJECT_CHANNEL`·`setViewProject`, `shell/ipc/annotation.ts`의 `AnnotateViewPort`(구현해서 내놓는다), 페이지 IPC `app:call`의 `{api, input}`(contract-app-calls-shell), `sdk/blueprint`의 새 `AppApiDeclaration`
  - 내놓는 것: 바뀐 `createAppCall`·`createAppConnector`·`createAppProtocolHandler`. 주입점(`deps`)이 바뀌므로 `wiring/app-calls.ts`를 이 task가 같이 맞춘다. `createAppProtocolHandler`를 조립하는 `wiring/app-views.ts`(screens-app-space 소유)가 따라가야 하면 바뀐 모양을 보고에 적는다.

## 할 일

### A. shell main

1. `app-connection.ts` — 연결 → 묶기 (`I2.5#28`)
   - `AppBinding`에서 `endpoint`, `authorization`, `expiresAtMs`를 뺀다: `{release, bundleHash, processNonce}`만 남긴다. `createAppConnector`의 `connect`는 core 읽기로 바꾼다: live는 `app.runtime` 관측(`release`, `bundle_hash`, `process_nonce`, `ready`)을, preview는 `previews.get`을 그대로 쓴다. `memory apps connect` 호출, 서명 envelope 검사(`checkConnectOutput`), 만료·갱신을 지운다. 요청한 release와 관측이 다르면 `conflict`.
   - `hosts(app, release)`(바깥 host 목록, CSP용)와 `Outcome`·`failure`·`CoreCaller`·`ConnectTarget` 이름은 다른 file(`placement.ts`, `external-link.ts`, `screen-test-host.ts`, `desktop/app-window*.ts`)이 import하므로 이름과 모양을 바꾸지 않는다. `ConnectTarget`에 `project: string | null`을 더한다.
2. `binding.ts`, `view-model.ts`, `registry.ts`, `session-policy.ts`, `visibility.ts`, `view-error.ts` — 서명 연결이 없는 binding에 맞춘다. 연결 갱신(`CONNECTION_RENEW_MS`, `expiresAtMs`)과 `sameConnection`의 endpoint 비교를 뺀다. view target에 `project`를 싣고 state push에 `project`를 채운다(`shell/ipc/app-frame.ts`의 칸). partition 이름은 지금대로(`appPartition`).
3. `view-ipc.ts`, `registry.ts` — `VIEW_PROJECT_CHANNEL`을 받는다: 입력 `{view_session, project | null}`, 그 view의 `project`를 바꾸고 state를 push하고 새 state를 돌려준다. 같은 view_session이 아니거나 모르는 view는 `forbidden`. 앱 열기 입력의 `project`(`I2.12#3` main 쪽)도 view에 묶는다.
3b. `registry.ts` — annotate가 쓰는 view 입구. `shell/ipc/annotation.ts`의 `AnnotateViewPort`를 구현해 registry에 `annotateView(view_session): AnnotateViewPort | undefined`와 `senderAnnotateView(contentsId: number): AnnotateViewPort | undefined`를 더한다(`feedbackView`가 `capture`·`current`를 만드는 방식과 같다. `send`는 그 view의 contents로 `send`한다. 폐기·교체된 view는 `current()`가 false다). annotation-shell이 이 입구를 쓴다.
4. `view-closed.ts` — 지운다(`I1.5#4`). `registry.ts`·`view-ipc.ts` 안의 사용을 걷는다. `shell/main/desktop/`에 남은 `view-closed` 참조(`wiring/app-views.ts` 등 screens-app-space 소유)는 고치지 않고 보고한다.
5. `app-call.ts` — `app:call` (`I2.5#27`, `I1.2#16`, `I1.5#9`)
   - 페이지 입력 `{api, input}`만 받는다(strict, wildcard·빈 api 거절). 앱·release·mode·project는 IPC를 보낸 view가 정한다(페이지 주장 아님).
   - blueprint는 `blueprint-source.ts`가 `app.app_api`를 읽어 준다. 선언에 없는 api는 호출하지 않고 `forbidden`("not available")로 답한다. 입력 검사와 default 적용은 앱 process가 하므로 `InputRules`, `rules.validate/hash`를 지운다.
   - 부르기: `call("memory", "apps", "call_api", {target, api, input, project: view.target.project ?? undefined, caller: {kind: "person", view_session}})`. 결과 outcome을 `CallOutcome`으로 옮긴다: `succeeded` → `ok`, `failed` → 앱이 준 `code: message`, `denied` → `forbidden`(또는 `conflict`, `unavailable`은 `denial.code`에 따라)과 message, `unknown` → `unavailable` ("result unknown"). 결과 상한(`CALL_RESULT_MAX_BYTES`)과 IPC 입력 상한은 유지한다.
   - 지운다: `ConfirmGate`, `ConfirmRequest`, `SignedProof`, `connectCommands` 쓰는 연결 cache·갱신·재시도, `Invoker` 주입. `commandStart`(제보가 쓰는 "막히기 전/후" 표시)는 유지한다.
6. `app-invoke.ts` — 지운다. `app-ipc.ts`는 `app:call` payload 이름만 맞춘다.
7. `app-protocol.ts` — 화면 byte (`I2.5#28`, 결정 #8)
   - `Upstream`을 앱 socket 호출에서 core의 `app.screen_file`(file route) 호출로 바꾼다: 입력 `{target, screen, path}`. `ProtocolView`에서 `endpoint`·`authorization`을 빼고 target(mode, release, preview면 `process_nonce`)을 넣는다. CSP 겹치기, 허용 MIME 표, redirect 거절, 취소 시 upstream 끊기는 유지한다.
   - main이 core의 file route를 받는 방법이 `desktop/core/client.ts`에 있는지 본다. 없으면 이 task는 `Upstream` 주입점까지 만들고 필요한 client 함수의 모양을 보고에 적는다(platform 소유).
8. `blueprint-source.ts` — `app.app_api` 읽기에 맞춘다. 화면 목록·size는 같은 응답의 `screens`에서, app-api 선언은 `app_api`에서 읽는다. `createEntryScreen`은 이름만 맞춘다.
9. 주석에 남은 요구 ID와 작업 번호(`#R…`, `[agent-R…]`, `req-…`)를 소유 file에서 지운다 (`I2.9#7`).

### B. SDK `ui-action`

10. 이름과 확인 표시 (`I2.12#1`, `U2.4#15`, 결정 #18)
    - `useCommand` → `useAppApi`, `CommandButton` → `AppApiButton`, `CommandSpec` → `AppApiSpec = {key, label}`(`confirm` 없음. `Pick<AppApiDeclaration, "key" | "label">`을 `@lophn/blueprint`의 새 type에서 가져온다. contract-app-calls-blueprint가 임시로 남긴 `CommandDeclaration` import를 이 task가 쓰지 않게 되므로 보고한다).
    - `AppBridge.call(api, input)` 인자 이름, 주석의 "confirm command의 사람 확인" 문장, 실패 code 예(`forbidden: confirmation was declined`)를 정리한다.
    - `AppApiButton`: 방패 아이콘, hover 문구, "Waiting for your confirmation." 표시, `data-confirm`을 모두 뺀다. pending(시계 아이콘, `aria-busy`)과 실패 문구만 남긴다.
    - `guide.md`, `examples/order-actions.tsx`(confirm false/true 버튼 둘 → 하나)를 맞춘다.
    - wording key `common.notice.asks-first`·`waiting-confirmation`을 쓰던 곳이 있으면 쓰지 않게 하고, key 지우기는 wording-split이 만든 파일 소유(lead)라서 보고한다.
11. 위험 test 한 file `packages/shell/main/app-frame/app-call_test.ts` (가짜 `CoreCaller`)

## 끝남

- `deno task check`가 통과한다. shell main은 `packages/shell/main/package.json`의 check에도 맞춰 type check가 통과한다.
- 위험 test(`packages/shell/main/app-frame/app-call_test.ts`): "페이지가 보낸 앱·release·project·caller 주장은 쓰이지 않고 sender view가 정한 값으로만 core를 부르며, 선언에 없는 api는 core까지 가지 않는다"
- 남지 않음: `grep -rniE "authorization|endpoint|confirm|proof|view-closed|viewClosed" packages/shell/main/app-frame/{app-call,app-connection,app-ipc,app-protocol,binding,blueprint-source,registry,view-model,view-ipc,view-error,session-policy}.ts packages/sdk/ui-action`가 0줄이다(`confirm`은 `ui-action`에서 0줄. 다른 낱말이 외부 규격 이름이면 보고).

## 보고

- 바꾼 file
- 등록할 것: `wiring/app-views.ts`(screens-app-space)의 `createAppProtocolHandler` 조립 인자 변경과 `view-closed` 참조 제거, `VIEW_PROJECT_CHANNEL` 핸들러 등록, `registry.annotateView`를 `ShellContext` 칸으로 올리는 것. wording key 삭제 두 개(lead)
- 안 쓰게 된 export: 소유 밖이 아직 import하는 `ConfirmGate`·`ConfirmRequest`·`SignedProof`·`Invoker` 등
- 정한 것: 거절 code 옮기기 표, `ConnectTarget.project`, `ui-action`의 새 이름
- 계약 바꾸기 요청(wave 3): `appFrameViewStateSchema.project`를 필수로 바꾸는 시점, core의 view 오류 보고 route(problems)가 요구하는 `binding`(서명 연결) 칸을 없애야 하는 것(releases-problems 소유 `core/problems`), file route client 모양
