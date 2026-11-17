# setup-viewer

desktop의 다른 기계 창에서 그 기계를 처음부터 설정한다: Settings(그 기계의 core만 쓰는 항목)와 project 더하기(그 기계의 폴더를 목록으로 고른다)를 연다. 보호 입력 창은 다른 기계의 창에서도 열리고 값은 그 기계의 core로만 간다. 화면 code는 이미 있으므로 막아 둔 것을 풀고, 이 컴퓨터의 shell main이 필요한 항목만 막아 둔다.

- 단위: setup (wave 2)
- 선행: setup-provider, setup-project, setup-scope. device-roster 계획의 `roster-desktop`이 merge된 뒤에 띄운다(다른 기계 창이 붙는 길이 이 컴퓨터 core의 `machines/call`로 바뀐다. 계획 README).
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/entry.tsx`
  - `packages/shell/renderer/desktop/settings/settings-space.tsx`, `packages/shell/renderer/desktop/settings/settings-screen.tsx`, `packages/shell/renderer/desktop/settings/model.ts`, `packages/shell/renderer/desktop/settings/providers/`
  - `packages/shell/renderer/desktop/machines/`, `packages/shell/renderer/desktop/workspaces/`
  - `packages/shell/renderer/shell/workspaces-panel.tsx`, `packages/shell/renderer/workspace/sidebar/sidebar-panels.tsx`, `packages/shell/renderer/workspace/workspace-window.tsx`(Workspaces panel을 막는 machine 분기만)
  - `packages/shell/renderer/conversation/input-request-card/`, `packages/shell/renderer/secret-input/`
  - `packages/shell/ipc/secret-input.ts`, `packages/shell/main/secret-input/`, `packages/shell/main/desktop/wiring/secret-input.ts`
  - `packages/shell/main/desktop/viewer/`(다른 기계 창의 IPC guard. `roster-desktop` 뒤에 옮겨졌으면 그 자리), `packages/shell/preload/remote.ts`
  - `tools/wireframes/pages/screens/{shell,questions}.tsx`, `tools/wireframes/pages/screens/shell/`
  - `packages/design/i18n/catalog/{remote-desk,agents,workspace,conversation,data}.ts`
  - `project-docs/flows/areas/{shell-desktop,shell-workspace,ipc}.yaml`
- 읽을 것:
  - 계획 README "정한 것"의 값, 화면은 둘이다, 폴더, loopback 로그인
  - architecture: `project-docs/architecture/remote.md` "desktop에서 다른 기계 보기"(`roster-desktop`이 고친 판)와 "지키는 것" 1, 24, `project-docs/architecture/agent-definition.md` 60, `project-docs/architecture/approval.md` "사람 결정 handle"
  - skill: `.claude/skills/ui-design/SKILL.md`(gallery를 먼저 고친다)
  - 본보기(화면): gallery `shell-machine-settings`, `shell-machine-only-here`(`tools/wireframes/pages/screens/shell.tsx`, `shell/shell-scene.tsx`), `home-register`(`home.tsx`), `new-secret-input`(`questions.tsx`)
  - 조사: `reports/multi-device/survey-s4-setup-tabs.md` 1.6의 "Machine window (viewer) restrictions", G9
- 계약:
  - 쓰는 것: `setup-provider`의 `providers/connect-key`·`sign-in`·`sign-in-state`, 보호 입력 창의 `{provider}`·`{request}` 갈래, `oauthFlowOf`. `setup-project`의 `projects/add`, `projects/browse`. `setup-scope`의 사람 route 목록과 확인 규칙(허락받은 컴퓨터가 보낸 `providers/disconnect`는 받는 core가 확인 handle을 붙인다). device-roster의 `machines/call`·`machines/watch`.
  - 내놓는 것: 없음.
  - 시작 전에 merge된 code에서 다시 확인할 이름: `windowMachinesSource`·`thisWindow()`(entry), `MACHINE_WINDOW_CHANNELS`·`machine-route.ts`, `packages/shell/main/desktop/wiring/machines.ts`, `packages/shell/preload/remote.ts`, `machines/call`이 upload(`{input, base64}`)를 싣는 모양, 명단 항목의 터미널 입력 허락을 화면이 읽는 길. 다르면 이 brief의 뜻대로 맞추고 보고한다.

## 정한 것

- 다른 기계 창에서 여는 Settings 항목은 그 기계의 core만 읽고 쓰고 그 기계에서 효과가 나는 것이다: General, Providers, Agents, Tools and skills, Shell rules, Diagnostics. 이 컴퓨터의 shell main이나 OS에 붙은 항목(Appearance, Browser, Remote, Keyboard, Quick launch, Coding agents, Extension packages)은 지금의 한 줄과 [Open this computer]를 그 항목 자리에 보인다. 항목마다 source를 열어 이 기준으로 맞는지 보고, 다르면 보고에 적는다.
- 이 컴퓨터가 그 기계에서 터미널 입력 허락이 없으면 Settings 자리와 등록 dialog는 그 까닭과 허락을 켜는 곳(명단의 "내 기기")을 한 줄로 보인다. 판정은 `settings/list`가 `forbidden`인 것으로 한다(새 route를 만들지 않는다).
- 끊기: 다른 기계 창은 결정 handle 없이 `providers/disconnect`를 보낸다(그 기계의 core가 붙인다). 보내기 전에 화면 안 Dialog로 한 번 묻는 것은 이 컴퓨터 창과 같다.
- 로그인: 다른 기계 창은 device code 로그인(`oauthFlowOf`가 `device_code`)만 시작한다. loopback 로그인 단추 자리에는 그 기계의 browser가 필요하다는 한 줄을 둔다. 앱 OAuth, MCP OAuth의 sign_in card도 같은 까닭으로 그 한 줄이다.
- 보호 입력 창은 다른 기계 창에서 열면 값이 갈 기계 이름을 한 줄 보인다. 사람이 이 컴퓨터가 아닌 곳에 넣는 것을 알아야 하기 때문이다.

## 할 일

1. gallery 먼저: `shell-machine-settings`가 실제 Settings 공간을 기계 mode로 그린다(연 항목 하나, 막은 항목 하나를 상태로). 새 page `shell-machine-register`(다른 기계 창의 등록 dialog와 폴더 목록), `new-secret-input-machine`(기계 이름 줄이 있는 보호 입력 창)을 더한다. page id와 설명은 `ui-design` skill 규칙대로다. 가짜 data는 renderer 영역의 `testdata/`와 `fake-source.ts`를 쓴다.
2. `entry.tsx`: 다른 기계 창에도 `settings`, `settingsPanels`(위 항목만)를 그 기계의 core로 짓는다. `agentViewSource`에 `signIn: signInInputRequest`를 준다(provider 갈래는 core route라 그 기계에서 돈다). projects source의 폴더 고르기는 다른 기계 창에서 3의 dialog다.
3. `desktop/workspaces/`에 폴더 목록 dialog를 둔다: `projects/browse`로 home부터 열고, 폴더를 누르면 들어가고, 위로 가기와 [Choose]가 있다. `register-dialog.tsx`가 다른 기계 창에서 이것을 쓴다. Workspaces panel과 등록 단추가 다른 기계 창에도 서게 한다(앱 만들기는 계속 막는다).
4. `settings-space.tsx`·`settings-screen.tsx`·`model.ts`: 다른 기계 창의 항목 목록과 막은 항목 자리. `machines/remote-settings.tsx`는 막은 항목 자리와 허락 없음 줄로 쓴다.
5. `settings/providers/`: 끊기와 로그인을 위 정한 것대로 기계 창에서 가른다.
6. 보호 입력 창: `preload/remote.ts`에 `openSecretInput`을 열고, main의 guard가 `shell:secret-input-open`을 다른 기계 창에서도 넘긴다. `wiring/secret-input.ts`의 `parentOf`가 그 창을 받고, `core()`가 그 창이면 그 기계로 가는 core(읽기는 `machines/call`, 값은 `machines/call`의 upload)를 준다. 요청 card에서 연 것이면 `input_request/read`도 그 기계에서 읽는다. 값은 지금처럼 renderer, log, IPC 결과에 없다. 이 컴퓨터의 core가 `machines/call` body를 log·event·ledger에 남기지 않는지 code로 확인하고, 남기면 보고한다.
7. `input-request-card/`: 다른 기계 창에서 provider device code 로그인만 단추로 두고 나머지 sign_in은 한 줄이다. secret card의 [Enter]는 6의 창을 연다.
8. flows(`ipc.yaml`의 다른 기계 창 channel, `shell-desktop.yaml`·`shell-workspace.yaml`의 flow)를 고친다(`flows` skill).

## 끝남

- `npm run check`가 통과하고 `node packages/shell/renderer/build.ts`가 선다.
- `npm run wireframes`가 되고 gallery의 `shell-machine-settings`, `shell-machine-register`, `new-secret-input-machine`이 옮긴 component로 그려진다.
- 위험 test: 없음(값과 범위의 경계는 `setup-provider`, `setup-scope`의 test가 본다). Electron 창을 띄우는 test, E2E는 만들지 않는다. 실제 앱에서 다른 기계 창을 열어 보는 확인은 lead가 merge 전에 하고, 실제 로그인 확인은 끝난 뒤 사람에게 부탁한다.
- 남지 않음: `grep -rn "machines.notice.settings-elsewhere" packages tools`가 막은 항목 자리 한 곳만 남는다. `grep -rn "settings = remote" packages/shell/renderer/desktop/entry.tsx`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). Settings 항목이 부르는데 기기의 사람 route 목록(`packages/protocol/remote/allowlist.ts`)에 없는 route 이름
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
