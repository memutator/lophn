# page-view-desktop

desktop의 다른 기계 창에 agent page를 보는 탭 kind 하나를 짓는다: 그 기계의 page 목록과 page 하나의 그림, mouse·wheel·keyboard 입력, 주소로 가기·뒤로·다시 읽기, 잡기와 놓기, 그리지 않는 page의 이유. 그 기계가 화면 없는 VM이든 화면 있는 컴퓨터든 같다.

- 단위: page (wave 3)
- 선행: page-view-core. `device-roster`의 `roster-desktop`이 merge된 뒤에 띄운다(README "lead가 할 일").
- 소유(이 task만 고친다):
  - `tools/wireframes/pages/screens/shell.tsx`, `tools/wireframes/pages/screens/shell/machine-page-scene.tsx`(새 file), `tools/wireframes/mock/agent-page.ts`(새 file, 고정 그림 하나)
  - `packages/shell/renderer/browser/page-view/`(새 폴더: 화면 component, module.css, core source, `fake-source.ts`)
  - `packages/shell/renderer/workspace/kinds/page-view.tsx`(새 file), `packages/shell/renderer/workspace/kinds/registry.ts`
  - `packages/shell/renderer/workspace/add-tab-menu.tsx`, `packages/shell/renderer/workspace/workspace-window.tsx`(새 탭 menu에 넘기는 줄만)
  - `packages/design/i18n/catalog/remote-desk.ts`
- 읽을 것:
  - 계획 README "정한 것 › 멀리서 보기"
  - architecture: `project-docs/architecture/browser-tab.md`의 "멀리서 보기" 절, `remote.md` "desktop에서 다른 기계 보기"(다른 기계의 창은 core 통로 `shell:core-call|core-watch`만 쓰고 그 밖 IPC는 `forbidden`이다, 지키는 것 1·24)
  - 본보기(화면): `tools/wireframes/pages/screens/shell.tsx`의 `shell-machine-*` page와 `shell/shell-scene.tsx`, `packages/shell/renderer/workspace/kinds/jobs.tsx`(core source만 쓰는 탭 kind), `kinds/kind.ts`의 `thisComputerOnly` 설명
  - 그 밖: `.claude/skills/ui-design/SKILL.md`, `packages/shell/renderer/desktop/connection/core-read.ts`(`useCoreRead`, `useStateChanged`), `connection.ts`(`windowCoreSource`의 `watch`)
- 계약:
  - 쓰는 것: `page_view/list|snapshot|watch|input|control|open`, `PageInput`, `PageFrame`, `PAGE_VIEW_RENEW_MS`(`packages/protocol/lophn-agent/page-view.ts`), event `PageViewChanged`, `StateChanged{browser_pages}`
  - 내놓는 것: 없음

시작 전에 다시 볼 것(lead가 2026-11-18 main 0.23.84에 대 보았다: `windowCoreSource`, 창의 `machine`, `shell:core-call|core-watch`는 그대로다. 다른 기계로 넘긴 call은 그 기계의 기기 route 목록으로 걸러지므로 `page_view/*`가 그 목록에 있어야 한다. page-view-core merge 때 lead가 더한다): `roster-desktop`이 다른 기계 창이 그 기계를 부르는 길을 core의 `machines/call`·`machines/watch`로 바꿨다. 창의 core source(`windowCoreSource`)와 기계 context(`machine`)의 이름이 바뀌었으면 바뀐 이름을 쓴다. `core-setup`의 `setup-viewer`가 `shell.tsx`의 다른 기계 page를 고쳤을 수 있다.

## 할 일

1. wireframe 먼저(`ui-design` skill): `shell.tsx`에 page를 더한다. `shell-machine-pages`(Home server 창의 탭: page 목록. 제목, 주소, 연 agent 또는 "You", 주소 칸으로 새 page 열기), `shell-machine-page`(page 하나: 탭 본문의 가운데 기둥에 그림, 위에 주소 칸·뒤로·다시 읽기, agent가 다루는 중이면 "<agent> is using this page"와 [Take control]), `shell-machine-page-held`([Hand back]), `shell-machine-page-not-painting`(마지막 그림 위 이유 한 줄), `shell-machine-page-view-only`(다룰 수 없는 기기: 입력과 단추가 없고 그 기계에서 이 컴퓨터의 터미널 입력을 켜라는 한 줄). scene은 `shell/machine-page-scene.tsx`이고 renderer의 실제 component를 `fake-source.ts`와 고정 그림(`mock/agent-page.ts`, svg data URL)으로 그린다. 알림은 탭 위쪽 toast다(ui-design "모든 화면의 규칙").
2. `browser/page-view/`: 화면 component와 core source. source는 창의 core 통로만 쓴다(`page_view/*` route와 event). 보는 동안 `page_view/watch {on:true}`를 `PAGE_VIEW_RENEW_MS`마다, 탭이 닫히거나 안 보이면 `{on:false}`. `PageViewChanged`(그 탭)에 snapshot을 다시 읽되 읽는 중이면 끝난 뒤 한 번만 더 읽는다. 목록은 `StateChanged`의 `browser_pages`에 다시 읽는다.
   - 그림은 `<img src="data:image/jpeg;base64,…">`이고 비율은 frame의 width·height다. 누른 점은 그린 크기에 대한 비율로 frame의 CSS px에 옮긴다.
   - mouse down·up은 pointer down·up, 누른 동안의 move는 pointer move(초당 30번까지), wheel은 scroll이다. 그림에 focus가 있을 때 keydown은 Ctrl·Meta·Alt 없이 글자 하나면 `text`, 그 밖은 `keys.ts`의 이름(`Enter`, `Control+a`)으로 `key`다. 입력마다 key(`newId`)를 붙인다.
   - snapshot의 `control`이 false면 입력, 잡기, 새 page 열기를 그리지 않는다. `painting`이 false면 이유를 보이고 `frame`이 null이면 기다림 표시다.
3. `kinds/page-view.tsx`: kind `page-view`. key `pages`의 탭은 목록이고 목록에서 고른 page는 key `page-view:<tab>`의 탭으로 연다(제목은 page 제목). `thisComputerOnly`를 두지 않는다. `fromStored`·`toStored`를 두지 않는다(다른 기계 창의 layout은 메모리에만 있다, `remote.md` 모델의 "다른 기계의 창의 화면"). `registry.ts`에 한 줄.
4. 새 탭 menu: `add-tab-menu.tsx`에 `onPages`를 더하고 `workspace-window.tsx`가 다른 기계 창(`machine !== null`)일 때만 넘긴다. 이 컴퓨터의 창에서는 보이지 않는다(이 컴퓨터의 agent page는 지금처럼 browser 탭이다).
5. 글은 `remote-desk.ts`의 `machines.page.*` key다. 화면 test는 쓰지 않는다.

정한 것:
- 목록 탭 하나와 page마다 탭 하나다: 탭 줄이 여러 page를 나란히 보이는 자리를 이미 준다.
- move는 누른 동안만 보낸다: 떼어 둔 mouse의 move를 다 보내면 연결 하나에 요청이 넘친다. hover menu는 멀리서 열리지 않는다.

## 끝남

- `npm run check`가 통과한다. `npm run wireframes`가 되고 gallery의 `shell-machine-pages`, `shell-machine-page`가 옮긴 component로 그려진다. `node packages/shell/renderer/build.ts`가 선다.
- 위험 test: 없음(입력 자격은 core가 본다, `page-view-core`).
- 남지 않음: 없음.

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
