# shell 화면 전반 구현 목록 (2026-10-15)

기준 코드: main `acfe4cc3`. 본 설계: `requirements/shell.yaml`(accepted 39개), `tmp/specs/event.md`(S1 8장), `approval.md`(S2 6장), `agent-definition.md`(S4 6장), `place-session.md`(S8 2~3장), `coding-agent.md`(S6 2장 5), `tmp/notes/removed.md`, `tmp/changes-by-topic.md`(shell/*), `tmp/changes.md` 2~3장, `PRODUCT.md`, `products/AGENT-ROLE.md` P7.

읽은 범위: `packages/shell/{renderer,main,ipc,preload}`의 구조와 머리 주석, 이 목록에 적은 파일의 본문, `packages/design/wording`(en.ts 키 사용 여부는 grep으로 셈). 줄 수는 test와 css를 포함한 값이다. 경로는 모두 `packages/shell/` 아래이고 `design/`만 `packages/design/` 아래다.

현재 화면의 큰 모양(판정의 바탕):
- renderer는 core event를 받지 않는다. 연결 상태만 구독하고(`preload/core-api.ts`) 나머지는 화면마다 polling한다(Agent 화면 3초 `renderer/conversation/agent-view-data.ts`, context 목록 30초 `renderer/workspace/contexts/context-watch.ts`, notification chip과 공간 pill, app-detail 탭들의 `pollMs`). main은 ledger event를 cursor로 받아(`main/desktop/core/events.ts`) OS notification에만 쓴다(`main/desktop/main.ts`의 `arrived`).
- 창 안 공간은 launcher, lophn(Lophn Workspace), project, app, instructions 다섯이다(`renderer/desktop/router.ts`). Lophn Workspace 안은 Projects, Documents, Apps, Things to confirm, Settings 다섯 화면이다(`renderer/desktop/lophn-space/model.ts`).
- 확인 창(`main/confirmation`, `renderer/confirmation`)은 별도 modal 창이고, 앱 공간은 운영 패널(`renderer/app-frame/app-detail`)에 Version·Access·Automations·Connections·Activity·Data·Issues·Tasks 탭이 있다.

## 덜어낼 것

shell의 main, preload, ipc 쪽만 적는다. renderer는 아래 "UI 덜어낼 것"이다.

| 항목 | 근거 | 지금 코드 | 비고 |
|---|---|---|---|
| 확인 창(별도 modal)의 main 쪽 전체: coordinator, handle 발급, canonical 비교, 확인 binding, decide·submit·check, 창 열기 | changes-by-topic 3장 shell/confirmation-window(별도 modal 창 → request 카드, toast, 대기 목록). req-0304 "합쳤다"(사람 token만으로는 결정이 아니라는 binding 장치), req-0303 | `main/confirmation/`(39 files, 8.5k줄): `coordinator.ts`, `handle.ts`, `canonical.ts`, `check.ts`, `decide.ts`, `submit.ts`, `window.ts`, `choice.ts`, `types.ts`, `kinds/`(approval, apps, app-decisions, connection-revoke, option-action, problem-decision, rewind) | secret-input은 남는다(고칠 것). release activation 확인은 07, 결정 command는 02·core가 맡는다 |
| 확인 창 IPC와 preload | 같은 근거 | `ipc/confirmation.ts`, `ipc/confirmation-channels.ts`, `preload/confirmation.ts`, `preload/confirmation-open.ts`, `preload/confirmation-ended.ts`, `preload/shell.ts`·`main/build.ts`의 확인 창 항목 | secret-input 보호 입력이 창을 계속 쓰면 그 부분만 남긴다(확인 못함 1) |
| 질문 묶음을 확인 창 없이 접수하는 길(`windowless-confirmation`) | req-1510, S4 6장 사람에게 묻기 tool(질문은 대기 목록으로). 옛 `QuestionCreated`·`app.create` action 답 모델 | `main/confirmation/windowless-confirmation.ts`, `ipc/windowless-confirmation.ts`, `main/desktop/main.ts`의 등록 | 질문 카드는 04, 대기 목록은 02 |
| backup 복원 통로 | removed.md 1장 backup 전체. changes.md 3장 | `main/desktop/core/restore.ts`, `main/desktop/core/restore-ipc.ts`, `ipc/restore.ts`, `preload/restore-api.ts` | Settings backup 탭 renderer는 08 |
| 앱 export와 문서 export worker route | removed.md 1장 export 전부 | `main/desktop/core/allowlist.ts`의 `worker:documents/export`, `worker:apps/export` | |
| 문서 판 비교·tracking 미리보기·설치 안내 worker route | removed.md 1장 문서의 판·file-tracking. changes.md 3장 | `main/desktop/core/allowlist.ts`의 `worker:documents/section_history`, `worker:documents/diff`, `worker:projects/preview_tracking`, `worker:guides/list·get·outline·read` | `guides`는 coding-agent/guides 정리(변경 인덱스 "시작 summary, 안내 파일 배포" 덜어냄)와 같이 본다 |
| 문서 판 되살리기, series 새 멤버 첫 판 만들기, 파일로 두기(place)의 main 통로 | removed.md 1장(문서 판, series, place 없는 문서). req-0001(문서는 디스크 파일) | `main/editor/restore.ts`, `main/editor/create.ts`, `main/editor/place.ts`, `ipc/editor.ts`의 `EDITOR_RESTORE_CHANNEL`·`EDITOR_CREATE_CHANNEL`·`EDITOR_PLACE_CHANNEL`과 schema, 대응하는 `preload/editor-api.ts` 항목 | 편집기 파일 adapter 본체는 고칠 것 |
| OS notification 표시(NotificationCreated 기반) | changes-by-topic 2장 platform/notifications 보류(notification 기록과 읽음). S1 8장 toast는 renderer 정책이고 `NotificationCreated`가 없다 | `main/desktop/os-notification.ts`(217줄), `ipc/notifications.ts`, `main/desktop/main.ts`의 `osNotifications` 연결, `main/desktop/wording.ts` 해당 문구 | 보류라 지금 만들지 않는다. 나중에 대기 목록 event를 근거로 새로 짓는다 |
| 현재 보기(열린 탭, 선택한 문서 절·줄, 앱 view 참조)를 core로 relay하는 길 | S4 6장 "넣지 않는 것: 앱 화면의 상태"와 removed.md 2장 앱 화면 상태 보류. agent는 현재 보기를 prompt 입력으로 받지 않는다 | `main/workspace/current-view.ts`, `live-view.ts`, `view-publish.ts`, `app-view-context.ts`(합 941줄), `ipc/workspace.ts`의 `VIEW_HINT_CHANNEL`, `main/desktop/main.ts`의 hint 처리, `renderer/workspace/view-hint.ts`, `main/app-frame/app-protocol.ts`의 `view_session` query | 탭 단위 현재 보기까지 지울지는 확인 못함 2 |
| update 적용 통로 | changes-by-topic 2장 platform/install-and-update 보류(설치, 단일 instance, update) | `main/desktop/core/update-ipc.ts`, `ipc/update.ts` | Settings update 탭 renderer는 08 |
| 단일 instance와 second-instance argv 처리 | 같은 보류 근거 | `main/desktop/single-instance.ts`와 `open-intent.ts`의 second-instance 쪽 | 보류라 지울지 둘지는 확인 못함 3 |

## 고칠 것

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| core event 구독을 renderer가 쓰는 하나로 | main이 ledger event를 cursor·epoch로 받아 OS notification에만 쓴다 → Gateway에 조건(session, 종류)을 걸어 붙고, 끊기면 snapshot부터 다시 읽고, renderer에 push한다. cursor 따라잡기와 backlog 구분은 없어진다 | S1 8장, changes.md 2장 event(renderer 부분), 12장 | `main/desktop/core/events.ts`, `main/desktop/core/connection.ts`(`arrived`), `ipc/core.ts`, `preload/core-api.ts`(지금은 연결 상태만 push) |
| 앱 공간의 agent 부르기 통로 이름 | assignment(`asg_…`) 기준 → place에 놓인 agent 기준. role 이름이 `context_engineer` → `project_manager`. 정의가 lophn data 안 place별 폴더에 있으므로 layout이 가리키는 id도 따라 바뀐다 | S8 2장, S4 9장(assignment 지움), req-0034 | `main/workspace/kinds/agent.ts`, `agents.ts`, `kind.ts`(assignment withdraw 검사), `main/workspace/schema.ts`. renderer의 assignment는 UI 칸 |
| layout 저장의 info 탭 | `tab: info/versions/contexts` → versions 탭이 없다 | removed.md 1장 문서의 판 | `main/workspace/schema.ts` 48줄, `renderer/workspace/layout-map.ts` |
| 문서 탭 kind의 대상 | 문서 registry id(`doc_…`)와 `documents` 존재 확인 → 디스크 파일 경로 | req-0001, 0002(문서는 디스크 파일) | `main/workspace/kinds/document-editor.ts`(`targets.documentExists`), `main/workspace/restore.ts`. 편집기 쪽은 08 |
| 편집기 파일 adapter | documents의 `/v1/files/*`, doc id, base_hash CAS, 판 준비 → 파일 경로를 읽고 쓰는 adapter | req-0001, changes.md 4장 projects | `main/editor/file-adapter.ts`, `core-port.ts`, `ipc/editor.ts` 나머지, `main/editor/instructions.ts`(지침 파일을 문서 id로 resolve) | 
| secret 보호 입력 | 확인 창 handle을 거치는 보호 창 → 값이 renderer를 지나지 않는다는 보장은 두고, request 결정 모델과 따로 둔 보호 입력(provider 연결, 앱 secret, MCP credential)만 남긴다. 교체 확인 binding과 "계정" 문구는 뺀다 | req-0019(전용 보호 입력), 0407(secret 파일), 0408, removed.md provider 계정 삭제 | `main/confirmation/kinds/secret-input.ts`(426줄), `renderer/confirmation/kinds/secret-input/` |
| window 열기 intent | `lophn://things-to-confirm/<id>`, `--open-app`, `--quit` → things-to-confirm 링크는 대기 목록(02)의 대상으로 바뀐다 | req-1498. Things to confirm 쓰지 않음(terms.md) | `main/desktop/open-intent.ts`, `ipc/shortcuts.ts`의 intent, `renderer/desktop/intents.tsx` |
| core 기동 실패 분류 | "schema 비호환"을 일반 시작 실패로 보인다 → 높은 schema, hash 다른 이력, 손상 원본은 시작하지 않고 안내는 update 하나 | req-0054(impl partial의 gap) | `main/desktop/core/connection.ts`·`supervise.ts`가 `failed-schema`를 만들지 않는다. 화면은 UI 고칠 것 |
| 제보 화면의 첨부 | screenshot·화면 상태 미리보기, 한도, 항목별 끄기 → 글(과 annotation)로 제보. screenshot·화면 상태 한도와 첨부 규칙 뺌 | req-0172, changes-by-topic 4장 problems/feedback | `main/app-frame/feedback.ts`(501줄), `ipc/feedback.ts`(selection, screenshot_png, capture block) |
| test 이름과 주석의 옛 요구·작업 번호 | `shell/desktop#R37`, `[agent-R4]`, `shell#T18` 꼴 → 없앤다 | AGENTS.md 코드 절(테스트 이름과 코드 주석에 요구 ID·작업 번호 금지) | `packages/shell`, `packages/design`의 test 317개 파일(1,611곳)과 제품 코드 주석 15곳 |
| shell e2e | 옛 화면(확인 창, 문서 저장·판, 앱 export, backup, automation, series)을 치는 test를 지우고 새 설계로 다시 쓴다 | AGENTS.md 호환성 절 | `e2e/shell/app-decisions_test.ts`, `read-edit_test.ts`, `save_test.ts`, `report-problem_test.ts` 외. `e2e/flows`의 backup-and-restore, run-app-automation, write-series, app-export, update-lophn, install-lophn, manage-app-permissions 등은 flow별 영역이 정한다 |

## 새로 만들 것

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| 앱 화면 annotate mode의 main 쪽 | 앱 view 위에서 요소를 고르거나 영역을 끌어 고르는 입력을 받고, 고른 요소·영역의 screenshot과 화면 위치를 얻는다. 요소를 그린 SDK component 이름과 source 파일·줄은 요소의 표식(SDK가 붙임)에서 읽는다 | req-1486, 1487(annotation 내용), 1488(App Engineer session으로 전달) | `main/app-frame/`(overlay와 view 캡처 `view.capture`는 이미 있다. 요소 고르기는 지금 없다). SDK 표식은 sdk 영역 |
| annotation 보내기 | 모은 annotation을 한 번에 그 앱의 App Engineer session에 사람 메시지로 보낸다(메모, screenshot) | req-1486, 1488, AGENT-ROLE A3 | 새 명령 호출. 메시지 봉투는 03 |
| 대기 목록에서 coding agent 권한 요청을 누르면 그 session의 터미널 탭으로 focus | 대기 항목의 session → 열려 있는 터미널 탭을 고르고 없으면 연다 | req-1498, S6 2장 5, S1 8장 | `main/workspace/kinds/terminal.ts`, `renderer/workspace/kinds/terminal.tsx`의 탭 host. 목록 항목은 02, 터미널 쪽은 06 |

## UI 덜어낼 것

| 항목 | 근거 | 지금 코드 | 비고 |
|---|---|---|---|
| Lophn Workspace의 Documents 화면(문서 읽기 reader, 판 보기, 문서 검색 panel) | removed.md 1장 Workspace의 Documents·Context 화면, req-0059(문서는 project 화면에서 연다) | `renderer/desktop/lophn-space/documents/`(7 files, 1.7k줄) | 검색 panel의 project 파일 검색 기능이 어디로 가는지는 확인 못함 4 |
| series 화면과 registry 화면 | removed.md 1장 series 화면과 registry(context 계약의 series kind로) | `renderer/desktop/lophn-space/series/`(7 files, 1.6k줄): `series-panel`, `series-detail`, `register-form`, `member-writer`. `renderer/editor/draft-document.ts`의 series 새 멤버 흐름 | `draft-document.ts`는 지침 편집기도 쓴다. series 쪽만 뺀다 |
| 문서 정리(organize)와 export | removed.md 1장 export 전부, 문서 place(place 없는 문서), 문서 판 | `renderer/desktop/lophn-space/organize/`(10 files, 2.4k줄), `projects/project-detail.tsx`의 `ExportPanel` 사용 | projects 화면 자체는 고칠 것 |
| Things to confirm 화면의 notification 기록과 읽음 | removed.md 2장 Things to confirm 보류(notification 기록 화면), terms.md "쓰지 않음" | `renderer/desktop/lophn-space/things-to-confirm/`의 `NotificationRow`, `unread`, 읽음 처리, `labels.ts`의 계기 이름(`noticeTitle`) | 화면 전체가 02의 대기 목록으로 바뀐다 |
| Things to confirm 화면의 지난 결정 목록(닫힌 request, 기간 filter, expired·deferred 상태) | removed.md 2장(지난 결정 목록), S2 6장(기한 없음, cancelled) | `things-to-confirm/model.ts`, `source.ts`(`expiresAt`, `closedReason`, `ApprovalStatus`의 `expired`) | 같은 화면 |
| notification chip(창 오른쪽 아래 notification 목록과 3초 polling) | 같은 보류 근거. S1 8장 toast와 대기 목록으로 바뀐다 | `renderer/desktop/notification-chip/notification-chip.tsx`, `desktop/main.tsx`의 `NotificationChip` | `space-decisions.tsx`의 `WaitingPill`·`SpaceDecisions`는 대기 목록 store로 다시 잇는다(고칠 것) |
| notification 기반 [Ask] toast(dead code)와 notice 안의 [Ask] | removed.md 1장 화면마다 둔 agent 부르기 단추, S1 8장 | `renderer/desktop/notification-chip/ask-agent-toast.tsx`(쓰는 곳이 test뿐), `renderer/workspace/notice-ask.tsx`, `renderer/workspace/ask-view.ts`(`AskRequest`, role `app_engineer`·`context_engineer`) | |
| 화면마다 둔 agent 부르기 단추 | removed.md 1장(Context 탭 [Ask Context Engineer], Contexts 탭 [New context], 새 탭 메뉴의 Agent 항목, Settings의 Ask lophn) | Context 탭 `renderer/workspace/contexts/context-frame.tsx`(`onAsk`), 검색 목록 `context-search-list.tsx`, `search-input-form.tsx`(그릴 수 없는 입력의 [Ask …]), `search-tab*.tsx`, `context-tab-body.tsx`. Contexts 탭 `contexts-tab.tsx`의 [New context]와 note. `renderer/workspace/workspace.tsx`의 `askContextEngineer`·`newContext`·`expectDraft`·`engineerTabOpen`, `kinds/host.ts`, `kinds/search.tsx`, `kinds/context.tsx`, `kinds/contexts.tsx`. wording `contexts.button.frame-ask`·`input-ask`·`tab-new-context`, `conversation.placeholder.new-context`, `settings.button.ask-lophn`(쓰는 곳 없음) | 위반 toast의 Project Manager 부르기와 Context 탭의 [Send to …] 위반 넘기기는 남는다(req-0083). 이름은 고칠 것 |
| 확인 창 renderer 전체 | changes-by-topic 3장 shell/confirmation-window | `renderer/confirmation/`(35 files, 5.4k줄): `screen.tsx`, `frame/`, `layout/`, `before-after/`, `details/`, `kinds/`(approval, grant, automation, confirm-command, connection-revoke, option-action, owner-decision, problem-decision, release-activation, rewind), `renderer/dist/confirmation` 빌드 항목(`renderer/build.ts`) | secret-input 보호 입력은 남는다. release-activation 카드는 07, approval 카드는 02 |
| 파일 추적(tracking) 안내와 대화상자 | removed.md 1장(tracking 켜기·포함·제외, "Turn on tracking") | `renderer/workspace/tracking/`(10 files, 1.9k줄), `workspace.tsx`의 `TrackingStrip`·`tracking` prop·`refreshDocuments`, `desktop/main.tsx`·`desktop/entry.tsx`의 `tracking` 통로 | |
| 문서 판 목록과 판 비교 화면 | removed.md 1장 판 보기·되돌리기·비교, changes-by-topic 4장 shell/editor(버전 비교, 버전 확정, 정보 패널의 버전 탭) | `renderer/editor/versions/`(4 files, 1.0k줄), `renderer/editor/compare/`(4 files, 1.9k줄), `renderer/editor/info-panel/info-panel.tsx`의 versions 탭, `workspace.tsx`의 `showCompare`·`versionsTick` | 문서 편집기 본체는 08. 덜어내기는 08과 겹친다 |
| 시각 블록 중 고정 문서 참조와 [Save as document] | removed.md 1장 문서의 판, 문서 tool 지움(S4) | `renderer/workspace/visuals/document-block.tsx`, `agent-view.tsx`의 `saveVisual`, `block-frame.tsx`의 `SaveState`, wording `conversation.button.save-visual`·`conversation.body.save-visual-request` | 표·차트·diagram 블록은 문서끼리 어긋난 것 2 |
| 앱 운영 패널의 Tasks 탭(ticket 목록, 상세, 만들기, 맡기기 [Start]) | changes-by-topic 3장 coding-agent/tickets(ticket 화면은 뺌), PRODUCT.md 4절(ticket처럼 agent끼리 읽는 것은 사람 화면에 따로 보이지 않는다), removed.md 4장 | `renderer/app-frame/app-detail/tasks/`(9 files, 3.0k줄), `app-detail.tsx`의 Tasks 탭, `app-space.tsx`의 `tasks`·`taskTarget`, `desktop/main.tsx`의 `codingTarget`(tkt 링크), `ipc/coding.ts`의 [Start] | 터미널 탭에서 TUI를 여는 쪽은 06 |
| 앱 운영 패널의 Automations 탭 | removed.md 2장 앱 automation 보류, 변경 인덱스 3장(grant kind `automation.run`) | `renderer/app-frame/app-detail/automations/`, `app-detail.tsx`, wording `app-detail.*automation*`, `confirmation-window.automation.*` | |
| 앱 운영 패널의 Data 탭(앱 data export) | removed.md 1장 export 전부 | `renderer/app-frame/app-detail/data/data-tab.tsx`, wording `app-detail.note.export*`·`button.export-app` | |
| Settings backup 탭(nav에서만 숨김) | removed.md 1장 backup | `renderer/desktop/lophn-space/settings/backup/`(5 files, 1.1k줄), `settings-screen.tsx`의 `backup` 항목 | Settings는 08. 여기는 목록에만 적는다 |
| 옛 파일에 남은 dock, Roles, 계정 흔적 | removed.md 1장(Roles 화면, 대화 dock, provider 계정). 화면 파일은 이미 없고 이름과 문구만 남았다 | wording `roles.*` 298키(쓰는 곳 없음), `conversation.title.dock`, `project-workspace.label.avatar-icon-roles`·`avatar-icon-dock`, `settings.accounts.*`·`settings.label.accounts-for`·`account-name`·`next.add-account`, `confirmation-window.*account*`; 아이콘 이름 `conversationIcons.dock`, `lophnSpaceIcons.roles`; `renderer/conversation/dock-retired_test.ts`, `question-strip-retired_test.ts`; `agent-composer.tsx` 머리 주석의 "dock용 composer" | key 사용 여부는 grep으로 센 값이다(확인 못함 7). 쓰지 않는 key는 en.ts에서 505개 |
| 대기 목록 이전 모델의 polling | S1 8장 | `renderer/desktop/lophn-space/things-to-confirm/context.tsx`의 `intervalTicks`, `space-decisions.tsx`의 `useRequestOverview` | event client와 store(01)가 서면 지운다 |
| context 목록 polling과 위반 toast의 계산 | S1 8장(`ContextViolationFound`로 toast) | `renderer/workspace/contexts/context-watch.ts`(30초), `violation-toast.tsx`, `workspace.tsx`의 `toasts` | 반응 층은 01 |
| 시작 때 만드는 중인 context를 3초마다 보는 장치 | CR "새 context form 지움"과 같은 이유로 [New context]가 없다 | `context-watch.ts`의 `onDrafting`·`CONTEXT_WATCH_FAST_MS`, `workspace.tsx`의 `expectingDraft` | context-drafting 표시(`contexts/context-drafting*.ts*`)가 남는지는 08 |
| 쓰이지 않는 옛 wording key | AGENTS.md 호환성 절 | `design/wording/en.ts`(키 2,503개 중 505개를 쓰는 곳 없음: roles 298, settings 101, confirmation-window 49, conversation 20, things-to-confirm 13, common 11 외), `placeholders.ts`(생성) | 동적 key 조합은 못 셌다 |

## UI 고칠 것

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| 화면이 core를 읽는 방식 | 화면마다 polling → event client 하나, store 층, 반응 층, component는 hook으로 store만 읽는다 | S1 8장, changes.md 2장 event(renderer) | `conversation/agent-view-data.ts`(3초), `workspace/contexts/context-watch.ts`(30초), `desktop/notification-chip/*`, `desktop/lophn-space/things-to-confirm/context.tsx`, `app-frame/app-detail/use-read.ts`(`pollMs`), `terminal/terminal-tab.tsx`, `desktop/lophn-space/settings/connections/connections-panel.tsx`(3초). event client와 반응 층 새로 짓기는 01 |
| Lophn Workspace의 화면 구성 | Projects, Documents, Apps, Things to confirm, Settings → Documents와 Things to confirm이 빠지고(위 UI 덜어낼 것) 대기 목록이 02에서 온다. 남는 화면이 무엇인지 요구에 없다 | req-0059, 0060, removed.md 4장 | `renderer/desktop/lophn-space/model.ts`(`LOPHN_SCREENS`, `DEFAULT_SCREEN`=documents), `screens.ts`, `sidebar/sidebar.tsx`, `lophn-space.tsx`, `palette/lophn-scope.ts` |
| Projects 화면 | 문서 정리·export를 뺀 project 정보(이름, 목적, 폴더, 폴더 설명, 보관)만 | core-projects req(사람이 project를 등록·수정·보관, 폴더 하나 이상), 위 organize 덜어냄 | `renderer/desktop/lophn-space/projects/projects-screen.tsx`, `project-detail.tsx`, `organize/model.ts`의 slug 규칙 |
| route 모양 | `read: {document, version}`, `request`, `connection`, `taskTarget`, `issueProblem`, `instructions` 공간 → 문서 판, Things to confirm 링크, coding 연결·ticket 링크가 빠진다 | removed.md 1·2장, 위 덜어낼 것 | `renderer/desktop/router.ts`, `main.tsx`(`visit`, `confirmTarget`, `codingTarget`, `go`), `intents.tsx` |
| 이름 충돌 | project 화면 코드 이름이 `workspace/`인데 화면 말 Lophn Workspace는 project 밖 공간이다. 코드는 그 공간을 `lophn-space`로 부른다 | req-0058, AGENTS.md 이름 규칙 | `renderer/workspace/`(project 화면), `renderer/desktop/lophn-space/`, `common.label.lophn-space` |
| Workspace로 들어가는 단추 이름 | "lophn" → Lophn Workspace | req-0058(화면 말이 모두 Lophn Workspace) | wording `launcher.button.lophn`("lophn", launcher의 빈 상태 단추와 `LophnEntry` 라벨), `common.button.palette-lophn`("Open lophn"), `common.label.tray-open` |
| launcher 프로젝트 카드 | tracking 상태, gitignore 줄, 문서 수, project id 줄 → 파일 추적이 없으니 빠진다 | removed.md 1장 file-tracking | `renderer/desktop/launcher/project-card.tsx`(`status-tracking`, `detail-gitignore`, `detail-documents`), `launcher/core-source.ts`·`source.ts`·`model.ts`, `dev-mock/launcher.ts` |
| launcher 시작 실패 화면 | schema 비호환 화면이 "lophn needs an update"를 말하나 연결 코드가 쓰지 않는다 → 높은 schema·hash 다른 이력·손상 원본 세 경우에 update 안내 | req-0054(gap) | `renderer/desktop/launcher/start-failure/model.ts`, `connection/connection.ts`(`failed-schema`) |
| project sidebar | 문서 목록은 core documents registry의 `doc_` row + "문서로 잡힌 파일" 두 번 읽기 → 등록 폴더의 디스크 파일 tree | req-0001, 0002, changes.md 4장 projects | `renderer/workspace/sidebar/sidebar.tsx`(Folders·Documents), `workspace/source.ts`(`DocumentRow`, `FileRow`), `workspace/core-source.ts`(`FILE_DOCUMENT_LIMIT`), `launcher-button.tsx` 주변 |
| sidebar의 Agents 묶음 | assignment 기준 목록(lophn, Context Engineer, Operator) → lophn(전체에 하나), Project Manager(project마다 하나), Operators | S8 2장, req-0084, 0035 | `renderer/workspace/sidebar/agents-section.tsx`(`SidebarAgentRole`, `asg_`), `agents/sidebar-agents.ts`, `workspace.tsx`의 `openRole` |
| 접힌 sidebar rail | Terminal, Contexts, Saved views, Search, Agent 단추 → req-0073의 넷에 더해 Search가 있다. Agent 단추가 여는 agent가 lophn으로 고정 | req-0073, 0074 | `renderer/workspace/contexts/shortcut-rail.tsx`(`RAIL_ACTIONS`), `workspace.tsx`의 rail 처리 |
| 탭 정보 패널(Info) 위치 | 작업대에 하나 있는 패널(열림 상태, 마지막 탭을 공간별로 기억) → 문서 탭 안 오른쪽에 열리고 다른 탭에는 보이지 않는다 | req-0070 | `renderer/workspace/info-panel-slot/info-panel.tsx`, `workspace.tsx`(`infoOpen`, `infoPlacement`, `INFO_PANEL_WIDTH`), `workspace/model.ts` | 
| 앱 공간 title bar의 agent select | assignment 기준, role `context_engineer`를 거르는 코드 → place agent 기준(lophn, App Engineer, Operators). Manage 항목은 유지 | req-0087, S8 2장 | `renderer/app-frame/agent-select.tsx`, `app-agents.ts`, `agent-pane.tsx` |
| 위반 toast에서 Project Manager 부르기 | 위반된 context 하나를 chip으로 붙인 새 Agent 탭 → 어느 파일이 어느 규칙을 어겼는지가 붙은 session. 버튼 이름은 Project Manager | req-0083, 0085, S1 8장 | `renderer/workspace/contexts/violation-toast.tsx`, `workspace.tsx`(`openRole("context_engineer", chips)`), `conversation/composer/types.ts`의 `ContextChipView`(사건 대상 id와 label뿐). 붙이는 근거 모양은 08과 Project Manager call(03) |
| 화면 말 Context Engineer | Context Engineer → Project Manager | req-0083, S8 2장 | wording `contexts.*`, `project-workspace.label.role-context-engineer`, `settings.label.role-context-engineer`, `things-to-confirm.label.role-context-engineer` 외 약 10곳 |
| 공간 크롬의 결정 대기 pill | notification과 request overview polling으로 센 수 → 대기 목록 store(02)의 수 | req-1498, S1 8장 | `renderer/desktop/notification-chip/space-decisions.tsx`(`WaitingPill`, `SpaceDecisions`), launcher 카드, `workspace.tsx`·`app-space.tsx`의 `SpaceDecisions` |
| 앱 운영 패널의 Access, Connections 탭 | 범위별 승인(파일, host, secret 이름), 앱 쌍 허락, 회수 → 앱 grant(activation 한 번)와 그것을 거두기. 옛 kind `app.call`·`automation.run` 구분이 없다 | S2 4장, req-0860, 0873, 변경 인덱스 3장 permissions | `renderer/app-frame/app-detail/access/access-tab.tsx`, `connections/connections-tab.tsx`, `app-detail/source.ts`의 `GrantRow` | 
| 앱 운영 패널 전체 | 8탭(Version, Access, Automations, Connections, Activity, Data, Issues, Tasks) 패널 → 덜어낸 셋 뒤에 남은 탭의 두 갈래: Version·Issues는 07, Activity(호출 기록)는 05의 rewind 화면과 합친다 | 위 덜어낼 것, 07·05 | `renderer/app-frame/app-detail/app-detail.tsx`, `ops-panel-frame.tsx`, `app-space.tsx` | 
| 제보 대화상자 | 글 + 화면 상태·screenshot 미리보기와 항목별 체크 → 글, 그리고 annotation 보내기 | req-0172 | `renderer/overlay/feedback/feedback-dialog.tsx`, `app-frame/report-button.tsx` |
| 팔레트의 문서 행 | 문서 검색 hit이 `{document, version}`을 목적지로 한다 → 파일 경로와 줄 | req-0001, core-projects 검색(파일 경로, 줄 위치, snippet) | `renderer/desktop/palette/lophn-scope.ts`의 `LophnTarget`(kind `document`), `workspace-scope.ts`, `model.ts`의 `DocumentFound` |
| 대화 입력의 보내기 방식 | 일하는 중에만 select "Change this work / Next request" → 기본은 다음 turn, steer를 고르면 도는 turn에 | req-1509 | `renderer/conversation/composer/agent-composer.tsx`(`SEND_MODES` correction·request), `delivery-state.ts`, wording `conversation.label.send-correction`·`send-request`. 본체는 03 |
| 입력칸 아래 권한 요약 | place 권한 규칙과 이 session에서 Allow한 것 한 줄, 누르면 Agents 화면의 Permissions → grant 모델의 요약 | S2 4장, S4 | `agent-composer.tsx`(`permissionSummary`, `onOpenPermissions`). 02·04와 겹친다 |
| 터미널 탭의 코딩 TUI와 [Start] | 사람이 연결하고 시작 → App Engineer가 맡기면 열린다 | S6 2장 | 06 |

## UI 새로 만들 것

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| toast를 한 곳에서 그리는 overlay | 모든 공간(launcher, Lophn Workspace, project, 앱 공간의 native view 위 포함)에서 toast를 띄운다. layout 위치를 차지하지 않는다. 연결이 끊긴 사이 놓친 toast는 다시 띄우지 않는다 | req-0063, S1 8장(toast는 overlay가 그린다) | `renderer/overlay/`, `renderer/workspace/notice-card.tsx` 대체. 지금 toast 두 곳(`workspace.tsx`의 위반 toast, `NoticeCard`)은 project 화면에만 있다. 어떤 event가 toast인지(반응 표)는 01 |
| toast의 agent 부르기 | toast를 눌러 그 사건의 대상이 붙은 session을 연다. 판정할 수 있는 사건에서만 뜬다 | req-0085, 0086, P7 | 반응 층(01)이 넘기는 "눌렀을 때" 동작을 받아 `renderer/workspace/kinds/agent.tsx`의 `openAgent`·앱 공간 agent pane에 잇는다 |
| annotate mode 화면 | 앱 공간 바의 켜기 단추, 요소 클릭과 영역 drag로 고르기, 고른 곳마다 메모 칸, 모아 둔 annotation 목록, [Send] 한 번 | req-1486 | `renderer/app-frame/app-bar.tsx`, `embedded-view.tsx`, `view-chrome.tsx`. 지금 `annotat` 낱말이 shell에 한 곳도 없다 |
| 앱 화면을 project로 열기 | project 안에서 앱을 열면 그 project로, 앱 공간에서 열면 화면 안에서 project를 고른다 | req-1515 | 05가 맡는다(`renderer/app-frame/app-space.tsx`가 닿는다) |
| 대기 목록 항목에서 터미널 탭 focus | 위 새로 만들 것(비UI)의 화면 쪽 | req-1498 | `renderer/workspace/kinds/terminal.tsx`. 02·06과 맞춘다 |
| 앱 grant 보기와 거두기 화면 | 앱이 바깥 자원과 다른 앱에 쓸 수 있는 범위를 보고 거둔다 | S2 4장(사람이 grant를 거두면 새 호출부터 막힌다), req-0873 | 요구 문서에 이 화면이 없다(확인 못함 5). 지금은 `app-detail/access`·`connections` |

## 문서끼리 어긋난 것

1. **Context Engineer의 수.** `removed.md` 4장 "Context Engineer는 전체에 하나"와 `changes-by-topic.md` 5장 "roles/context-engineer 전체에 하나"는 낡았다. shell.yaml req-0083, S8 2장은 Project Manager가 project마다 하나다. 위 목록은 후자를 따랐다.
2. **시각 블록.** `changes-by-topic.md` 4장은 shell/workspace에서 "시각 블록(MVP 밖)"을 뺀다고 하고, 5장은 lophn-agent/visuals(표·차트·앱 카드 블록)를 "그대로"로 둔다. 7장은 남는지 확인할 것이라 한다. `PRODUCT.md` 6절은 MVP가 "채팅 안에서 앱의 부품을 가져다 쓰는 데까지"라고만 한다. 표·차트·diagram 블록(`renderer/workspace/visuals/`의 `table-block`, `chart-block`, `diagram-block`, `chart-plan`)은 덜어낼지 둘지 목록에 넣지 못했다. 앱 카드 블록은 PRODUCT.md 문장대로 남긴다고 보았다.
3. **Lophn Workspace의 내용.** `removed.md` 4장은 "project 관심사가 없다"고 하지만, core-projects는 사람이 project를 등록·수정·보관한다고 하고 그 화면의 위치를 정하지 않는다. shell.yaml은 Workspace에 대해 Settings 하나(req-0060)만 말한다. Apps 화면(archive, restore, open)과 Projects 화면의 운명이 문서에 없다. 목록은 둘 다 남기고 안을 줄였다.
4. **Things to confirm.** `terms.md`는 "쓰지 않음(보류)"이고 req-1498은 모든 session의 대기 요청을 "한 목록"으로 본다고 한다. 그 목록이 어느 화면인지(Workspace 화면, 접이식 panel, 창 위 pill 등) 정해지지 않았다. 지금 Things to confirm 화면의 위치를 그대로 02가 쓴다고 보았다.
5. **changes.md의 event 개수.** 2장 event 줄에 "domain event … 10개"와 "event type 약 150개를 9개로"가 같이 있다. S1 5장·12장은 10개다.
6. **req-0073과 rail.** req-0073의 contains는 Terminal, Contexts, Saved views, Agent 넷이다. 코드 rail에는 Search가 더 있다. 모순은 아니지만 요구에는 없는 단추다.
7. **req-0065의 "component".** 요구는 "lophn scrollbar component"라고 쓰고, 코드는 `design/base.css`의 `::-webkit-scrollbar` 규칙으로 모든 scroll 영역을 그린다. 같은 파일 주석은 `scrollbar-width`를 어느 모듈도 쓰지 않는다고 하나 `renderer/workspace/tab-strip/tab-strip.module.css`가 `scrollbar-width: none`을 쓴다.

## 다른 영역에 넘긴 것

- 대기 목록 화면과 request 카드(approval 카드 포함), 결정 command: 02. `renderer/desktop/lophn-space/things-to-confirm/`, `renderer/conversation/approval-card/`, `renderer/confirmation/kinds/approval`.
- call chip, call 상태 보기, steer·다음 turn 입력, 메시지 전달 상태: 03. `renderer/conversation/delivery-state.ts`, `agent-composer.tsx`의 보내기 방식, `result-links.tsx`.
- `/` 메뉴, agent 설정 화면(Agents 탭·agent editor, 지침 [Instructions] 편집 공간), 질문 카드: 04. `renderer/conversation/slash-menu/`, `question-card/`, `renderer/workspace/agents/`, `renderer/editor/instructions-entry.tsx`와 `ipc/instructions.ts`·`main/editor/instructions.ts`, router의 `instructions` 공간.
- 앱 rewind 화면, 앱 화면을 project로 여는 길(req-1515): 05. `renderer/app-frame/app-detail/activity/`와 `renderer/conversation/rewind/`의 앱 쪽.
- 터미널 탭의 coding TUI, Settings coding agent 연결, [Start] 흐름: 06. `renderer/terminal/`, `terminal-host/`(coding-types, prompt-delivery, observe-socket), `main/terminal/coding/`, `main/desktop/coding-connection.ts`·`coding-ipc.ts`, `ipc/coding.ts`, `preload/coding-api.ts`, `renderer/desktop/lophn-space/settings/connections/`.
- activation 카드(`renderer/confirmation/kinds/release-activation`), 앱 Version 탭, Issues 탭(문제 화면), 시작 실패의 update 안내의 core 쪽: 07. `renderer/app-frame/app-detail/versions/`, `issues/`.
- 문서 편집기 본체(view bar, Outline 목록, Info 내용, 문서 탭 kind의 경로 대상), Context 탭(Overview, Contract, 위반, saved view, 용어집), 검색 탭, Settings 전체(일반, Providers, Agents, 도구와 skill, 진단, update·notification·backup 탭), session 목록(검색, 이름 바꾸기, archive, 지우기), session rewind 화면: 08. req-0070~0083, 0089, 0090의 화면 쪽.
- event client와 toast 반응 층, 어떤 event가 toast인지의 표: 01.
- coding agent 권한 요청의 터미널 탭 focus는 02·06과 같이(위 새로 만들 것).
- SDK가 요소에 붙이는 component 이름과 source 위치 표식(req-1487): sdk 영역.

## 확인 못함

1. **보호 입력의 모양.** secret 값을 renderer 밖에서 받는 일(req-0019)이 지금은 확인 창 안의 kind다. 확인 창을 지우면 보호 입력만 남는 창이 되는지, 다른 방식인지는 문서에 없다. 목록은 "창 없이 보호 입력만 남김"이라고만 적었다.
2. **현재 보기 relay의 범위.** 앱 화면 상태를 prompt에 넣지 않는다는 말(S4 6장)은 확인했다. 탭 단위 현재 보기(열린 탭, 선택한 문서 절)까지 agent에게 안 간다는 문장은 못 찾았다. core 쪽 소비자가 어디인지도 안 읽었다(`packages/protocol/shell/workspace.ts`가 route를 정의한다는 것만 봄).
3. **tray, 로그인 자동 시작, 명시 종료 확인, 전역 팔레트 shortcut, 단일 instance.** install-and-update 보류에 어디까지 들어가는지 정해진 문장이 없다. `main/desktop/tray.ts`, `autostart.ts`, `quit.ts`, `global-shortcut.ts`는 목록에 넣지 않았다. 단일 instance는 changes-by-topic이 보류로 적어 덜어낼 것에 넣었다.
4. **project 파일 검색 UI.** core-projects가 project의 text 파일을 훑는 검색을 요구하는데 shell.yaml에는 그 화면이 없다. 지금은 Documents 화면 search panel과 팔레트가 쓴다. 덜어낼 Documents 화면 뒤 어디에 두는지 못 정했다.
5. **앱 grant 화면.** shell.yaml에 grant를 보고 거두는 화면 요구가 없다. S2는 거두기가 있다고만 한다.
6. **renderer가 Gateway에 직접 붙는가, main이 중계하는가.** S1 8장은 "renderer의 WebSocket"이라고 쓰고, 지금은 token이 main에만 있다(`preload/core-api.ts` 머리 주석). 고칠 것 첫 줄은 어느 쪽이든 같은 일이라 갈라 쓰지 않았다.
7. **wording 미사용 key 수.** 505개는 key 문자열이 `packages`의 ts·tsx에서 한 번도 안 나오는 수다. 조합해서 만드는 key는 못 걸렀다.
8. **읽지 못한 곳.** `renderer/conversation` 안쪽 대부분(agent-core-source*, thread, activity)과 `renderer/editor` 본문, `renderer/terminal` 본문, `renderer/workspace/contexts` 85 files의 안쪽, `design/components` 상세는 머리 주석과 grep으로만 봤다. req-0091(내 메시지 오른쪽, agent 왼쪽·이름·profile)과 req-0092(별표 model 위로)는 코드에 이미 있다고 보았고(`message-list/turns.module.css`, `model-picker`, `agent-core-source-model.ts`), 동작을 돌려 보지는 않았다. req-0058~0068 중 0062(창 control), 0064(chrome 글자 선택 막기), 0067(가운데 column)도 코드에 이미 있는 것으로 보고 목록에서 뺐다(`desktop/top-bar/window-controls.tsx`, `renderer/chrome.css`, `design/components/page-frames`).
