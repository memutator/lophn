# machine-consumers

기기 principal을 모두 폰으로 보던 core 쪽 두 곳(presence, phone preview view)이 `ctx.deviceKind`로 kind phone만 폰으로 다루게 한다. 권한(allowlist, `app_sync/*`)은 kind로 가르지 않는다: desktop 기기의 권한은 폰과 같다(README "정한 것", program 정책 14). 그리고 sync 앱 DB의 node에 그것을 만든 기계의 id를 찍어, 다른 기계에서 온 DB(복제된 data root)면 새 node를 받게 한다.

- 단위: machine-consumers (wave 2)
- 선행: machine-id, machine-device-kind
- 소유(이 task만 고친다):
  - `packages/core/attention/presence.ts`
  - `packages/core/attention/decide.ts`
  - `packages/core/attention/decide_test.ts`
  - `packages/core/attention/mod.ts`
  - `packages/core/main/daemon/wiring/attention.ts`
  - `packages/core/apps/views/mod.ts`
  - `packages/core/main/daemon/wiring/apps.ts`
  - `packages/core/apps/runtime/entrypoint`
  - `packages/core/apps/runtime/supervisor`
  - `packages/core/apps/preview/launcher.ts`
  - `packages/core/main/app-supervisor`
  - `packages/protocol/apps/calls/process-wire.ts`
- 읽을 것:
  - 계획: `project-docs/plan/machine-identity/README.md`의 "정한 것"(phone만의 장치, desktop 권한은 폰과 같다, 기계에 묶인 상태의 표지)과 "다른 계획이 기대는 계약" 1·3
  - 조사: `/home/pyosechang/projects/lophn/reports/multi-machine/code-survey.md` C(presence, `device:`가 폰인 곳), D("Node id on the computer")
  - architecture: `project-docs/architecture/attention.md`(presence 규칙), `project-docs/architecture/app-sync.md`(node, HLC, 지키는 것), `project-docs/architecture/phone-screen.md`(preview view와 phone 탭)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/attention`(다른 feature module을 import하지 않는다. 기기 정보는 port다)
  - 앞 task의 결과: Late `ctx.deviceKind`(machine-device-kind. remote wiring이 맨 뒤에 내므로 부를 때 읽는다. `wiring/apps.ts`가 `ctx.phoneLink`를 읽는 길과 같다), `packages/core/machine/mod.ts`의 `readMachineId`와 `ctx.machine.id`(machine-id)
  - 지금 코드: `presence.ts`의 `isPhone`·`isPresent`·`anyDesktopPresent`, `decide.ts`, `attention/mod.ts`의 `createAttention`, `apps/views/mod.ts`의 `previewViews`, `wiring/apps.ts`의 `createAppViews`, `apps/runtime/entrypoint/main.ts`의 `openSyncStore({ node: ids.newId("nod") })`, `entrypoint/sync.ts`의 `ensureSyncTables`(node는 처음 한 번만 적힌다), `entrypoint/start-input.ts`(`exact`로 칸을 다 본다)와 `protocol/apps/calls/process-wire.ts`의 `appProcessStartInputSchema`, start 줄을 만드는 `apps/runtime/supervisor/supervisor.ts`와 `apps/preview/launcher.ts`, supervisor process `main/app-supervisor/main.ts`(`dataRoot`를 안다)
- 계약:
  - 쓰는 것: `ctx.deviceKind(principal)`, `readMachineId(root)`
  - 내놓는 것:
    - 앱 process 시작 줄에 칸 `machine`(`mch_` id). supervisor process가 시작할 때 `readMachineId(dataRoot)`로 한 번 읽어 live와 preview 시작 줄 모두에 싣는다.
    - sync 앱 DB의 `lophn_sync_state`에 key `machine`. 컴퓨터만 쓴다(폰의 C++ module `lophn-app-db`는 이 key를 모른다. 표와 칸 이름은 그대로다).

## 할 일

1. presence(attention): `createAttention` deps에 `deviceKind(principal: string): "phone" | "desktop" | null` port를 더하고, `isPhone(reporter)`를 `deviceKind(reporter) === "phone"`으로 바꾼다. 그래서 kind desktop인 기기 principal은 desktop 규칙(focused이고 idle 한도 아래)을 따르고 `anyDesktopPresent`에 든다. 사람(shell main)의 보고는 지금과 같다. `wiring/attention.ts`는 `(principal) => ctx.deviceKind(principal)`을 넘긴다(부를 때 읽는다). push 대상은 지금처럼 token이 있는 기기뿐이다(desktop은 token을 둘 수 없다. machine-device-kind).
2. phone preview view: `apps/views/mod.ts`의 `previewViews`가 owner의 kind가 phone인 view만 낸다(`createAppViews`에 kind port. `wiring/apps.ts`가 넘긴다). phone 탭이 desktop viewer의 화면을 폰 화면으로 집지 않게 한다.
3. sync node의 machine 표지:
   - 시작 줄에 `machine`을 더한다: `process-wire.ts`의 schema, `start-input.ts`의 `AppStart`와 `exact` 목록과 검사(`mch_` id 꼴), supervisor가 만드는 줄(`supervisor.ts`), preview launcher의 줄. supervisor process(`main/app-supervisor/main.ts`)가 시작 때 `readMachineId(dataRoot)`로 읽어 조립에 넘긴다(읽지 못하면 supervisor 시작 실패. core 기동이 이미 file을 만들었다). `dataRoot`가 없는 조립(test)은 test가 값을 준다.
   - `entrypoint/sync.ts`의 `openSyncStore`가 `machine`을 받는다. `ensureSyncTables` 뒤에 `lophn_sync_state`의 `machine`을 본다: 없으면 지금 id를 적고 node를 그대로 둔다(이 판 전에 이 기계에서 만든 DB다. app DB는 app process가 열 때만 고칠 수 있어 data step으로 하지 않는다). 다르면 node를 새 id(`nod_`)로 바꾸고 `machine`을 지금 id로 적는다. `hlc`, `release`, clock 표는 그대로다. 같은 transaction에서 한다.
4. 바뀐 port에 맞춰 이 task 소유의 test 견본을 고친다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - `packages/core/apps/runtime/entrypoint/sync_test.ts`: "`machine`이 다른 sync DB는 node가 새것이 되고, `machine`이 없는 DB는 지금 id를 적고 node를 지키며, 둘 다 data와 clock 표는 그대로다"
- subprocess, 서버, 브라우저를 띄우는 test는 만들지 않는다.
- 남지 않음: `grep -rn 'startsWith("device:")' packages/core/attention packages/core/apps/views`가 0줄이다(`packages/core/apps/sync`의 `deviceOf`는 kind와 상관없이 기기 자격을 보므로 남는다).
- flows catalog: route와 command는 그대로다. 바뀐 동작(presence, phone preview view)과 새 test file의 줄을 `project-docs/flows/`에서 고친다(자기 줄만). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서:

- 시작 줄의 `machine`이 지나는 길(file과 함수)과 preview가 같은 값을 받는지.
- lead가 고칠 목록: `architecture/attention.md`(presence는 kind로), `architecture/app-sync.md`(node의 machine 표지), `architecture/phone-screen.md`(preview view는 phone owner만).
