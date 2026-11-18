# screen-base-core

화면이 준 기계로 길을 고르는 아래쪽을 놓는다. preload와 shell main은 `machine`이 실린 `core-call`·`core-watch`를 그 기계의 `machines/call`·`machines/watch`로 보내고, 그 기계의 frame을 그 기계를 보는 창에만 나눈다. core는 기계마다 하나이던 watch 조건을 구독자들의 합으로 바꾼다. renderer 쪽(범위, hub, 갈래)은 `screen-base-scope`가 같은 wave에 나란히 짓는다. 기계마다의 창은 지우지 않는다(`screen-windows`).

- 단위: screen (wave 1)
- 선행: 없음. `multi-device-fixes`가 main에 올라가고, 아래 "같이 쓰는 계약"의 lead commit이 plan branch에 있을 때 띄운다.
- 소유(이 task만 고친다):
  - `packages/shell/preload/{core-api,secret-input-open}.ts`
  - `packages/shell/main/desktop/viewer/{machine-route,machine-route_test}.ts`, `packages/shell/main/desktop/wiring/{machines,machine-windows,context,secret-input}.ts`, `packages/shell/main/desktop/core/connection.ts`, `packages/shell/main/secret-input/ipc.ts`
  - `packages/protocol/remote/routes.ts`(`machinesWatch`만), `packages/protocol/events/transient.ts`(`MachineFrameReceived`만)
  - `packages/core/remote/{links,machine-routes,host_test,call_test}.ts`, `packages/core/server/control/capability.ts`, `packages/core/main/daemon/core.ts`(capability 생성 줄)
  - `project-docs/flows/areas/{ipc,core-platform}.yaml`
- 읽을 것:
  - 계획 README "정한 것 › 화면의 바닥"
  - 조사 `reports/multi-device/survey-n1-one-screen.md` 1.1·1.2·1.6, G1, 4(seam), 9의 3·8
  - architecture: `project-docs/architecture/remote.md` "desktop에서 다른 기계 보기"(초안은 `screen-base-scope`가 쓴다), `event.md`(ready와 snapshot)
  - `multi-device-fixes`의 change-log `project-docs/products/change-log/0.23/multi-device-fixes.yaml`(끝난 task `fix-setup`. brief는 `git show ffe208f94^:project-docs/plan/multi-device-fixes/tasks/fix-setup.md`)(`createMachineRoutes`, `CoreConnection.machineCall`, `machinesCall`·`machinesWatch`의 `shell_capability`)
  - 지금 code: `packages/shell/main/desktop/core/events.ts`(창마다 watch와 `ready`를 누구에게 보내나: 같은 규칙을 기계에도 쓴다), `packages/remote-client/connection.ts`의 `watch`
- 계약:
  - 쓰는 것: 아래 "같이 쓰는 계약", `createMachineRoutes`(`packages/core/remote/machine-routes.ts`), `CoreConnection.machineCall`
  - 내놓는 것: 같이 쓰는 계약의 shell main 쪽 동작, `ShellContext.machines`, `Machines.watch(machine, owner: string, conditions)`(wave 2·3의 `screen-apps`, `screen-inbox`가 쓴다), `machines/watch`의 `watcher`, `MachineFrameReceived.payload.watcher`, `ShellCapabilities.onEnd`

시작 전에 다시 볼 것: `fix-setup`이 `machinesCall`·`machinesWatch` 입력에 `shell_capability`를 싣고 `createMachineRoutes`(`packages/core/remote/machine-routes.ts`)가 그것을 검사한 뒤 뺀 나머지로 `links.call`·`links.watch`를 부르게 했다. shell main은 `CoreConnection.machineCall(method, body)`로 부른다. 그 merge된 모양을 보고 아래를 그 위에 짓는다. `carry-paths`가 같은 `links.ts`를 고칠 수 있다(뒤에 올리는 쪽이 rebase 충돌을 푼다).

## 같이 쓰는 계약(screen-base-core와 screen-base-scope의 brief에 같은 글)

lead가 두 task를 띄우기 전에 plan branch에 계약 commit으로 넣는다. 두 task는 이 file들을 고치지 않는다.
- `packages/shell/ipc/core.ts`: `coreCallSchema`, `coreWatchSchema`, `coreEventMessageSchema`의 세 variant에 `machine`(`mch_<ULID>`) optional. 없으면 이 컴퓨터, 있으면 그 기계다.
- `packages/shell/ipc/core-api.ts`: `CoreApi.watch(conditions, machine?)`.
- `packages/shell/ipc/machines.ts`: `machineConnectionState(row: MachineRow | undefined): { state: "starting" | "ready" | "stale"; confirmedAt: number | null }`. 규칙은 지금 `wiring/machines.ts`의 `stateOf`다(connecting → starting, connected → ready, 그 밖과 목록에 없음 → stale).
- `packages/shell/ipc/secret-input.ts`: `secretInputOpenSchema`의 각 갈래에 `machine` optional(값이 갈 기계).

두 쪽이 기대는 동작:
- shell main은 `core-call`의 `machine`이 이 컴퓨터가 아니면 그 기계의 `machines/call`로만, 없거나 이 컴퓨터의 id면 이 컴퓨터 core로만 보낸다. 기계에 묶인 창(지금의 기계 창)은 `machine`이 없거나 묶인 기계일 때만 통하고 다른 기계면 `forbidden`이다.
- `core-watch`에 `machine`이 있으면 (보낸 창, 기계)마다의 조건이다. 그 기계의 frame은 `machine`을 달고 `shell:core-event`로 그 기계를 보는 창에만 간다. 한 창의 watch에 답한 `ready`는 그 창에만, 그 밖의 `ready`와 `event`·`closed`는 그 기계를 보는 모든 창에 간다. `machine` 없는 message는 이 컴퓨터 core의 것이다.
- 다른 기계의 연결 상태는 IPC로 묻지 않고 `MachineList`(`shell:machines-changed`)의 줄을 `machineConnectionState`로 읽는다. `shell:core-state-get`은 그대로다.
- 보호 secret 창을 `machine`과 함께 열면 값과 읽기는 그 기계의 link로만 간다. 없으면 지금처럼(이 컴퓨터, 기계 창이면 묶인 기계)이다.
- 어느 쪽이 짓나: preload, shell main, core는 `screen-base-core`, renderer는 `screen-base-scope`다.

## 할 일

1. preload `core-api.ts`의 `watch`가 `machine`을 싣는다. `secret-input-open.ts`가 `machine`을 넘긴다.
2. shell main 고르기(`machine-route.ts`): `createMachineRoute()`에 `attach({ link(machine), self() })`를 더하고 `wiring/machines.ts`의 `register`가 부른다(`main.ts`는 고치지 않는다). `handle`은 위 동작대로 `core-call`·`core-watch`를 고른다.
3. `wiring/machines.ts`: `MachineLink.watch(owner: number, conditions)`(`[]`는 그 owner를 뺀다). 기계마다 owner별 조건을 들고 `machines/watch {machine, watcher: "w<owner>", conditions}`를 `machineCall`로 보낸다. 이 컴퓨터의 Gateway가 다시 붙으면(`ctx.relay.ready`) 든 것을 모두 다시 보내고, 창이 닫히면 그 owner의 것을 뺀다. shell main 안의 구독자는 `Machines.watch(machine, owner: string, conditions)`(watcher는 owner 글 그대로, 예: `app-views`, `notice`)이고 frame은 지금의 `onFrame`으로 받는다. `ShellContext`(`context.ts`)에 `machines: Machines`를 두고 `register`가 채운다. frame은 위 동작대로 나누고, `machine-windows.ts`가 따로 frame을 보내던 길은 지운다(묶인 창도 같은 길로 받는다).
4. 보호 secret 창: `secret-input/ipc.ts`·`wiring/secret-input.ts`가 열기 요청의 `machine`으로 link를 고른다(`ctx.machines.link`). 없으면 지금처럼 `machineRoute.linkOf`다.
5. core: `routes.ts`의 `machinesWatch` 입력에 `watcher: z.string().min(1).max(64)`. `createMachineRoutes.watch`가 검사한 `shell_capability`와 `watcher`로 구독자 key(capability, watcher)를 지어 `links.watch(subscriber, machine, conditions)`를 부른다. `links.ts`는 기계마다 구독자별 조건을 들고 합(같은 `session`·`types`는 한 번)을 link에 건다. 빈 조건은 그 구독자를 뺀다. link가 다시 열리면 합을 다시 건다.
6. `capability.ts`의 `ShellCapabilities`에 `onEnd(listener: (capability) => void): () => void`(`core.ts`의 생성 줄을 맞춘다). `createMachineRoutes`의 deps에 `onEnd`를 더해, capability가 끝나면 그 capability의 구독자를 모두 빼고 합을 다시 건다. `wiring/remote.ts`의 `createMachineRoutes` deps 줄(`onEnd: (listener) => ctx.peek.shellCapabilities?.onEnd(listener)`)은 "등록할 것"에 적는다(lead).
7. `transient.ts`의 `MachineFrameReceived.payload`에 `watcher` optional: 한 구독자가 바꾼 합에 그 기계가 답한 `ready`만 그 watcher를 단다. `links.ts`가 link마다 보낸 합의 차례로 누구 것인지를 들고, link가 (다시) 열리거나 상태가 ready 밖으로 가면 비운다. 누구 것인지 모르는 `ready`는 달지 않는다(모두가 다시 읽는다. 다시 읽기는 안전하고 놓치기는 아니다).
8. flows `ipc.yaml`(`shell:core-call|core-watch`의 `machine`, 보호 창의 `machine`)과 `core-platform.yaml`(`machines/watch`의 구독자와 합)의 줄을 고친다(`flows` skill).

### 정한 것
- 연결 상태는 IPC를 늘리지 않고 `MachineList`에서 읽는다: main이 이미 모든 창에 민다.
- 구독자를 capability에 묶는다: shell이 끝나면 core가 그 구독을 저절로 버리고, 새 shell의 webContents id가 옛 것과 겹쳐도 옛 구독이 남지 않는다. 뒤의 core 안 구독자(`remote-use`)는 capability 없는 key를 쓴다.
- 보호 창의 `machine`을 이 task가 연다: 기계 창이 없어질 때(`screen-windows`) Settings가 기계를 고르는 길(`screen-inbox`)이 이것 위에 선다.

## 끝남

- `npm run check`가 통과한다. `node packages/shell/renderer/build.ts`가 선다.
- 위험 test(새 test file을 만들지 않는다. flows test 목록이 그대로다):
  - `machine-route_test.ts`: "기계 A로 부른 `core-call`(보내기 `acp/send`, 승인 `turn_requests/decide`, `terminals/input` 모양)은 A의 link에만 가고 이 컴퓨터의 handler와 기계 B에 닿지 않으며, 기계가 없는 call은 이 컴퓨터로만 가고, 기계에 묶인 창이 다른 기계를 실으면 아무 데도 닿지 않고 forbidden이다."
  - `call_test.ts`(`createMachineRoutes` test 옆)나 `host_test.ts`(`createLinks` test 옆): "두 구독자가 같은 기계를 볼 때 한쪽이 빈 조건으로 그만 봐도 다른 쪽의 조건이 그 기계에 남아 event가 계속 오고, 한 capability가 끝나면 그 capability의 구독만 빠진다."
- 남지 않음: `grep -rn "watching.set(body.id" packages tests`가 0줄이다.
- subprocess·server·browser를 띄우는 test는 만들지 않는다.

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
