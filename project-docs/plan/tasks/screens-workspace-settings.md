# screens-workspace-settings

Lophn Workspace › Settings의 본문을 wireframe 코드에서 renderer `desktop/lophn-space/settings/`로 옮긴다. General(선언한 설정을 타입대로 보고 바꾼다), Appearance와 Reactions(새로), Coding agents(제품별 감지 결과와 기본 실행 옵션), Diagnostics(보안 점검 없이 구성 요소 상태)다. Settings 안의 둘째 목차 열은 없애고 항목 목록은 sidebar로 넘긴다(`screens-workspace-space`가 그린다). 옛 Update·notifications·Backup 흔적과 효력 시점·revision 비교를 지운다.

- 단위: screens-workspace (wave 3)
- 선행: 없음 (Agents·Providers·Tools and skills panel은 `screens-agents-settings`가 고친다. 이 task는 그 panel의 export 이름과 props를 그대로 부른다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/lophn-space/settings/{settings-screen.tsx,source.ts,core-source.ts,core-call.ts,model.ts,use-reload.ts,extension-settings.ts,settings.module.css}`
  - `packages/shell/renderer/desktop/lophn-space/settings/{general,connections,diagnostics,appearance,reactions,testdata}/` (`appearance/`·`reactions/`는 새로)
  - `packages/shell/renderer/desktop/lophn-space/lophn-space.tsx` (`<SettingsScreen …>` 호출부 한 곳과 settings 항목 state 두세 줄만. 같은 단위의 `screens-workspace-space`가 이 file 전체를 이어받는다. 이 task가 먼저, 그쪽이 뒤다)
  - `tools/wireframes/frames/compositions/workspace/{general-pane,appearance-pane,coding-pane,diagnostics-pane,reactions-pane,named-control}.tsx`
  - `packages/design/wording/catalog/workspace.ts` (wording-split이 만든 file. `screens-workspace-screens`·`screens-workspace-space`도 같은 file을 고친다. key는 이름순으로 끼운다. wording-split이 `workspace-settings.ts`로 나눴으면 그 file이 이 task의 것이다. 소유 바꾸기 요청: `ownership.md`의 screens-workspace에 더한다)
  - `packages/design/wording/catalog/workspace.placeholders.ts` (`generate.ts`가 만드는 생성물)
- 읽을 것:
  - inventory(lead가 맞추며 더함): `I2.6#38`, `U6.7#2`, `U6.7#3`
  - spec: S2 4장·8장(reaction grant: 끔, 묻지 않음, 물음) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - spec: S6 2장 1·8장(제품마다 실행 파일, version, 로그인, turn 끝 신호, skill 설치, 맡길 수 없는 제품) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/coding-agent.md`
  - inventory: `U1.5#4`, `U1.5#5`, `U1.5#7`, `U1.5#8`, `U1.5#9`, `U2.5#4`, `U2.5#7`, `U2.5#8`, `U2.5#9`, `U2.5#10`, `U3.5#1`, `U3.5#2`
  - 결정: `../README.md` 3장 #117·#118(설정 파일은 `<data root>/settings.json`. 화면 이름과 설명은 설정 key로 정한 wording key), #60(coding adapter의 설치 감지는 shell main이 하고 core에 알린다)
  - 본보기(화면):
    - `tools/wireframes/frames/compositions/workspace/general-pane.tsx` → `general/general-panel.tsx`
    - `tools/wireframes/frames/compositions/workspace/appearance-pane.tsx` → 새 `appearance/appearance-panel.tsx`
    - `tools/wireframes/frames/compositions/workspace/coding-pane.tsx` → `connections/connections-panel.tsx`
    - `tools/wireframes/frames/compositions/workspace/diagnostics-pane.tsx` → `diagnostics/diagnostics-panel.tsx`
    - `tools/wireframes/frames/compositions/workspace/reactions-pane.tsx` → 새 `reactions/reactions-panel.tsx`
    - `tools/wireframes/frames/compositions/workspace/settings-shell.tsx` (`WORKSPACE_PANE_GROUPS`: 항목 묶음과 아이콘)
    - `tools/wireframes/frames/compositions/workspace/named-control.tsx` (이름이 줄 왼쪽, 입력이 오른쪽 끝 고정 열인 줄)
    - `ui-inventory.md` 6.1, 6.7
- 계약:
  - 쓰는 것:
    - `protocol/config`의 설정 선언 모델(type: 불리언·숫자 범위·선택지·목록, 기본값, 거절 이유)과 읽기·쓰기 route. contract-platform(wave 2)이 둔 이름을 쓴다.
    - `protocol/diagnostics`의 상태 route(구성 요소마다 쓸 수 있는지, 안전한 불가 이유, 점검한 시각). contract-platform.
    - `shell/ipc/coding.ts`: `HarnessSettingsView = { harness_id, label, discovery, version, version_result, login, can_launch, can_deliver_messages, reason | null }`와 `codingCallSchema`의 op `harnesses`(저장한 감지 결과 읽기)·`refresh`(다시 감지). contract-coding-routes. shell main 구현은 coding-agent-settings.
    - `protocol/approvals`의 reaction grant type. contract-approvals.
    - ui-chrome(wave 2)의 design `Toast`, `VendorIcon`·`vendorOf`.
  - 내놓는 것:
    - `settings/model.ts`: `SettingsPane`(`"general" | "appearance" | "providers" | "agents" | "tools" | "coding" | "reactions" | "diagnostics"`)과 `SETTINGS_GROUPS`(묶음 General, Agents, System과 항목 id·wording key·아이콘). `screens-workspace-space`가 sidebar에서 import한다.
    - `settings-screen.tsx`의 `SettingsScreen`은 `pane: SettingsPane`과 `onPane(pane)`을 받아 고른 항목의 본문 하나만 그린다. 둘째 목차 열이 없다. `SettingsPanels`는 `providers`·`agents`·`diagnostics`·`reactions`·`coding`·`appearance`의 source만 든다.
    - 유지: `settings/model.ts`의 `wayLabel`, `waysOf`, `serverAuthLabel`, `folderName`, `SettingsSource`의 skill 폴더·MCP server method(`addSkillFolder(view, …)`, `addServer(view, …)`, `enterServerCredential`, `beginSignIn`, `finishSignIn`, `cancelSignIn`)와 `SettingsView`의 `folders`·`servers`·`rawServers`. `screens-agents-settings`의 panel이 쓴다.

## 할 일

1. **Settings 틀을 본문만 그리게 바꾼다** — `settings-screen.tsx`(258줄), `model.ts`. (`U1.5#4`, `U1.5#5`)
   - 왼쪽 세로 nav와 `SectionId`·`groups`를 지운다. `pane`에 해당하는 panel 하나만 가운데 기둥(최대 폭, 가로 가운데)에 그린다(6.1).
   - 항목 묶음: General(General, Appearance), Agents(Providers, Agents, Tools and skills, Coding agents), System(Reactions, Diagnostics) — `SETTINGS_GROUPS`(6.7). 항목 이름은 wireframe `WORKSPACE_PANE_GROUPS`와 같다.
   - 지운다: `UpdatePanel`, `NotificationsPanel`, backup 관련 import와 prop(`backup`, `update`, `notifications`, `UpdateSource`, `NotificationsSource`, `BackupSource`), `initialConnection`(Things to confirm 링크로 온 연결). wave 1이 폴더를 지웠다면 남은 import만 지운다. Agents·Providers·Tools and skills는 `AgentsPanel`, `ProviderList`, `ExtensionsPanel`을 그대로 부르고 `onPane("tools")`로 [Add server]가 옮기는 흐름(`addServer` 감싸기)은 유지한다.
   - `lophn-space.tsx`의 호출부를 맞춘다: `const [settingsPane, setSettingsPane] = useState<SettingsPane>("general")`와 `<SettingsScreen pane={settingsPane} onPane={setSettingsPane} …/>`. 이 state를 sidebar와 나누는 일은 `screens-workspace-space`가 한다.
2. **General** — `general/general-panel.tsx`, `source.ts`, `core-source.ts`, `model.ts`. (`U2.5#4`, `U1.5#8`, `U3.5#2`)
   - 요소가 선언한 설정 항목을 타입대로 보고 바꾼다: 불리언은 `Switch`, 숫자 범위는 `Input`과 범위, 선택지는 `Select`, 목록은 항목 편집. 묶음 제목 아래 줄마다 이름·설명이 왼쪽, 입력이 오른쪽 끝 고정 열이다(`named-control.tsx`의 모양을 `general/`에 옮긴다). 사람이 정한 값만 저장하고 기본값과 나눠 보인다("Set by you" / "Default: …"). 틀린 값은 거절 이유를 줄 아래에 보이고 저장된 값은 그대로다.
   - 지운다: 효력 시점 줄(`applyText`, `ApplyAt`, `SettingRow.applyAt`, `apply_at`), `settings.get/apply`의 revision 비교(`SettingsView.revision`·`defaultsRevision`, `extension-settings.ts`의 compare 칸) — `U1.5#8`, `U1.5#9`. `generalRows`의 `SHOWN_ELSEWHERE` 거르기는 새 선언 모델에서 지침·skill·MCP·창 크기 같은 내용물과 상태가 General에 오지 않게 하는 규칙으로 바꾼다.
   - 필수 설정이 비었을 때(`resolved: false`이고 기본값 없음): panel 위쪽에 design `Toast` — "<설정 이름> is not set", "그 기능만 시작하지 않고 나머지는 그대로 일한다"와 [Choose in Agents](`onPane("agents")`). (`U3.5#2`. 그 기능 화면 쪽 안내는 그 화면 task 몫이다.)
   - core-source는 계약의 설정 선언 route를 부른다. `{revision}`을 더는 싣지 않는다.
3. **Appearance(새로)** — `appearance/appearance-panel.tsx`. Theme(Light, Dark, System이 기본), Text size(Small, Default, Large), Reading width(Narrow, Standard, Wide), Density(Comfortable, Compact) 네 줄. Theme은 고르면 바로 바뀐다: Light·Dark는 `document.documentElement.dataset.theme`에 쓰고 System은 지운다(wireframe `applyTheme`). 값은 General과 같은 선언 설정 source로 읽고 쓴다(key 이름은 contract-platform의 선언을 따른다. 선언에 없으면 보고의 "계약 바꾸기 요청"에 적는다). Text size·Density를 적용할 token이 design에 없으면 값만 저장하고 적용 방법을 "정한 것"에 적는다. Reading width는 `packages/design/components/page-frames/reading-width.ts`와 `editor/reading-width.ts`(screens-project)가 읽는 같은 설정이다. 이 task는 설정 쪽만 맞춘다.
4. **Reactions(새로)** — `reactions/reactions-panel.tsx`, `reactions/source.ts`, `reactions/core-source.ts`, `reactions/testdata/fake-source.ts`. (`U3.5#1`, S2 4장·8장) 새 일을 여는 domain event 다섯마다(문제 열림, 문제 다시 열림, 앱 반복 종료, activation 실패, context 위반) Off / Open without asking / Ask를 고른다. 기본은 Open without asking. 줄마다 "언제"와 "Opens: …"(열리는 session) 글이 있다. call을 닫는 event는 항목이 없다. 아래 안내: "Ask puts a request in the waiting list and opens the session when you allow it." 모양은 contract-approvals의 reaction grant type이다.
5. **Coding agents** — `connections/connections-panel.tsx`(631줄), `model.ts`, `source.ts`, `core-source.ts`, `testdata/fake-source.ts`. (`U2.5#7`, `U2.5#8`, `U2.5#9`, `U1.4#4`·`U1.4#5`의 settings 몫)
   - 제품마다 한 행: vendor 아이콘과 이름, 찾은 실행 파일(`discovery`), version(`version`, `version_result`), 로그인 상태(`login`, 확인 못하면 "확인 못함"), turn 끝 신호 있음·없음(`can_deliver_messages`). 첫 prompt를 넘길 수 없는 제품(`can_launch: false`)은 "맡길 수 없음"으로 보이고 `reason`을 보인다. [Detect again]은 남는다. wireframe의 "skill 설치" 칸은 `HarnessSettingsView`에 값이 없다. 칸을 그리되 값이 없으면 `-`로 두고, 계약에 칸이 필요하면 "계약 바꾸기 요청"에 적는다.
   - 기본 실행 옵션: 기본 제품 고르기(제품마다 아이콘이 붙은 radio 줄, 맡길 수 없는 제품은 목록에 없다)와 model 등 옵션. "Used when an App Engineer does not pick one."
   - 지운다: 연결 만들기·범위·이름·회수·취소·생성 링크 화면과 doctor 단계(`connect`, `revoke`, `connections()`, `apps()`, `ConnectionRow`, `ConnectionScope`, `windowRevokeOpener`, `scopeSchema`를 쓰던 곳). `initialConnection`.
   - core-source/IPC: `codingCall`의 `harnesses`·`refresh`만 부른다(`windowCodingApi`로 얻은 통로). 기본 실행 옵션은 General과 같은 선언 설정 source로 읽고 쓴다(key는 contract-platform·contract-coding이 정한 것. 선언에 없으면 "계약 바꾸기 요청"에 적는다). 계약에 없는 것은 쓰지 않는다. `desktop/entry.tsx`가 import하는 `windowCodingApi`·`windowRevokeOpener`·`coreCodingConnectionsSource`의 이름이 바뀌면 보고에 적는다.
6. **Diagnostics** — `diagnostics/diagnostics-panel.tsx`, `source.ts`, `core-source.ts`, `testdata/fake-source.ts`. (`U2.5#10`, `U1.5#7`) 구성 요소마다 지금 쓸 수 있는지, 안전한 불가 이유, 실제로 점검한 시각을 보인다. [Run checks]를 누를 때만 점검한다. 보안 점검(`DiagnosticCheckName`의 `broad_grant`·`raw_key_pattern`, `impact: "wide_grant" | "raw_key"`, `IMPACT`)을 지운다. 계약의 진단 상태 route를 부른다.
7. **fake source와 wording** — 각 폴더의 `testdata/`와 `settings/testdata/fake-settings.ts`를 새 모양에 맞게 고치고 wireframe `workspace/data.ts`·각 pane의 data로 채운다. export 이름 `fakeSettings`, `fakeDiagnostics` 등 지금 이름을 유지한다. 박아 둔 영어 글은 `catalog/workspace.ts`의 key로 만든다(`U2.5#9`의 coding 문구 포함. 글이 바뀌지 않은 곳은 기존 `settings.*` key를 그대로 쓴다). 안 쓰게 된 옛 key는 지우지 않는다(4단계 cleanup). 만든 뒤 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 `catalog/workspace.placeholders.ts`를 다시 만든다.
8. **gallery를 옮긴 component로 그린다.** `workspace/general-pane.tsx`(`GeneralPane`), `appearance-pane.tsx`(`AppearancePane`), `coding-pane.tsx`(`CodingPane`), `diagnostics-pane.tsx`(`DiagnosticsPane`), `reactions-pane.tsx`(`ReactionsPane`)의 export 이름과 props는 그대로 두고 본문을 renderer panel + fake source로 바꾼다. `workspace/settings-shell.tsx`·`workspace/pages.tsx`·`workspace-page.tsx`는 `screens-workspace-space`의 것이라 고치지 않는다. `named-control.tsx`는 General에 옮기고 지운다. `top-toast.tsx`는 `pages.tsx`가 쓰므로 지우지 않는다.
9. (lead가 맞추며 더함 (`I2.6#38`, `U6.7#2`, `U6.7#3`)) 맡은 영역의 wording과 설정 말 / Settings 항목은 sidebar의 Settings 아래에 아이콘과 묶음으로 들어간다. 묶음은 General(General, Appearance), Agents(Providers, Agents, Tools and skills, Coding agents), System(Reactions, Diagnostics)이다. 고른 줄은 둥근 배경이고, Settings 안에 둘째 목차 열은 없다 / Appearance: Theme(Light, Dark, System이 기본), Text size, Reading width, Density

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (화면 task. 틀린 설정 값의 거절 판정은 B9 platform 몫이다)
- 남지 않음:
  - `grep -rn "ApplyAt\|applyText\|defaultsRevision\|wide_grant\|raw_key\|UpdatePanel\|NotificationsPanel\|BackupSource" packages/shell/renderer/desktop/lophn-space/settings`가 0줄이다.
  - `grep -rn "initialConnection" packages/shell/renderer/desktop/lophn-space`가 0줄이다.
- (화면) `deno task wireframes`가 되고, gallery의 `new-settings-general`, `new-settings-required-empty`, `new-settings-appearance`, `new-settings-coding`, `new-settings-reactions`, `new-settings-diagnostics`가 옮긴 component로 그려진다. (`new-settings-required-empty`의 toast는 `pages.tsx`의 `TopToast` 덮개가 아직 있다. space task가 바꾼다)

## 보고

- 바꾼 file
- 등록할 것: 영역 `workspace`의 새 key와 지운 key. `desktop/entry.tsx`와 `desktop/dev-mock/admin.ts`가 만드는 source의 이름·인자 변화(`coreSettingsSource`, `mockSettingsPanels`, `mockCoding` 등)와 새 source(`reactions`, `appearance`)의 factory 이름 — screens-workspace-space가 잇는다.
- 안 쓰게 된 export: `UpdateSource`, `NotificationsSource`, `BackupSource`, `CodingConnectionsSource`의 연결 method 등 (남이 쓰던 것은 지우지 않았다)
- 남긴 prop: `SettingsScreenProps`와 `SettingsPanels`에서 `desktop/main.tsx`·`lophn-space.tsx`가 넘기는데 안 쓰게 된 것(`backup`, `update`, `notifications`, `initialConnection`, `coding`의 모양 등)
- 정한 것: Appearance의 Text size·Density 적용 방법, 선언 설정의 key 이름, Settings 항목 state를 `lophn-space.tsx`에 둔 방식
- 계약 바꾸기 요청(wave 3): 설정 선언에 appearance key가 없거나, reaction grant type에 event 다섯이 모자라거나, coding IPC에 기본 실행 옵션 쓰기가 없으면 적는다
