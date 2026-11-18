# screen-layout

탭이 자기 기계를 기억한다. 다른 기계의 탭이 layout과 전역 float에 저장되고, 그 기계가 꺼져 있으면 탭은 꺼짐으로 보이다가 붙으면 이어진다. 이 기계에 없는 workspace("Home · X", 다른 기계에만 있는 project·앱)의 layout은 기계와 함께 key해 저장한다. layout file과 전역 float file의 판을 올리고 옮기는 data step을 둔다. `shell/viewer/` file을 지우는 step은 그 file을 읽던 code를 지우는 `screen-windows`가 갖는다.

- 단위: screen (wave 3)
- 선행: screen-lists, screen-terminals, screen-apps.
- 소유(이 task만 고친다):
  - `packages/shell/main/workspace/`, `packages/shell/main/desktop/core/{layout-ipc,global-floats-ipc}.ts`
  - `packages/shell/renderer/shell/layout-source.ts`, `packages/shell/renderer/shell/global-floats/`
  - `packages/shell/renderer/desktop/machines/{tab-scope.tsx,data.ts}`
  - `packages/core/main/daemon/wiring/{shell-agent-tabs,shell-agent-tabs_test}.ts`(`dataSteps`만)
  - `tools/wireframes/pages/screens/project-workspace.tsx`
  - `packages/design/i18n/catalog/workspace.ts`
  - `project-docs/flows/areas/shell-workspace.yaml`, `project-docs/architecture/workspace-layout.md`
- 읽을 것:
  - 계획 README "정한 것 › 저장과 알림"의 "탭은 자기 기계를 기억한다"
  - AGENTS.md "호환성"(ledger 밖 data root file은 소유 wiring의 `dataSteps`)
  - architecture: `project-docs/architecture/workspace-layout.md` "저장"과 지키는 것 6·11·17
  - 조사 `reports/multi-device/survey-n1-one-screen.md` G4, 5(바뀌는 저장 data 표)
  - 본보기(data step): `packages/core/main/daemon/wiring/workspace-rename.ts`의 `workspaceLayoutsStep`(판 9→10), `shell-agent-tabs.ts`의 `shellAgentTabsStep`, `global-floats-tabs.ts`
  - screen-base-scope의 `WorkspaceRef`·`workspaceKey`·`TabItem.machine` 규칙과 `TabScope`
- 계약:
  - 쓰는 것: `TabItem.machine`, `WorkspaceRef.machine`, `workspaceKey`(screen-base-scope), `MachinesView`의 status
  - 내놓는 것: layout 판 11, 전역 float 판 3(아래)

## 할 일

1. **layout 판 11.** `WORKSPACE_SCHEMA_VERSION = 11`(`shell/main/workspace/workspace-layout.ts`). 저장한 탭의 공통 칸에 `machine?: mch_<ULID>`을 더한다(`schema.ts`의 탭 모양, kind마다가 아니다). 없으면 그 workspace의 기계다. renderer `layout-source.ts`가 `TabItem.machine`을 그 칸으로 쓰고 읽는다. screen-base-scope가 둔 "machine이 있는 탭은 저장하지 않는다"를 지운다.
2. **기계와 함께 key한 layout.** `data.ts`에서 다른 기계 workspace의 메모리 layout을 지우고 이 컴퓨터의 layout store에 `workspaceKey(ref)`(`home-<mch>`, `<id>-<mch>`)로 저장한다. key 규칙(`isWorkspaceKey`)은 그대로 맞는다.
3. **전역 float 판 3.** `GLOBAL_FLOATS_SCHEMA_VERSION = 3`, `workspace`에 `machine` optional, `tab`은 layout과 같은 탭 모양(`machine` 칸 포함). `global-floats/`의 층과 `global-float-layer.tsx`의 `OnlyHere` 갈래는 탭의 기계로 본다.
4. **data step.** `shell-agent-tabs.ts`의 `dataSteps` 끝에 `shell.layout-machines`를 더한다: `shell/workspaces/*.json`의 판 10을 11로, `shell/global-floats.json`의 판 2를 3으로 올린다. 탭 값은 고치지 않는다(`machine`이 없으면 그 workspace의 기계, 곧 이 컴퓨터다). 판이 다른 file과 손상된 file은 그대로 둔다(`layoutTextOf`와 같은 규칙). temp file에 쓰고 rename한다. 다시 돌아도 같다. 이 step은 이미 그 wiring 안에서 `shell.agent-tabs-unsaved` 뒤라 그 step이 판 10을 기대하는 것과 부딪히지 않는다.
5. **꺼진 기계의 탭.** `tab-scope.tsx`: 탭의 기계가 connected가 아니면 본문 대신 기계 이름, 상태, 마지막으로 본 때 한 줄이고 탭과 그 저장 값은 그대로다. connected가 되면 본문을 다시 mount해 이어진다(터미널은 `terminal_ref`로 다시 붙는다, 지키는 것 17). 명단에서 빠진 기계의 탭은 removed 한 줄이고 사람이 닫는다.
6. wireframe 먼저(`ui-design` skill): `project-workspace.tsx`에 `project-tab-machine-offline`(꺼진 기계의 터미널 탭), `project-tab-machine-removed`를 더한다. 글은 `workspace.ts`.
7. 문서와 flows: `workspace-layout.md`의 "저장"(판 11, 탭의 `machine`, 기계와 함께 한 key, 전역 float 판 3, "다른 기계의 창 layout은 메모리" 문장 지우기)과 지키는 것, flows `shell-workspace.yaml`의 저장 줄(`flows` skill).

### 정한 것
- `machine`은 kind마다가 아니라 탭 공통 칸이다: kind file 열한 개를 고치지 않고, 어느 kind든 기계를 잃지 않는다.
- step은 판만 올린다: 판 10의 탭은 모두 이 컴퓨터의 것이라 값을 고칠 것이 없다.

## 끝남

- `npm run check`가 통과한다. `npm run wireframes`가 되고 gallery의 `project-tab-machine-offline`, `project-tab-machine-removed`가 renderer component로 그려진다. `node packages/shell/renderer/build.ts`가 선다. `lead/boot.sh`로 새 data root가 두 번 뜬다(data step이 돈다).
- 위험 test(새 test file을 만들지 않는다):
  - `shell-agent-tabs_test.ts`: "판 10 layout과 판 2 전역 float을 옮긴 뒤 탭 값과 group·고른 탭이 그대로이고 판만 11·3이며, 판이 다른 file과 손상된 file은 바뀌지 않고, step을 두 번 돌려도 같다."
  - `packages/shell/main/workspace/workspace-layout_test.ts`: "옮긴 판 11 file의 이 컴퓨터 탭이 그대로 읽히고(machine 없음), 다른 기계의 탭은 machine과 함께 저장되고 읽힌다."
- 남지 않음: `grep -rn "schema_version\": 10\|WORKSPACE_SCHEMA_VERSION = 10\|memoryWorkspaceLayoutBridge" packages tools tests`가 0줄이다(옮기는 step과 그 test의 옛 판 견본은 뺀다).

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
