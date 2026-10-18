# workspace-detach: 탭을 OS 창으로 떼고 다시 붙인다

- 목표: 탭 하나를 detached 창(OS 창 하나)으로 떼고, [Dock]이나 창 닫기로 project 창에 돌려놓는다. terminal PTY, editor의 저장 안 된 글, agent draft, native view의 page 상태가 창을 건너도 산다. 다시 띄우면 detached 창이 bounds와 함께 돌아온다.
- 재료:
  - `project-docs/products/roadmap/workspace-float.md`: "지금 코드"의 창 여럿·kind별 다시 붙이기, "무엇을 만드나" 1(detached 몫)·4·5(detached 몫), "정한 것".
  - `project-docs/architecture/workspace-layout.md`(계획 `workspace-float`이 쓴 것).
  - `project-docs/architecture/annotation.md`(app view identity), `project-docs/architecture/coding-agent.md`(terminal 탭).
- 범위 밖:
  - 탭 줄이 있는 detached 창, detached 창끼리 옮기기, 다른 project 창으로 옮기기(roadmap "하지 않는 것").
  - browser 탭 kind와 popup. 계획 `browser-tab`이 한다. 아래 "browser-tab과의 접점".
  - 탭을 끌어 detach하기, palette 명령, 단축키(roadmap에 없다).
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다. task id는 `wd-`로 시작한다.
- 단위: `tasks/*.md`의 "단위"가 정한다. 단위마다 task 하나다.
  - wave 1: `wd-layout`(layout model·schema 판 3), `wd-contract`(IPC·preload·`transfer`/`receive` 계약)
  - wave 2: `wd-native-move`(native view 옮기기, app_panel의 transfer), `wd-transfer-kinds`(terminal·editor·agent의 transfer), `wd-window-ui`(detached 창 화면), `wd-main`(main의 창 열기와 중계), `wd-project-side`(project 창의 Detach·Dock 연결)
  - wave 3: `wd-restore`(되살리기, bounds 저장·당기기), `wd-gallery`
- 순서: layout(`detached` 칸, `attachDetached`)과 `TabKindDef.transfer`/`receive` 계약(wave 1) → detached 창과 main 중계·kind별 transfer·native view 옮겨 붙이기(wave 2) → 되살리기와 gallery(wave 3) → 문서(lead).
  - wave 2 안에서 `wd-main`은 `wd-native-move` 뒤다(`AppViews.owns`·`moveViews`를 쓴다). 나머지 셋은 서로 기대지 않는다.
- 시작 조건: 계획 `browser-tab`이 main에 land한 뒤(agent). browser-tab은 남은 task가 셋이고, 이 계획과 `model.ts`·`workspace.tsx`·`kinds/host.ts`·`view-keeps.ts`·`embedded-view.tsx`·`wiring/app-views.ts`·`main/desktop/main.ts`·`preload/shell.ts`·`entry.tsx`를 같이 고친다. 기다리면 충돌이 없고, browser view도 이 계획에서 옮겨 붙일 수 있다(roadmap "정한 것": browser page를 다시 load하지 않는다). land하면 planner가 brief를 그 main에 맞춰 다시 보고 아래 "browser-tab과의 접점"을 browser 탭 옮기기 task로 바꾼다.
  - 지금 brief의 path·이름·줄은 main(`f70dcb339`)을 열어 확인한 것이다.

## browser-tab과의 접점

browser 탭은 계획 `browser-tab`이 만들고 아직 main에 없다. 이 계획에는 browser 전용 task가 없다. native view를 옮기는 길만 일반으로 만든다.

- main: view 이동은 `visibility.move`가 `frame.move`를 부르는 한 길이다(`wd-native-move`). app view registry가 `move`를 낸다. browser view registry(`browser-tab`의 `routeFrame`이 앱 registry와 가르는 것)가 `move`를 내면 같은 길로 browser view도 옮겨진다. 내기 전에는 `unavailable`이다.
- renderer: 옮길 view의 `view_session`을 `TabTransfer.views`에 싣고, 받는 창은 `ViewKeeps.put`으로 맡겨 두면 `EmbeddedView`가 `take`로 이어 쓴다(`wd-native-move`). browser 탭 kind가 `transfer`/`receive`를 선언하는 것은 `browser-tab`이 한다.
- browser 탭 kind가 `transfer`/`receive`를 선언하기 전에는 browser 탭을 Detach해도 page가 새로 load된다(쓰던 form과 `window.opener`가 사라진다). roadmap의 "끝남 기준"은 editor·terminal·재시작만 말하므로 이 계획의 끝을 막지 않는다. 선언은 `browser-tab`(또는 그 뒤 계획)이 한다(agent).
- "detached 창 안의 popup" 규칙(roadmap: detached 창에는 floats 층이 없어, 거기서 열린 browser popup은 `features`의 크기로 detached 창 하나로 연다)은 이 계획의 task에 넣지 않는다. popup이 있어야 쓸 수 있는 규칙이라 `browser-tab`(또는 그 뒤 계획)이 적용한다(agent).

## 정한 것

roadmap "정한 것"은 다시 적지 않는다. 아래는 이 계획에서 새로 정한 것이다.

- brief를 지금 쓴다(agent). `workspace-float`이 land해 layout model·view-order·`ViewKeeps`가 정해졌고 brief의 path와 이름은 모두 지금 main의 코드를 열어 확인한 것이다.
- layout:
  - `LAYOUT_SCHEMA_VERSION`은 3으로 올리고 `detached`(최대 20, 항목 `{tab, bounds}`)를 더한다. 2인 파일은 `unsupported_schema`로 읽지 않고 새로 만든다(agent, AGENTS.md "호환성"). 개발 데이터는 지운다.
  - detached 탭은 `findTab`·`allTabs`·`mapTabs`가 pane과 floats처럼 본다. `transient` detached 탭은 저장하지 않는다.
  - dock은 focus pane의 끝에 붙인다(agent). 떼기 전 pane 번호는 저장하지 않는다. floated였어도 docked로 돌아온다.
  - Detach 대상은 docked와 floated(접히지 않은 것)다(agent). 한도는 20개(schema).
- 흐름:
  - 순서는 `transfer` → main이 창을 만들고 앱 view를 옮김 → 성공했을 때만 layout을 `detachTab`으로 바꿔 저장한다(agent). 어느 단계가 실패해도 layout은 그대로라 탭이 사라지지 않는다. 한 번에 64KiB(IPC 상한)를 넘는 transfer는 `invalid_input`으로 실패하고 탭은 그대로 남는다.
  - 값은 hash가 아니라 창이 뜬 뒤 renderer가 `take()`로 당겨 받는다(agent). hash `#detached=<탭 key>`는 route 선택용이다. hash는 `renderer/desktop/router.ts`가 아니라 `entry.tsx`가 읽는다.
  - IPC는 `ipc/detached.ts` 하나, preload는 `window.lophnDetached` 하나다. 두 방향(project 창, detached 창)을 한 API로 묶고 main이 보낸 창으로 역할을 가린다(agent).
  - `TabKindDef.transfer`는 `Promise<TabTransfer | null>`이다(agent). null이면 옮기지 않는다. `{ value, views }`의 `value`는 JSON, `views`는 같이 옮길 앱 view의 `view_session`이다.
  - `transfer`/`receive`는 renderer의 `TabKindDef`에만 있다. main의 `TabKind`(layout 파일 쪽)는 바꾸지 않는다. main은 값을 열어 보지 않고 같은 project의 창에만 중계한다.
- kind:
  - terminal·editor·agent·app_panel만 `transfer`/`receive`를 선언한다. 나머지(`contexts`, `context`, `search`, `agents`)는 `toStored` 값으로 다시 연다(roadmap).
  - editor는 `EditorSessions.flush(path)`(새 method)로 flush하고 실패하면 알림 없이 옮기지 않는다(agent). roadmap은 `detach(path)`로 flush한다고 쓰지만 `detach`는 void라 실패를 알 수 없다.
  - agent는 session key의 draft를 넘긴다. session이 없는 새 탭은 `new:` key 전부를 넘기고 받는 창의 글을 덮지 않는다(agent). `DraftStore`가 탭이 아니라 session key로 되어 있다.
  - app_panel은 `ViewKeeps`에 `lookup`/`track`을 더해 mount된 view의 session도 찾는다(agent). roadmap은 `ViewKeeps`가 view를 보관한다고만 쓰지만 보관소에는 unmount된 view만 있다.
- 창:
  - detached 창은 `Desktop`의 route(`detached`)로 둔다(agent). appearance와 core 연결이 거기 있다. 이 route에서는 toast와 전역 palette intent를 끈다.
  - detached 창의 `openTab`은 project 창에 docked로 열고, `removeTab`은 확인 없이 탭을 닫고 창을 닫는다(agent). `patchTab`은 project 창의 layout에 반영된다. 이 창에는 탭 줄이 없다.
  - 창 기본·최소 크기는 다른 창과 같다(960×600, agent). OS 창 제목은 기본이다.
  - 창 닫기(×)와 [Dock]은 같은 흐름이다. 앱을 끄는 중에는 가로채지 않고 자동으로 dock하지도 않는다(agent). 끄면 `detached`로 저장된 채 남아 다음에 돌아온다.
  - project를 떠나면(project 창을 닫거나 같은 창에서 다른 공간으로 가면) 그 project 창의 detached 창이 닫히고 상태는 `detached`로 저장된다(agent). 다시 열면 저장된 값(`toStored`)으로만 되살아난다: terminal은 PTY에 다시 붙지 못하고 agent draft는 비어 있다(재시작과 같다). 같은 실행 안에서 떠났다 돌아온 terminal의 PTY는 host에 남는다.
  - tray와 전역 palette 키는 detached 창을 "가장 최근 창"으로 고르지 않는다(agent).
  - 같은 (project, key)의 detached 창이 이미 있으면 새로 띄우지 않고 그 창을 앞으로 가져온다(`conflict`, agent).
- test(AGENTS.md "속도"):
  - 계획 전체의 test는 roadmap "단계"가 정한 둘이다: `model_test.ts`의 float 위험 test에 detach·attach를 붙이기(`wd-layout`), editor transfer가 flush 실패에 null을 내서 탭이 남는 것(`wd-transfer-kinds`의 `transfer_test.ts`).
  - 창을 여럿 띄우는 Electron test는 만들지 않는다. 사람에게 묻기 전에는 새로 만들지 않는다.

## lead가 할 일

- wave 2를 띄우기 전에: `wd-contract`가 merge된 뒤 `ipc/detached.ts`의 모양(channel 이름, `TabTransfer`, `DetachedEvent`)이 brief와 같은지 본다. 계획 `browser-tab`의 `bt-contract`도 `preload/shell.ts`에 한 줄을 더하므로 rebase 충돌이 나면 두 줄(`lophnBrowser`, `lophnDetached`)을 다 남긴다.
- merge 때마다:
  - wording 생성: `wd-window-ui`와 `wd-project-side`가 둘 다 `catalog/project.ts`에 key를 더한다. 충돌은 두 쪽 key를 다 남기고 `deno task wording`을 다시 돌린다.
  - `main/desktop/main.ts`, `wiring/app-views.ts`는 계획 `browser-tab`의 `bt-view`도 고친다. 충돌은 두 쪽을 다 남긴다. `bt-view`의 `routeFrame`이 merge된 뒤에는 `frame.move`를 내는지 본다(안 내면 browser view는 옮겨지지 않는다. 이 계획의 범위 밖이니 `browser-tab` 쪽에 알린다).
- wave 2가 끝나면(손으로, Electron 두 창): 이 계획은 Electron test를 새로 만들지 않으므로 lead가 `deno task dev`로 본다. fake model server를 쓰고 사람의 `~/.lophn`은 건드리지 않는다.
  - editor 탭에 글을 쓰고 저장 안 된 채 Detach → 새 창에 같은 글. 창의 [×] → project 창으로 돌아온다.
  - 돌고 있는 terminal 탭을 Detach → 새 창에 지난 출력이 보이고 입력이 그 창에서 된다. [Dock] → project 창에서 입력이 된다.
  - agent 탭에 글을 쓰다 Detach → draft가 따라온다.
  - app panel 탭을 Detach → page가 다시 load되지 않는다(쓰던 상태가 남는다).
  - project 창을 닫으면 detached 창도 닫히고, 앱을 끄고 다시 띄우면 탭은 detached로 남아 있다.
- wave 3이 끝나면(손으로): 다시 띄운 뒤 detached 창이 같은 자리·크기로 돌아온다. 창을 옮겨 놓고 끈 뒤 모니터 배치를 바꾼 것처럼 저장 파일의 bounds를 화면 밖 값으로 고쳐 다시 띄우면 창이 화면 안에 뜬다(`.dev-data/`의 파일만 고친다).
- 끝나면:
  - `project-docs/architecture/workspace-layout.md`에 detached, layout 소유, transfer를 더한다: 탭 상태에 detached, `findTab`·`allTabs`의 범위, `detached` 칸과 판 3, project 창이 layout 전체를 갖고 detached 창은 main을 거쳐 탭 하나를 받는다는 것, `transfer`/`receive`와 `TabTransfer`, native view 옮기기(`move`, `ViewKeeps.lookup`), 창 닫기와 project 창 닫기, 앱 끄기. 마지막 줄의 "detached(OS 창)는 아직 없다"를 지운다.
  - `project-docs/products/change-log/`의 열린 판에 항목을 덧붙인다.
  - `project-docs/products/roadmap/workspace-float.md`를 지운다(남은 몫이 없다). `browser-tab.md`가 가리키는 popup 이야기는 그대로 둔다.
  - 이슈: worker 보고의 "무겁게 짠 것"(`wd-window-ui`가 `Workspace`에서 따라 만든 slice 줄)과 "알려진 미완 동작"(detached 창에서 연 agent 새 탭의 key 겹침, project를 떠난 뒤 terminal이 PTY에 다시 붙지 못함, 대기 목록의 [Answer in terminal]이 detached coding terminal을 앞으로 가져오는지)은 `issue` skill대로 올린다.
- 사람에게 묻는 것: 창 여럿을 띄우는 Electron test를 새로 만들 때.
