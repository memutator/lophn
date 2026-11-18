# screen-cleanup

계획이 남긴 "이 컴퓨터에서만" 갈래와 옛 이름을 걷고, flows·module catalog·boundary catalog와 architecture 문서를 새 모양(창 하나, 기계 범위, 구독자들의 합)에 맞춘다. 새 동작을 더하지 않는다.

- 단위: screen (wave 4)
- 선행: screen-layout, screen-inbox, screen-pages, screen-windows, screen-phone, screen-link.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/`, `packages/shell/main/desktop/`, `packages/shell/ipc/`, `packages/shell/preload/`
  - `packages/design/i18n/catalog/`
  - `tools/wireframes/`(gallery `pages/index.ts`는 빼고)
  - `project-docs/flows/`, `project-docs/module-catalog.yaml`, `project-docs/boundary-catalog.yaml`(README가 이 task에 catalog를 맡겼다)
  - `project-docs/architecture/{remote,phone-screen,workspace-layout,project-identity,attention,terminal-agent,app-call,browser-tab}.md`
- 읽을 것:
  - 계획 README 전부(특히 "lead가 할 일"의 끝에 고칠 문서 목록)
  - 앞 task의 보고가 남긴 "안 쓰게 된 export"와 "넘길 줄"(lead가 이 brief를 띄울 때 알림에 붙인다)
  - architecture: 위 소유의 문서들, `project-docs/architecture/README.md`(문서 꼴: code path를 쓰지 않는다)
  - `flows` skill, `.claude/skills/orchestrate/SKILL.md` "막힘과 겪은 함정"의 마지막 항목(층을 지운 뒤 화면 문구 key로 한 번 더 grep한다)
- 계약:
  - 쓰는 것: 앞 task가 남긴 이름 전부
  - 내놓는 것: 없음

## 할 일

1. 옛 이름:
   - `useWindowMachine`을 `useScopeMachine`(MachineItem이 필요한 곳은 `useMachinesView`와 scope의 기계)으로 바꾸고 지운다. 쓰는 file은 `grep -rn "useWindowMachine" packages`로 찾는다(screen-base-scope 때 15개).
   - `workspace-window.tsx` 오른쪽 sidebar의 `otherMachine`(`SidebarCtx`)을 `here`로 바꾼다.
   - `windowCoreSource`가 이 컴퓨터의 source만 짓게 되었으면 이름을 `thisComputerCoreSource`로 바꾼다(`desktop/connection/connection.ts`. 폰이 import하면 그대로 두고 보고한다).
   - 기계 창 때의 글 key(`machines.gate.*`, `machines.button.*`, `machines.option.*` 가운데 쓰는 곳이 없는 것)를 앞부분으로 grep해 지운다. template literal key가 있으니 앞부분으로 찾는다.
2. 남은 갈래: `kind.ts`의 `thisComputerOnly`가 남은 kind(document-editor, agents, browser, browser-devtools, artifact, project-settings, app-detail, app-preview)는 README 범위 밖이라 둔다. 그 밖에 기계나 `here`로 가르는 곳 가운데 앞 task가 연 기능을 아직 막는 것이 있으면 지운다. 기능을 새로 여는 일이면 하지 않고 보고한다.
3. flows: `node tools/flows.ts check`가 통과하게 앞 task가 놓친 줄을 고친다. 기계 창 journey와 outcome, `shell:machines-*`의 지운 channel, `shell/viewer/*` 줄이 남지 않는다(`flows` skill, `node tools/flows.ts report`).
4. catalog: `module-catalog.yaml`의 `packages/shell/main` notes에서 `desktop/viewer/`(시작 기계 file, 창 자리, 보낸 창으로 기계를 고르는 guard)를 새 모양(화면이 준 기계로 `machines/*`를 고른다)으로, 지운 file을 가리키는 줄을 고친다. `boundary-catalog.yaml`의 remote boundary 설명(298줄 근처)에 이 계획이 기기 목록에 연 터미널·앱 화면·page route를 맞춘다. `node tools/check-modules.ts`가 통과한다(`npm run check` 안).
5. 문서: `remote.md` "desktop에서 다른 기계 보기"를 screen-base-scope 초안에서 실제로 들어간 모양으로 마감한다(기계마다 창, 시작 기계, `viewer/*.json`, "다른 기계의 앱 화면은 띄우지 않는다", "기계 사이의 session 목록 합치기는 없다" 문장이 남지 않는다). `phone-screen.md`에 desktop도 같은 길(`app_views/*`, `apps/screen_file`)로 다른 기계의 앱 화면을 받는다는 것을 적는다. 나머지 문서는 앞 task가 고쳤는지 읽어 보고 어긋난 문장만 고친다. code path를 쓰지 않는다. PRODUCT.md, change-log, roadmap은 lead가 고친다.
6. 이슈는 고치지 않는다. 이 계획으로 풀린 것으로 보이는 열린 이슈(예: `machine-window-global-instructions`)를 보고에 적는다(lead가 닫는다).

### 정한 것
- 범위 밖 탭 kind의 `thisComputerOnly`는 남긴다: README가 그 탭은 이 컴퓨터의 것만 연다고 정했다.

## 끝남

- `npm run check`가 통과한다. `node tools/flows.ts check`가 통과한다. `npm run wireframes`가 된다. `node packages/shell/renderer/build.ts`가 선다. `desktop/connection`이나 폰이 import하는 file을 고쳤으면 `cd packages/mobile && npm ci && npm run typecheck && npm test`도 통과한다.
- 위험 test: 없음(이름과 문서다). 지우는 test가 권한 경계(기계 A로 부른 것이 A에만 간다, 터미널 입력 허락, partition)를 지키던 것이면 지우지 않는다.
- 남지 않음: `grep -rn "useWindowMachine\|otherMachine\|machine-windows\|viewer/start\|window-places\|preload-remote\|MACHINE_WINDOW" packages tools tests project-docs/flows project-docs/module-catalog.yaml`가 0줄이고, `grep -rn "기계마다 창 하나\|앱 화면은 띄우지 않는다\|viewer/start.json" project-docs/architecture`가 0줄이다.

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
