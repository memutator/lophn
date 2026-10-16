# UI 전수 목록 (2026-10-15)

기준 코드: main `acfe4cc3`. 근거 설계: spec S1~S8(`specs/`), 요구(`../requirements/`), docs-review 2026-10-15, 확정한 결정 `inventory/00-decisions.md`. UI가 아닌 할 일은 `implementation-inventory.md`에 있다.

- `implementation-inventory.md` 4장(UI)을 떼어 냈다. 영역(01~12)이 아니라 화면으로 묶었고, 같은 일을 여러 영역이 적은 줄은 한 줄로 합쳤다.
- 확정한 결정을 줄마다 넣었다. 근거 칸의 `#36` 같은 번호는 `inventory/00-decisions.md`의 번호다. 그래서 옛 "판정 갈림", "확인 못함", "사람 확인 필요"는 대부분 닫혔다.
- 결정에 없던 것을 lead가 정한 곳에는 "(lead 추천)"을 붙였다.
- 화면의 작은 세부 가운데 refactor session이 정하기로 한 것(00-decisions C)은 "(세부는 refactor session)"으로 적었다.
- "지금 코드" 칸에는 대표 파일만 둔다. 전부는 영역 원본 `inventory/01~12`에 있다. 경로는 `packages/shell/renderer/` 아래면 앞을 줄였다.
- test는 전부 다시 쓰므로 세지 않는다.
- 6장은 wireframe 리뷰(2026-10-15)에서 사람이 정한 화면 모양이다. 모두 앱에 옮긴다. 1~3장의 줄과 겹치면 6장이 앞선다.

## 0. 한눈에

| 화면 | 덜어낼 것 | 고칠 것 | 새로 만들 것 |
|---|---|---|---|
| 공통(event, 대기 목록, 확인 창, 문구) | 8 | 7 | 9 |
| 대화 | 5 | 18 | 11 |
| project 화면 | 18 | 31 | 10 |
| 앱 공간 | 12 | 15 | 9 |
| Lophn Workspace | 12 | 10 | 3 |
| 런처, 시작 실패, 터미널 | 0 | 3 | 1 |
| 합계 | **55** | **84** | **43** |

옛 4장은 194줄(60, 84, 50)이었다. 여러 영역이 같은 화면을 적은 줄을 합치고, 결정으로 만들지 않게 된 줄(앱 상세의 activation 허락, secret 화면, 내장 skill 표시)을 4장으로 옮기고, 결정에서 나온 줄(새 탭 메뉴의 Agents 항목, secret 보호 입력, Apps 화면, Context 판 목록 등)을 더했다.

## 1. 덜어낼 것

### 1.1 공통

| 항목 | 근거 | 지금 코드 |
|---|---|---|
| notification chip(창 오른쪽 아래의 읽지 않은 notification 목록) | notification은 보류이고 보류는 코드도 지운다(#123~126). 사람을 부르는 일은 대기 목록과 toast가 맡는다(S1 8장, req-1498) | `desktop/notification-chip/notification-chip.tsx`, 마운트 `desktop/main.tsx`의 `NotificationChip`. 같은 폴더의 `space-decisions.tsx`(pill)는 고칠 것 |
| notification Ask toast(`AskAgentToast`), `NoticeAsk`, `AskView`·`AskRequest` | 부르는 곳이 test뿐인 죽은 코드다. agent 부르기는 반응 층이 맡는다(req-0085) | `desktop/notification-chip/ask-agent-toast.tsx`, `workspace/notice-ask.tsx`, `workspace/ask-view.ts` |
| Things to confirm 화면 전체(inbox, 지난 결정 목록, 기간 filter, notification 기록, 질문 묶음 카드) | 보류, 코드도 지운다(#123~126). 대기 목록이 대신한다(#28) | `desktop/lophn-space/things-to-confirm/`(test 밖 약 2,100줄, `question-group.tsx` 포함), `lophn-space/screens.ts`·`lophn-space.tsx`의 라우트 |
| 질문·approval·notification을 3초마다 훑는 polling | event client와 store 층이 대신한다(S1 8장) | `things-to-confirm/context.tsx`(`POLL_MS`, `intervalTicks`), `notification-chip/space-decisions.tsx`의 `useRequestOverview` |
| 확인 창 renderer 전체 | approval은 대기 목록 카드에서, 그 밖의 사람 결정은 각 화면 안에서 받는다. secret 보호 입력 하나만 남긴다(#25, #26). confirm은 없어지고(S5 9장) automation은 보류다 | `confirmation/`(35 files, 5.4k줄)의 `kinds/`(approval, grant, automation, confirm-command, connection-revoke, option-action, owner-decision, problem-decision, release-activation, rewind), `before-after/`, `build.ts`의 confirmation 항목, main 쪽 `shell/main/confirmation/kinds/`. `kinds/secret-input`은 고칠 것으로 옮긴다 |
| 확인 창 wording | 위와 같음 | `design/wording/en.ts`의 `confirmation-window.*` 가운데 approval, grant, release-activation, confirm, automation, account |
| 옛 dock, Roles, provider 계정의 흔적 | removed.md 1장. 화면 파일은 이미 없고 이름과 문구만 남았다. Providers 화면은 남고 계정 기능만 지운다(합1) | wording `roles.*` 298키(`roles.label.origin-handoff` 포함), `conversation.title.dock`, `settings.accounts.*`, 아이콘 `conversationIcons.dock`·`lophnSpaceIcons.roles`, `conversation/dock-retired_test.ts`, `question-strip-retired_test.ts` |
| 쓰는 곳 없는 wording key | AGENTS.md 호환성 절 | `design/wording/en.ts`(2,503키 가운데 505키: roles 298, settings 101, confirmation-window 49, conversation 20 등). 동적 key 조합은 세지 못했다 |

### 1.2 대화

| 항목 | 근거 | 지금 코드 |
|---|---|---|
| 질문 카드의 기한 표시, 추천 칸, Details, 고정 action 적용 상태(applying, applied, apply_failed), Skip | 질문에는 기한도 고정 action도 없다(S4 3장). Skip은 지우고, 답하지 않은 질문은 outcome으로 끝난다(#45) | `conversation/question-card/{model.ts,question-card.tsx,answered-summary.tsx}`(`expires_at`, `recommendation`, `AnswerSummaryStatus`, `onSkip`) |
| 표·차트·도표 시각 블록 | 앱 카드만 남긴다(#110) | `workspace/visuals/`의 표·차트·도표 블록, core `tools/visuals/`의 해당 tool. 앱 카드 블록은 남는다 |
| 시각 블록의 [Save as document], 저장 진행 표시(`SaveState`), 저장된 문서 링크 | `visual.prepare_document`와 문서 판이 없어진다(#110, removed.md 1장) | `workspace/visuals/block-frame.tsx`(`SaveState`, `SaveRequest`), `document-block.tsx`, `conversation/agent-view.tsx`의 `saveVisual`, `drafts.ts`의 `isSaveRequest`, wording `conversation.*save-visual*` |
| `/` 메뉴의 "같은 이름 skill 고르기"와 출처 라벨 | 같은 이름은 마지막 층이 덮는다(S4 2장) | `conversation/slash-menu/`(`choose_skill`, `skillOrigin`, `ORIGIN_LABEL`), `use-slash-menu.tsx` |
| session 목록의 Restore(되살리기) | 되살리기는 나중이다(S8 3장) | `conversation/header/session-popover.tsx`의 Restore·`onUnarchive`, `agent-header.tsx`, `agent-view.tsx`의 `unarchiveSession` |

### 1.3 project 화면

| 항목 | 근거 | 지금 코드 |
|---|---|---|
| agent editor의 "Built-in instructions (read only)" | role의 built-in 지침 글은 사람에게 보이지 않는다(docs-review 3장) | `workspace/agents/editor/agent-editor.tsx`(`builtInInstructions`, `builtInToggle`) |
| agent editor와 Agents 탭의 Permissions 칸 | 사람은 role의 tool 목록을 바꾸지 않는다(S4 2장). 넓히는 것은 agent grant 화면이다(새로 만들 것) | `agent-editor.tsx`(`PermissionsField`, `onTogglePermission`), `agents/agents-tab.tsx`(`PermissionRow`), `agents/core-source.ts`의 permissions 편집 |
| 새 탭(`+`) 메뉴의 Agents 항목 | 할당은 agent 설정 화면에 둔다. rail의 Agent 단추는 lophn을 연다(#34, #108) | `workspace/kinds/agents.tsx`(`labelKey`) |
| 버전 비교 화면 | 문서의 판이 없어진다(removed.md 1장) | `editor/compare/`(약 1,330줄), `document-view.tsx`의 `CompareView` 분기, `workspace.tsx`의 `compares`. 충돌 화면의 `compare` action은 남는다 |
| 판 복원(옛 판으로 되돌리기) | 위와 같음 | `document-view.tsx`(`restoreVersion`, `RestoreAnswer`), `save-state.ts`의 `keepMineAsVersion`, `shell/main/editor/restore.ts`(475줄), `EDITOR_RESTORE_CHANNEL` |
| 정보 패널의 버전 탭 | 위와 같음. 탭은 Info와 Contexts 둘이 된다 | `editor/versions/`, `editor/info-panel/info-panel.tsx`의 `VersionsTab`, `workspace.tsx`의 `versionsTick`·`showCompare` |
| 문서 머리 메타 줄의 판 번호 | 위와 같음. 메타 줄에는 저장 상태만 남는다 | `document-view.tsx`(`versionMeta`) |
| 편집기의 형식 문제 표시(problems gutter, 문제 목록) | documents/formats는 아예 덜어낸다(changes-by-topic 4장) | `editor/problems-gutter/`, `document-view.tsx`의 `saveProblems`, `live-preview.ts`의 문제 여백, 정보 패널의 `info-format` 줄 |
| 문서 링크 `[[` 선택기 | 문서 주소 체계와 함께 지운다(#98) | `editor/link-picker/`, `model.ts`의 `documentAddress`, `editor/core-source.ts`의 `documents.resolve` |
| file-tracking 안내 카드와 [Turn on tracking] | removed.md 1장(tracking 켜기, 포함, 제외) | `workspace/tracking/`(약 1,900줄), `workspace.tsx`의 `TrackingStrip`, `desktop/entry.tsx`·`main.tsx`의 `tracking` 통로. 읽기 실패 안내(`loaded.failed`)는 남는다 |
| Context 탭 머리의 [Ask Context Engineer]와 [History] | 화면마다 둔 agent 부르기 단추를 지운다(removed.md 1장). [History]는 지금 [Ask]와 같은 함수다. 판 목록은 새로 만든다(#106) | `contexts/context-frame.tsx`(`onAsk`), `context-tab-body.tsx`(`onHistory={onAsk}`), `kinds/context.tsx` |
| Search 하위 탭과 Search 탭의 [Ask …] | 위와 같음 | `contexts/context-search-list.tsx`, `search-tab*.tsx`, `search-input-form.tsx`, `kinds/search.tsx` |
| Contexts 탭의 [New context]와 안내 글 | context는 Project Manager가 `context.draft`로 만든다(#101) | `contexts/contexts-tab.tsx` |
| [New context] 뒤 agent 탭 열기, draft 탭, 만드는 중(drafting) 표시 | 만드는 중 화면은 지운다(#105) | `workspace.tsx`(`newContext`, `engineerTabOpen`, `expectDraft`), `contexts/context-drafting.tsx`, `context-drafting-model.ts`, `context-watch.ts`의 `onDrafting` |
| context 목록 30초 polling(context watch) | store 층이 목록을 들고, 위반 toast는 `ContextViolationFound`로 뜬다(S1 8장) | `contexts/context-watch.ts`, `workspace.tsx` 211~228 |
| 화면을 둔 채 다시 읽는 `stamp` 장치 | Context 탭은 열 때 읽는다(S1 8장) | `contexts/use-context-read.ts`의 `contextStamp`, `context-frame.tsx`의 `stamp` prop |
| 위반 목록의 "… is on it" 표시 | call의 진행을 사람 화면에 따로 보이지 않는다(S1 13장). (lead 추천) | `contexts/context-violations.tsx`, wording `contexts.label.violations-on-it` |
| 문구: tracking, 판·비교·복원·저장 주체·diff, context의 agent 부르기와 new context | removed.md 1장 | `en.ts`의 `project-workspace.tracking.*` 등 tracking 계열, `document.*` 가운데 compare·version·restore·saver·diff 약 60키, `contexts.button.frame-ask`·`frame-history`·`input-ask`·`tab-new-context`, `conversation.placeholder.new-context`, `settings.button.ask-lophn` |

### 1.4 앱 공간

| 항목 | 근거 | 지금 코드 |
|---|---|---|
| Automations 탭 | 앱 automation은 보류, 코드도 지운다(#123~126) | `app-frame/app-detail/automations/`, `app-detail.tsx`의 탭, `source.ts`·`core-source.ts`의 `automations`, wording `app-detail.*automation*` |
| Activity 탭의 automation·activation 호출자 문구 | 위와 같음 | `activity-tab.tsx`의 `whoText`(`by-automation`, `by-applying`), `model.ts` |
| Connections 탭의 앱 쌍 허락·회수 흐름과 4초 poll | 앱 쌍 허락은 없다(req-0916 rejected). 앱 grant는 activation에서 생긴다 | `app-detail/connections/connections-tab.tsx`(`POLL_MS`) |
| Tasks 탭 전부([Start] 화면, 새 Task, ticket 취소, 복사할 요청 문장, TUI 상태) | ticket은 사람 화면에 따로 보이지 않고(PRODUCT.md 4절, req-0754 폐기), 사람은 ticket을 만들지 않는다(#72) | `app-detail/tasks/`(9 files, 3.0k줄), `app-detail.tsx`의 탭, `app-space.tsx`의 `tasks`·`taskTarget`, `desktop/main.tsx`의 `codingTarget`, `shell/ipc/coding.ts`의 [Start], wording `app-detail.label.tab-tasks` 등 |
| coding 연결의 회수·취소·생성 링크 화면 | req-1213 | `desktop/coding-links/`(test만 있다), `settings-screen.tsx`의 `initialConnection` |
| Version 탭의 Task 확인 줄(`fact-task`)과 version ↔ ticket 읽기 | ticket은 사람 화면에 따로 보이지 않는다(PRODUCT.md 4절) | `versions/versions-tab.tsx`(`VersionFacts`의 task), `source.ts`(`TaskChecks`), `model.ts`(`taskChecksText`) |
| 준비됨·실패 Version의 [Use this version]과 "결정을 기다리는 중" | 준비만으로는 activate되지 않고 ticket 확인됨으로 시작한다(req-1507) | `versions-tab.tsx`(`choose`, `canUse`, `requested`), `app-detail/decision-end.ts` |
| Data 탭 전체(Export 단추와 준비·실패 문구 포함) | export는 모두 지우고, 남는 것이 형식 번호 한 줄뿐이다(#86) | `app-detail/data/data-tab.tsx`, `source.ts`의 `exportApp`, `core-source.ts`, wording `app-detail.button.export-app`·`app-detail.note.export*` |
| Issues 탭의 네 줄 구별(고쳤다는 주장, 실제 테스트, 내가 확인함, 미확인), repair ticket·claim 줄, `fixing` 상태, 닫힘 근거 4종 | 상태는 열림, 해결됨, 무시뿐이다(req-0154). 닫기 규칙은 지웠고(req-0730 폐기) ticket은 사람 화면에 보이지 않는다 | `issues/issues-tab.tsx`, `issues/model.ts`(`testTone`, `statusText`의 fixing), `issues/source.ts`(`IssueTestState`), `issues/core-read.ts` |
| Issues 탭의 fixed, not_fixed, not_visible 단추와 한 줄 이유 입력 | 위와 같음. 해결됨·무시 두 단추는 새로 만든다 | `issues-tab.tsx`(`choose`, `dismissing`, `note`), `issues/model.ts`(`choiceOptions`), `issues/source.ts`(`decide`) |
| [I tried it again] 단추 | 새 모델에 부르는 쪽이 없다(#87) | `issues-tab.tsx`(`tried`), `issues/report-again.ts`, `issues/source.ts`(`reportAgain`) |
| release 쪽 문구 | 위 줄들의 문구 | `en.ts`·`placeholders.ts`의 `app-detail.*`(version, issue, export), `confirmation-window.release.*` |

### 1.5 Lophn Workspace

| 항목 | 근거 | 지금 코드 |
|---|---|---|
| Documents 화면(틀, reader, 검색 panel) | Workspace에서 Documents를 뺀다. 문서는 project 화면에서 연다(removed.md 1장, req-0059) | `desktop/lophn-space/documents/`(약 1,700줄), `model.ts`의 `LOPHN_SCREENS` "documents", `screens.ts`, `desktop/router.ts`, `dev-mock/documents.ts`. 안의 검색 panel은 place·format·series로 거르는 문서 검색이라 새 키워드 검색과 다르다 |
| series 화면과 registry 화면 | removed.md 1장 | `desktop/lophn-space/series/`(약 1,100줄), `shell/main/editor/create.ts`, `EDITOR_CREATE_CHANNEL`, `editor/draft-document.ts`의 series 새 멤버 흐름 |
| 문서 정리(organize)와 export | removed.md 1장(export 전부, place 없는 문서, 문서 주소 체계). project 등록·수정·보관은 남는다 | `desktop/lophn-space/organize/`(`document-panel`, `steps`, `export-panel`), `projects/project-detail.tsx`의 `ExportPanel`·`DocumentPanel`, `shell/main/editor/place.ts` |
| Settings의 notifications panel | 보류, 코드도 지운다(#123~126) | `desktop/lophn-space/settings/` 아래로 보이나 위치를 확인하지 못했다 |
| Settings Update 탭 | install-and-update 보류, 코드도 지운다(#123~126) | `settings/update/`, `settings-screen.tsx`의 `UpdateSource` |
| Settings Backup 탭(복원 계획과 목록, secret export·import 창) | backup, restore, export는 모두 지운다(removed.md 1장) | `settings/backup/`, `settings-screen.tsx`의 `backup` prop(nav에서는 이미 숨김), `shell/main/desktop/core/restore.ts`·`restore-ipc.ts`, `shell/ipc/restore.ts`, `shell/preload/restore-api.ts`. 문서 판 복원(`main/editor/restore.ts`)과 이름만 같다 |
| Settings 진단 탭의 보안 점검(넓은 grant, 가리지 않은 key) | req-0457, 0460~0465 폐기 | `settings/diagnostics/`(`IMPACT`, `DiagnosticCheckName`, `wide_grant`, `raw_key`) |
| 설정 상세의 효력 시점 줄 | req-0351, 0379 폐기 | `settings/model.ts`의 `applyText`, `general/general-panel.tsx`의 applies, `source.ts`의 `ApplyAt` |
| 확장 설정 편집의 revision 비교 | req-0373 폐기 | `settings/extension-settings.ts`, `settings/core-source.ts`의 `applySetting(…revision…)` |
| Settings › Agents의 "Model for summaries" | req-0361 rejected | `settings/agents/agents-panel.tsx`(`DefaultSlot`의 `summaries`) |
| 문구: Workspace Documents와 series | removed.md 1장 | `en.ts`의 `documents.*` 99키(series 21키 포함, 근사값) |
| 문구: 문서 정리, export, place 단계 | removed.md 1장. project 이름, 목적, 보관 문구는 남는다 | `en.ts`의 `projects.*` 가운데 export, step, file·place·move·rename·document 계열 |

## 2. 고칠 것

### 2.1 공통

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| 화면이 core를 읽는 방식 | 화면마다 polling → event client 하나, store 층, 반응 층. component는 hook으로 store만 읽는다. 열린 대화 탭은 그 session의 agent event를 받고, 처음과 다시 붙을 때만 snapshot을 읽는다 | S1 4장, 8장 | `conversation/agent-view-data.ts`(3초), `app-detail/use-read.ts`(`pollMs`), `settings/connections/connections-panel.tsx`(3초), `terminal/terminal-tab.tsx` |
| event를 renderer로 넘기는 길 | main이 연결 상태만 민다 → event도 renderer에 닿게 한다(전달 방식은 refactor session) | S1 8장 | `shell/ipc/core.ts`(`CORE_STATE_CHANNEL`), `ipc/core-api.ts`, `preload/core-api.ts`, `desktop/connection/connection.ts` |
| 대기 개수 pill | 공간마다 "N decisions waiting"을 polling으로 세고 눌러 Things to confirm으로 감 → 대기 목록 store에서 센다(권한 요청, 질문, 보류 허락의 합). 누르면 창 위에서 대기 목록 panel이 펼쳐진다. core 끊김 안내는 그대로 | req-1498, #28 | `notification-chip/space-decisions.tsx`(`WaitingPill`, `SpaceDecisions`), 쓰는 곳 `launcher/launcher.tsx`, `launcher/project-card.tsx`, `workspace/workspace.tsx`, `app-frame/app-space.tsx` |
| overlay의 `notification` 표면 | 표면은 있는데 부르는 곳이 없다 → 반응 층의 toast를 그린다. launcher, Lophn Workspace, project, 앱 공간(native view 위 포함) 어디서나 뜨고 layout을 차지하지 않는다. 연결이 끊긴 사이 놓친 toast는 다시 띄우지 않는다 | S1 8장, req-0063 | `overlay/surfaces/surface.tsx`(`ToastStack`), `overlay/registry.ts`, `shell/ipc/overlay.ts`. `workspace/notice-card.tsx`는 event를 쓰지 않아 그대로 둔다 |
| secret 보호 입력 | 확인 창의 한 kind → 창 틀에서 떼어 shell main이 띄우는 보호 입력 하나로 둔다. provider 연결, MCP server credential, 앱 secret이 쓴다 | #25, #26, #122 | `confirmation/kinds/secret-input`, `shell/main/confirmation/kinds/` |
| route 모양 | `read: {document, version}`, `request`, `connection`, `taskTarget`, `issueProblem`, `instructions` → 문서 판, Things to confirm 링크, coding 연결과 ticket 링크가 빠진다 | removed.md 1·2장 | `desktop/router.ts`, `desktop/main.tsx`(`visit`, `confirmTarget`, `codingTarget`, `go`), `intents.tsx` |
| Workspace로 들어가는 단추 이름 | "lophn", "Open lophn" → Lophn Workspace | req-0058 | wording `launcher.button.lophn`, `common.button.palette-lophn`, `common.label.tray-open` |

### 2.2 대화

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| approval 카드 | [Allow ▾]·[Deny]를 눌러도 확인 창을 미리 고른 채 연다 → 카드에서 바로 결정한다. app-api와 MCP tool은 한 번, 이 session 동안, 항상, 거절(이유 입력 가능). 설정 고치기, activation, reaction은 허락과 거절. 선택지는 `allowSession` 플래그가 아니라 대상 종류가 정한다. 내용은 program이 intent에서 만든다 | req-0317, 0303, 0305, 0307, 0300, S2 6장 | `conversation/approval-card/`(`ApprovalChoice`, `allowSession`), `agent-view.tsx`·`agent-core-source*.ts`의 `onOpenConfirmation` |
| approval 카드의 결정 상태 | pending, granted, rejected, expired, cancelled를 한 가지로 그림 → 허락 접수와 적용 성공을 나누고, cancelled(원래 일이 끝남)를 거절과 나눈다. expired는 없다 | req-0312, 0315 | `conversation/approval-card`, `things-to-confirm/labels.ts`의 `statusOf` |
| 질문 카드 | 질문마다 header, 선택지 2~4개(label과 description), multiSelect, 화면이 늘 붙이는 Other. 답 상태는 answered와 unanswered, outcome은 submitted, cancelled, 사람 메시지. 기다리는 중 사람이 메시지를 보내면 카드가 "사람 메시지로 끝남"으로 접힌다 | S4 3장 | `conversation/question-card/*`(Other와 펼침 최대 3개는 지금도 있다) |
| 보내기 방식 | `SendMode = "request" \| "correction"` → 기본(다음 turn)과 steer. 코드 이름은 refactor session | req-1509 | `conversation/delivery-state.ts`, `drafts.ts`, `agent-view.tsx`, `agent-thread.tsx`, `agent-source.ts`, `agent-core-source*.ts` |
| composer의 보내기 선택 | 도는 중에만 "Change this work / Next request"가 보이고 Send 대신 Stop이 있다 → 기본은 다음 turn, steer를 고르면 도는 turn에 들어간다. 쉬는 중에는 늘 새 turn. 고르는 UI 세부는 refactor session | req-1509 | `composer/agent-composer.tsx`(`SEND_MODES`), wording `conversation.label.send-correction`·`send-request` |
| 내 말 옆 "Change" 표시 | → steer 표시 | req-1509 | `message-list/message-body.tsx` |
| rewind 안내 문구 | steer로 들어온 메시지는 checkpoint가 아니라 rewind에서 메시지만 복원된다는 문구 | #91 | `conversation/rewind/text.ts`, `agent-core-source-rewind.ts` |
| 대화 줄의 보낸 쪽 구별 | actor가 user, machine, agent 셋 → 다른 session, program, coding agent가 보낸 입력도 나눠 그린다 | req-1506, S1 8장 | `conversation/agent-thread.tsx`, `agent-core-source-thread.ts` |
| `/` 메뉴 | 전역 built-in 여덟 줄 → `recap`을 더한다. `permissions`는 agent grant와 이 session의 session 허락을 보인다(지금은 Agents 화면의 Permissions로 감). 도는 중의 "Not while … is working" 표시는 "다음 turn에 들어간다"로 | S4 7장 | `slash-menu/slash-menu.tsx`, `agent-core-source-commands.ts`, `agent-view.tsx` |
| 입력칸 아래 권한 요약 | place 권한 규칙과 이 session에서 Allow한 것, 누르면 Agents 화면의 Permissions → agent grant 요약과 이 session의 허락. 누르면 `/permissions`와 같은 보기 | S2 4장, S4 7장 | `composer/agent-composer.tsx`(`permissionSummary`, `onOpenPermissions`) |
| session rewind 화면 | 선택지 셋(`restore_all`, `messages_only`, `summarize`)과 확인 창 → 대화와 file tool로 바꾼 파일은 기본으로 함께 되돌린다. 고른 시점 뒤 이 session이 write한 앱을 앱마다 고른다. 함께 되돌아갈 다른 변경, external 효과, 되돌릴 수 없는 write를 먼저 보인다. 확인은 대화 화면 안의 panel에서 한다 | S8 4장, req-1519, #25, #54 | `conversation/rewind/rewind-menu.tsx`, `agent-core-source-rewind.ts`, `confirmation/kinds/rewind/rewind.tsx`(내용을 옮겨 옴), `agent-source.ts`의 `RewindChoice` |
| session 목록의 archive와 지움 | archive는 표시만 바꿈 → archive하면 입력을 받지 않는 상태로 보인다. 지움 확인 문구에 영향(열린 call이 실패함 등)을 넣는다 | S8 3장 | `header/session-popover.tsx`, `agent-header.tsx`, `agent-view.tsx`, `composer/` 입력 비활성 |
| closed session 표시 | assignment 회수로 닫힌 session의 `⋯` 메뉴 제한과 closed 표시 → 상태는 열림, archive, 지움 셋 | S8 3장 | `header/agent-header.tsx`, `workspace/agent/tab-fields.ts`, `agent-core-source-face.ts` |
| fork | 지금 동작(마지막 확정 메시지까지 복사)은 그대로 둔다. assignment 참조만 role과 place로 바꾼다 | #92, S8 5장 | `header/agent-header.tsx`의 `onForkSession`, `agent-core-source-commands.ts` |
| 대화의 문서 결과 링크 | `(document, version)`으로 열고 작업대 밖에서는 Documents 화면 → 파일 경로로 연다 | req-0001 | `conversation/result-links.tsx`, `desktop/main.tsx`, `workspace/kinds/host.ts`(`openResult`) |
| composer의 context chip | context 하나(id와 label)를 가리킴 → 위반의 파일과 규칙도 실을 수 있게 한다(위반 chip과 한 묶음) | req-0085 | `composer/agent-composer.tsx`, `workspace/kinds/agent.tsx`, `composer/types.ts`의 `ContextChipView` |
| role 이름이 나오는 대화 쪽 | `context_engineer` 값과 이름 → Project Manager | S4 11장 13 | `conversation/agent-source.ts`, `agent-core-source-values.ts`, `agent-core-source-face.ts` |
| 시각 블록의 앱 카드 | 표·차트·도표와 저장 단추가 빠진 뒤 앱 카드만 그린다 | #110 | `workspace/visuals/` |

### 2.3 project 화면

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| 계약 위반 toast | 작업대가 state로 들고 inline으로 그림, 30초 polling 비교로 띄움 → `ContextViolationFound`를 반응 층이 받아 overlay toast로. 문구 "N documents don't match", [View](Violations 하위 탭), [Ask Project Manager]. 누르면 reaction이 이미 연 그 project의 Project Manager session으로 가고, reaction이 꺼져 있으면 그때 새로 연다. 위반(파일과 규칙)이 붙는다 | S1 8장, req-0083, 0085, 0086, #100 | `contexts/violation-toast.tsx`, `workspace.tsx`(`openRole("context_engineer", chips)`, `toasts`) |
| role 이름 Context Engineer | 문구 18곳("Ask/Send to Context Engineer", "Kept up to date by Context Engineer", "Context Engineer is drafting" 등)과 `context_engineer` 값 → Project Manager. sidebar 순서와 앱 title bar의 거르기 규칙도 새 이름으로. shell에서 test 밖 약 32개 파일 | S4 11장 13 | `design/wording/en.ts`, `sidebar/agents-section.tsx`, `app-frame/agent-select.tsx`, `agents/agents-tab.tsx`, `settings/agents/agents-panel.tsx`, `contexts/context-glossary*.ts*`, `contract-details.tsx` |
| sidebar의 Agents 묶음 | assignment 기준(lophn, Context Engineer, Operator) → lophn(전체에 하나), Project Manager(project마다 하나), Operators | S8 2장, req-0084, 0035 | `sidebar/agents-section.tsx`(`SidebarAgentRole`, `asg_`), `agents/sidebar-agents.ts`, `workspace.tsx`의 `openRole` |
| 접힌 sidebar rail | → Terminal, Contexts, Saved views, Agent, Search. Search는 project 파일 검색을 연다. Agent는 lophn을 연다 | req-0073, 0074, #97, #116 | `contexts/shortcut-rail.tsx`(`RAIL_ACTIONS`), `workspace.tsx`의 rail 처리 |
| sidebar의 문서 목록 | 폴더 아래 "문서로 잡힌 파일"과 따로 `documents.list` 기반 Documents 묶음 → 등록 폴더의 디스크 파일 tree 하나 | req-0001, 1471 | `sidebar/sidebar.tsx`(Folders, Documents), `workspace/source.ts`(`DocumentRow`, `FileRow.document`), `workspace/core-source.ts`(`FILE_DOCUMENT_LIMIT`) |
| 문서 탭이 여는 대상과 탭 key | 문서 ID(`doc_…`)가 key이고 `documents.list`에 잡힌 문서만 연다 → 파일 경로가 key이고 project 안팎 어느 파일이든 연다. 이미 열려 있으면 고르기만 하는 규칙은 같다 | req-0001, 1474 | `kinds/document-editor.tsx`(`DOC_ID`, `openDocument`), `editor/document-view.tsx`(`documentId`), `workspace.tsx`(`openPath`) |
| 문서 읽기 | `documents.get`·`documents.read`를 12,000 codepoint page와 cursor로 판에 고정해 읽음 → 디스크 파일을 한 번 읽는다. 읽고 쓰는 길은 refactor session | req-0001 | `editor/core-source.ts`, `editor/source.ts`(`DocumentInfo.version`, `BodyState`), `editor/model.ts`(`joinPage`) |
| Outline 목록 | core의 `outline.document`를 page로 이어 부름 → 화면이 가진 본문에 공용 md parser를 쓸 때마다 부른다(편집 중에도 갱신). parser는 하나로 합친다 | req-0002, 0003, 1484, 1485, #99 | `editor/core-source.ts`(`outline`), `document-view.tsx` |
| 읽기 위치 기억의 section key | outline route의 key → parser의 key | 위와 같음 | `document-view.tsx`, `kinds/document-editor.tsx`(`readPosition`) |
| 문서 탭이 다루는 확장자 | Markdown 전용, 그 밖은 `unsupported` → 확장자로 viewer를 고른다. 흔한 text 파일은 열고 고치고, 이미지와 pdf는 보기만(새로 만들 것과 한 묶음) | req-1474 | `editor/markdown-editor.tsx`, `live-preview.ts`, `preview.ts`, `document-view.tsx` |
| 저장 흐름과 저장 상태 | 디스크 저장, 기록 확인, version 확정, 형식 검사를 따로 기억하는 5단계 상태와 "version 준비 경계" → 디스크 저장과 충돌만. 저장 중 수와 창 닫기 guard는 남긴다 | removed.md 1장, req-0001 | `editor/save-state.ts`(689줄), `save-status.tsx`, `notice-bar.tsx`, `sessions.ts`, `leave-dialog.ts`, `shell/main/editor/file-adapter.ts` |
| 충돌과 밖에서 바뀐 파일 | `against: "disk"`와 `"newest"`, "내 것을 새 판으로 남기기" → `"disk"`만. 밖(다른 편집기, git)에서 바뀌면 고치지 않은 파일은 다시 읽어 새 내용을 보이고, 고치는 중이면 충돌을 알리고 어느 쪽을 남길지 고르게 한다 | req-1523, removed.md 1장 | `editor/conflict/`(`conflict-view.tsx`, `compare.ts`), `document-view.tsx`, `notice-bar.tsx` |
| 정보 패널 위치 | 작업대에 하나 있는 패널 → 문서 탭 안 오른쪽에 열리고 다른 탭에는 보이지 않는다 | req-0070 | `info-panel-slot/info-panel.tsx`, `workspace.tsx`(`infoOpen`, `infoPlacement`), `workspace/model.ts` |
| 정보 패널 Info 탭 | 파일 경로, 원본 연결, 보관, format, 판 번호·주체·개수 → 판, format, 원본 연결 줄을 뺀 파일 정보. 보일 것: 경로, 크기, 바뀐 시각 (lead 추천) | req-0070, removed.md 1장 | `editor/info-panel/info-panel.tsx`, `versions/source.ts`의 `DocumentFacts` |
| 문서 탭의 판 hint와 pending | 탭이 판을 알아야 hint를 낸다 → 판 조건을 뺀다 | removed.md 1장 | `kinds/document-editor.tsx`, `kinds/host.ts`, `workspace.tsx` |
| 지침 [Instructions] 진입 | 전역, project, 앱 세 층의 지침을 연결된 문서 ID로 풀어 열고, 없으면 빈 draft를 편집기가 붙든다 → project의 `LOPHN.md`는 일반 파일이라 일반 문서 탭으로 연다. 전역 지침은 남고, 앱 층 진입은 지운다 | req-0036, 0095, S4 5장, #49 | `editor/instructions-entry.tsx`(414줄), `editor/draft-document.ts`, `desktop/main.tsx` |
| Context 탭 읽기 시점 | 하위 탭이 mount 때 읽고 `stamp`가 바뀌면 다시 읽음 → 열 때 읽는다 | S1 8장 | `contexts/use-context-read.ts`, `context-frame.tsx`, `context-overview.tsx`, `context-violations.tsx`, `context-glossary.tsx`, `contract-details.tsx` |
| context 목록의 공급원 | `useContextWatch`의 목록을 Contexts 탭, 팔레트, sidebar, 대화의 context 링크 이름, 탭 복원이 씀 → store 층의 목록 | S1 8장 | `workspace.tsx` |
| Contexts 탭 카드 | [New context]를 뺀 나머지(이름, 목적, 개체 종류 수, 적용된 판과 검사 결과, 위반 수, [Open])가 남는다. 보관은 사람이 이 화면에서 한다. Operator 수는 refactor session | #101, #104 | `contexts/contexts-tab.tsx`, `contexts-tab-load.ts`, `contexts-tab-rows.ts` |
| 위반 목록의 [Send to …]와 [Send all …] | Context Engineer에게 넘김 → 위반 근거를 붙여 그 project의 Project Manager에게 넘긴다. 열린 session이 있으면 그 session이다. 목록은 읽기, 파일 열기, 넘기기만 | 합4, #100, req-0083 | `contexts/context-violations.tsx`(`handOff`), `contexts/source.ts`(`handOffViolations`), `contexts/core-source.ts` |
| Search 탭이 context에 묶임 | layout이 `context`를 필수로 갖고 없으면 Contexts 탭이 대신 열림 → project 키워드 검색은 context 없이 열린다 | req-0069, 1480, 0078 | `kinds/search.tsx`, `contexts/settle-tabs.ts` |
| 팔레트의 문서 묶음 | `documents.search` 결과를 문서 ID와 판으로 열고 Documents 화면 reader로 보냄 → 파일 경로와 줄로 연다 | req-0001, core-projects 검색 | `desktop/palette/search.ts`, `lophn-scope.ts`(`LophnTarget` kind `document`), `workspace-scope.ts`, `palette/model.ts`(`DocumentFound`) |
| Agents 탭의 lophn 카드 | project Agents 탭이 lophn, Context Engineer, Operator 카드를 보임 → lophn은 전체에 하나라 전역 쪽에서 설정한다. Project Manager 카드는 project마다 하나 | S4 2장, req-0030 | `agents/agents-tab.tsx`, `agents-page.tsx`, `editor/agent-editor.tsx`(`projectName`) |
| agent editor의 지침 블록 | 늘 project `LOPHN.md` 첫 4줄 → project 지침과 그 agent의 지침을 같이 보인다. lophn에는 project 지침이 없다. App Engineer는 앱 source가 속한 등록 project의 것 | S4 5장, req-0095, 0037, #37 | `editor/agent-editor.tsx`(`ProjectInstructionsView`), `agents-page.tsx` |
| Skills 칸(agent editor, Agents 탭, Settings 전역) | 이름과 켬·끔인데 project 층 스위치(`setSkill`)가 `unavailable`이라 눌러도 바뀌지 않음 → 층마다 켬·끔이 실제로 바뀐다. 내장 skill은 지금 없다 | req-0098, S4 2장, #40 | `agents/core-source.ts`(`setSkill`), `agents-page.tsx`, `editor/agent-editor.tsx`(`SkillsField`), `settings/agents/agents-panel.tsx` |
| agent editor의 MCP 칸 | 서버 이름의 켬·끔만 → agent 층에서 서버를 붙일 수 있다(새로 만들 것의 폼) | S4 2장 | `editor/agent-editor.tsx`(`mcpServers`) |
| Models 줄(Agents 탭 "Models for this project"의 role별 줄) | role마다 model → role별 줄은 지운다. model은 전역 기본과 agent 설정에서 고른다. project 층 model 하나를 둘지는 req-0038(층에 model이 든다)과 S4 2장 표(전역 기본과 agent 설정)가 다르게 읽힌다. (lead 추천: req-0038대로 project 층 하나를 두고 S4 표를 맞춘다) | #36, req-0038, 0039, 0360 rejected | `agents/agents-tab.tsx`, `agents-page.tsx`(`changeRoleModel`) |
| 정의 저장 안내 문구 | "Agent definitions are stored in lophn, not in your project folder."는 남기되 lophn은 전역 한 곳이라는 점이 달라진다 | req-0034 | `agents/agents-tab.tsx` 마지막 줄 |
| profile 이미지 | route는 있는데 renderer가 `uploadImage`, `imageSrc`를 비워 둠 → 잇는다 | req-0040 | `agents/core-source.ts` |
| Operator 만들기와 목록 | assignment 기반 → 사람이 만든 Operator를 project나 앱에 놓는다 | req-0031, 0032, S8 2장 | `agents/agents-tab.tsx`, `agents-page.tsx`, `agents/core-source.ts` |
| 코드 이름 `workspace/`와 Lophn Workspace | project 화면 코드 이름이 `workspace/`인데 화면 말 Lophn Workspace는 project 밖 공간이다(코드는 그 공간을 `lophn-space`로 부름). 코드 이름은 refactor session | req-0058 | `renderer/workspace/`, `desktop/lophn-space/` |

### 2.4 앱 공간

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| 앱 운영 패널의 탭 | 8탭(Version, Access, Automations, Connections, Activity, Data, Issues, Tasks) → Automations, Data, Tasks를 덜고 Version, Access, Activity, Issues가 남는다. Connections는 Access에 합친다 (lead 추천: 둘 다 같은 앱 grant다) | 1.4의 덜어낼 것, #35 | `app-detail/app-detail.tsx`, `ops-panel-frame.tsx`, `app-space.tsx` |
| Access 탭(앱 grant) | 범위별 승인(파일, host, secret 이름), 앱 쌍 허락, 회수 → 앱이 activation 때 허락받은 바깥 자원과 다른 앱 app-api를 보이고 거두는 것만. 만드는 것은 activation이다. 거두기는 요청 접수와 실제 정리(이전 process 종료 확인)를 나눠 보인다 | S2 4장, req-0860, 0873, 0915, #35 | `app-detail/access/access-tab.tsx`, `connections/connections-tab.tsx`, `source.ts`·`model.ts`의 `GrantRow`·`ACCESS_GROUPS` |
| Activity 탭 행 | 호출자 `direct/agent/app/automation` → 사람 화면, agent session(눌러서 그 session으로), 다른 앱. project, 효과(read, write, external), 되돌림됨을 보이고, 기다리는 write는 대기로. 지금 release의 live write, external, 앱 시작 행에 rewind 시작 단추 | S5 5장, 7장, 11장 3 | `activity/activity-tab.tsx`, `source.ts`(`ActivityRow`), `core-source.ts`(`activityOf`), `model.ts` |
| 앱 상세 wording | 호출 문구(`did-action`, `by-*`, `mode-*`)와 결정 종류 안내 → 새 호출자 종류로. confirm과 automation 언급은 지운다 | S5 9장 | `en.ts`, `placeholders.ts`의 `app-detail.*` |
| Version 탭의 Version 카드 | 사람이 [Use this version]을 누르는 목록 → activation 진행 상태(적용 중, 적용됨, 적용 실패와 이유)를 보이고, 사람은 이전 release로 돌아가기만 누른다. 상태 문구는 refactor session | req-1507, 0830, S7 8장 | `versions/versions-tab.tsx`(`VersionCard`, `VersionFacts`), `app-detail/model.ts`(`versionStatusText`, `appliedText`) |
| Version 탭의 "what changes" | automation, problem 경고, confirm, revert 변화까지 셈 → 지운 칸을 걷고, 대기 목록 카드와 같은 비교(늘어난 선언과 손실 단계)를 쓴다 | S7 6장, #84 | `versions-tab.tsx`(`Changes`), `app-detail/model.ts`, `core-source.ts`(`compare`) |
| Issues 탭 상태 이름과 색 | open, fixing, closed → 열림, 해결됨, 무시. 목록 한 줄은 영향 한 문장과 상태 | req-0154 | `issues/model.ts`(`statusText`, `statusTone`), `issues-tab.tsx`(`IssueItem`) |
| Issues 탭 상세 | 영향, 접수 수, 지금 누가 무엇을 하는지, 네 줄 → 접수 수, 처음과 마지막 시각, 발생 목록, 근거(원래 source 위치의 stack, log, release와 commit, 제보 글) | req-0152, 0109, 1359 | `issues-tab.tsx`(`IssueBody`), `issues/core-read.ts`, `core-source.ts`, `issues/source.ts` |
| Issues 목록 | 한 앱의 목록 하나 → 상태와 기간으로 거른다 | req-0152 | `issues-tab.tsx`(`IssueList`), `issues/source.ts`(`list`) |
| 제보 dialog | 글과 화면 상태·screenshot 미리보기, 항목별 체크 → 글만 보낸다. 새 문제가 되거나, 사람이 고른 기존 문제의 발생이 된다(기존 문제 고르는 칸을 더한다). screenshot과 화면 상태는 뺀다. annotation은 따로 App Engineer에게 간다. 접수 문구는 선언 문구 대신 이름과 message | req-0172, #88 | `overlay/feedback/feedback-dialog.tsx`, `app-frame/report-button.tsx`, `shell/main/app-frame/feedback.ts`(캡처), `shell/ipc/feedback.ts`, `shell/preload/feedback-api.ts` |
| project 안에서 앱 열기(앱 패널 탭) | 앱 패널은 앱, 판, mode만 안다 → 앱 view를 열 때 그 project를 함께 넘긴다 | req-1515 | `workspace/app-panel-tab.tsx`, `app-frame/embedded-view.tsx`, `app-views.tsx`, `shell/ipc/app-frame.ts`(`AppViewOpen`) |
| 앱 place에서 앱 열기(앱 공간) | project 없이 열림 → project가 정해지지 않았으면 shell이 화면 안에 project 고르기를 띄운다(새로 만들 것). 현재 project를 어디에 보일지는 refactor session | req-1515, #58 | `app-frame/app-space.tsx`, `app-bar.tsx`, `view-chrome.tsx` |
| 앱 화면 안 문서 보기 slot | 문서 `version`을 싣고 판을 고정해 엶 → 판 칸 없이 파일 경로로 연다 | removed.md 1장, req-0001 | `app-frame/document-view-slot.tsx`, `protocol/shell/app-frame.ts`의 `documentViewOpenSchema` |
| title bar의 agent select | assignment 기준, `context_engineer`를 거르는 코드 → 그 앱 place의 agent(lophn, App Engineer, Operators). Manage 항목은 유지 | req-0087, S8 2장 | `app-frame/agent-select.tsx`, `app-agents.ts`, `agent-pane.tsx` |
| SDK `CommandButton`의 확인 표시 | `confirm`이면 방패 아이콘, hover 문구("lophn asks you before this runs."), "Waiting for your confirmation." → 모두 없애고 pending(시계 아이콘, `aria-busy`)과 실패 문구만. `data-confirm`도 지운다 | blueprint `confirm` 칸 삭제(S5 9장) | `sdk/ui-action/command-button.tsx`, `use-command.ts`, `guide.md`, `examples/order-actions.tsx`, wording `common.notice.asks-first`·`waiting-confirmation` |

### 2.5 Lophn Workspace

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| Workspace의 화면 구성 | Projects, Documents, Apps, Things to confirm, Settings(기본 화면 Documents) → Projects, Apps, Settings. 기본 화면도 바꾼다 | req-0059, 0060, #115 | `lophn-space/model.ts`(`LOPHN_SCREENS`, `DEFAULT_SCREEN`), `screens.ts`, `sidebar/sidebar.tsx`, `lophn-space.tsx`, `palette/lophn-scope.ts` |
| Projects 화면 | tracking 상태와 미리보기, 문서 정리, slug 이름 칸 → 목록, 그리고 등록, 수정(이름, 목적, 폴더, 폴더 설명), 보관, 다시 꺼내기. 이름은 하나만 둔다 | req-1473, req-0060, #96, #115 | `lophn-space/projects/projects-screen.tsx`, `project-detail.tsx`, `organize/model.ts`의 slug 규칙 |
| Apps 화면 | → 목록, 그리고 보관과 다시 꺼내기만 | req-0060, #115 | `desktop/lophn-space/` 아래 apps 화면 |
| Settings General 탭 | 읽기 전용 목록(값, 효력 시점, 기본값, 출처) → 선언한 항목을 타입(불리언, 숫자 범위, 선택지, 목록)대로 보고 바꾸는 한 화면. 사람이 정한 값만 저장하고 기본값과 나눠 보인다. 틀린 값은 거절 이유를 보인다. 지침, skill, Operator 정의 같은 내용물과 창 크기 같은 상태는 여기 두지 않는다 | req-0350, 0356, 0365 | `settings/general/general-panel.tsx`, `settings/model.ts`(`generalRows`, `SHOWN_ELSEWHERE`), `source.ts`(`SettingRow`), `core-source.ts`, `use-reload.ts`, `extension-settings.ts` |
| 설정을 따로 읽는 화면 | reading width가 `settings.get/apply`를 revision과 함께 부름 → 선언 모델의 읽기와 쓰기. OS notification 설정은 보류라 지운다 | req-0350, #123~126 | `editor/reading-width.ts`(`coreSettingsPort`), `shell/main/desktop/os-notification.ts` |
| Settings › Agents의 Default models | role 4줄 → 전역 기본 하나 | #36, req-0360 rejected | `settings/agents/agents-panel.tsx`, `core-source.ts`, `settings-source.ts`, `model.ts` |
| Settings coding agent panel | 감지한 harness를 골라 이름과 범위로 연결을 만들고 회수, 재설치, doctor 네 단계를 보임 → 제품마다 실행 파일, version, 로그인, turn 끝 신호 있음·없음, skill 설치 실패를 보인다. 첫 prompt를 넘길 수 없는 제품은 "맡길 수 없음"으로 보인다. 기본 실행 옵션(제품, model 등)을 정한다. 연결 만들기, 범위, 이름, 회수 단추와 doctor 단계는 뺀다. [Detect again]은 남는다 | req-1054, 1078, 1080, S6 2장 1, #62 | `settings/connections/`(`connections-panel.tsx` 631줄, `model.ts`, `source.ts`, `core-source.ts`) |
| Settings coding의 IPC와 source | connect, revoke, install 통로 → 감지 읽기, 다시 감지, skill 설치, 기본 실행 옵션 | 위와 같음 | `settings-screen.tsx`, `lophn-space.tsx`, `desktop/main.tsx`, `entry.tsx`, `shell/ipc/coding.ts`(`connect_with_harness`, `scopeSchema`), `shell/preload/coding-api.ts` |
| coding 문구 | `settings.label.coding-*`, `harness-*`, 설치 단계 문구 → 위 panel의 새 항목 | 위와 같음 | `en.ts`, `placeholders.ts` |
| Settings 진단 panel | doctor 결과와 보안 점검 → 구성 요소마다 지금 쓸 수 있는지, 안전한 불가 이유, 실제로 점검한 시각. 사람이 누를 때 점검하는 방식은 유지. 진단 route를 제품에 등록한다 | req-0459, #121 | `settings/diagnostics/`, core `platform/status` |

### 2.6 런처, 시작 실패, 터미널

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| 런처 project 카드와 등록 dialog | 카드에 tracking 상태, 패턴과 gitignore 줄, 문서 수, project id 줄. 등록 dialog는 짧은 이름(slug)이 겹치지 않게 고름 → 그 줄들과 slug 고르기를 뺀다. 이름, 폴더, 폴더 설명 입력은 남는다 | req-1473, removed.md 1장, #96 | `launcher/project-card.tsx`, `launcher/model.ts`, `register-dialog.tsx`(`takenNames`, `shortNameOf`), `launcher/core-source.ts`, `dev-mock/launcher.ts` |
| 시작 실패 화면 | 연결 실패를 모두 `failed-start`로 그림. schema 비호환 화면은 있는데 쓰지 않음 → 높은 schema, hash가 다른 이력, 손상 원본 세 경우에 "원본을 그대로 두고 시작하지 않았다"와 update 안내 | req-0054 | `launcher/launcher.tsx`, `launcher/start-failure/`, `connection/connection.ts`(`failed-schema`), `shell/ipc/core.ts` |
| 터미널 탭이 coding TUI를 보이는 모양 | 사람이 연 shell 탭뿐이고 coding 표지(`TerminalCoding`)를 renderer가 쓰지 않음. 끝나면 "새 [Start]만" → App Engineer가 연 탭은 제목으로 구별된다. 끝나면 session이 끝난 상태로 보이고 다시 시작은 없다(새 맡기기만) | S6 2장 5, 8장 | `terminal/terminal-tab.tsx`, `exit-banner.tsx`, `store.ts`, `model.ts`, `shell/main/terminal/supervisor.ts`, `shell/ipc/terminal.ts`(`TerminalCoding`) |

## 3. 새로 만들 것

### 3.1 공통

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| event client | renderer당 연결 하나. 아래 층들이 선언한 구독 조건을 합쳐 Gateway에 건다. 끊기면 다시 붙고 snapshot부터 읽는다 | S1 8장, 12장 | renderer 새 모듈(위치는 code-map)과 main 중계(token이 main에 있다). 전달 방식은 refactor session |
| store 층 | event로 상태를 고친다. 처음과 다시 붙을 때 read로 snapshot을 읽는다. store 셋: session 목록과 상태, 대기 목록, 열린 대화 탭의 session별 agent event. 대기 목록 store는 `PermissionRequested`, `PermissionResolved`, `ApprovalRequested`, `QuestionAsked`, `QuestionResolved`로 고치고, 구독은 종류만으로 모든 session | S1 8장, req-1498 | renderer 새 모듈 |
| UI용 hook | component는 hook으로 store만 읽는다. event도 연결도 모른다 | S1 8장 | renderer 새 모듈 |
| 반응 층 | event를 넣으면 반응 목록이 나오는 순수 함수. 권한 요청, 허락 요청, 질문 → 대기 목록과 toast(사람이 그 session을 보지 않아도). 그것의 해결 → 대기 목록에서 뺌. session 시작·끝·상태 → session 목록. `AppRestartHalted` → toast. `ContextViolationFound` → toast(누르면 Project Manager). 그 밖의 domain event → 반응 없음 | S1 8장, req-0083, 0085, 0086, 1495 | renderer 새 모듈 |
| 대기 목록 panel | 창 위 pill에서 펼친다. 모든 session의 대기 권한 요청, agent 질문, 보류 허락 요청을 한 목록에 종류를 나눠 보인다. 목록에서 답하면 turn이 이어 가고 activation은 이어 실행된다. coding agent의 권한 요청은 누르면 그 session의 터미널 탭으로 focus가 간다. 답은 harness TUI에서 하고, harness마다 다른 물음 모양은 UI에 두지 않는다. 다시 붙을 때 snapshot으로 맞춘다 | req-1498, 1495, S1 8장, S2 6장, S6 2장 5, #28 | pill(`space-decisions.tsx`)에 붙는 새 component |
| 보류 request 카드 | activation 허락: 이전 활성 release보다 늘어난 선언(network host, secret, 파일, 다른 앱 app-api 쓰기)과 손실 단계(지우는 표나 칸, 좁히는 type)만 보이고 허락·거절. 첫 activation이면 선언 전부가 늘어난 것이다. 물음인 reaction: 어떤 domain event로 어떤 agent session을 열지 보이고 허락·거절 | req-0300, 0825, 1520, S7 6장, #84 | 대기 목록 안. 옛 `release-activation.tsx`의 비교 그리기를 참고만 한다 |
| turn 안 request 카드의 내용 | 대상(app-api, MCP tool, 설정 고치기 파일), 정규화한 입력, 효과를 program이 만든 문구로 보인다. 요청한 agent가 쓴 설명은 보이지 않는다 | req-0300 | approval 카드와 대기 목록의 내용 model |
| 거절 이유 입력 | 거절할 때 이유를 적을 수 있다(안 적어도 된다). 적으면 요청한 agent의 tool 결과로 간다 | req-0307 | 카드 |
| toast 문구와 "눌러서 agent 부르기" | 권한 요청, 허락 요청, 질문, 앱 재시작 멈춤 toast의 wording key(지금은 위반 toast key뿐). 위반 toast는 눌러야만 Project Manager session으로 간다 | S1 8장, req-0085, 0086, #100 | `design/wording/`, 반응 층의 눌렀을 때 동작을 `workspace/kinds/agent.tsx`의 `openAgent`와 앱 공간 agent pane에 잇는다 |

### 3.2 대화

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| 받은 메시지의 보낸 쪽 chip | call, reply, reaction, coding agent 메시지에 보낸 쪽(agent role과 이름, program과 사건, coding agent)을 chip으로 붙인다 | req-1506, S3 5장 | `conversation/message-list/`, `agent-thread.tsx` |
| chip을 누르면 여는 panel | 맡긴 글, 근거 링크(ticket, problem, 파일 경로), 보낸 session 링크(눌러 그 session 탭을 연다)를 call 읽기 route로 읽어 보인다 | req-1506 | chip 옆. 읽기는 `agent-core-source*.ts` |
| 보낸 session의 call 블록 | 일반 tool 한 줄 대신 call 블록: 받는 곳, 맡긴 글 한 줄, 답 방식. 누르면 그때의 상태(accepted, done, failed와 이유, cancelled)를 읽는다. 상태가 바뀌어도 따로 알리지 않는다 | req-1506, S3 5장, S1 8장 | `conversation/activity/`(지금 `tool-line.tsx`) |
| 답과 실패 메시지 이어 붙이기 | 보낸 session에서 답과 실패가 그 call에 이어진 새 메시지로 보이게 `reply_to`로 묶는다 | req-1506 | `message-list/turns.tsx` |
| call 취소 단추 | 끝나지 않은 call을 사람이 취소한다. 위치는 refactor session | req-1503 | call 블록 근처 |
| call 문구 | 위 component의 문구와 상태 이름. 화면에 `call`, `accepted` 같은 안쪽 낱말을 그대로 내지 않는다 | `design/wording/rules.ts` | `design/wording/en.ts` |
| `/recap` | session을 짧게 요약해 화면에 보이고 이력은 그대로 둔다 | S4 7장, 11장 7 | `conversation/agent-view.tsx`의 builtin 분기. 요약 model 호출은 core |
| session 허락 보기 | `/permissions`가 그 agent의 agent grant와 이 session에서 "이 session 동안"으로 허락한 대상을 보인다 | S4 7장, req-0318 | 대화 화면 |
| archive된 session 읽기 전용 | archive된 session을 열면 기록만 보이고 입력칸이 없다 | S8 3장 | `conversation/agent-view.tsx` |
| session rewind의 앱 고르기 | 고른 시점 뒤 이 session이 write한 앱마다 write 목록과 함께 되돌아갈 다른 변경을 보이고 고르게 한다 | req-1519, S8 4장 | `conversation/rewind/` |
| 위반 chip과 기다리는 coding 맡기기 표시 | Project Manager 대화가 파일과 어긴 규칙이 붙은 채로 열린다(사람이 글을 쓰지 않는다). 그 앱의 줄에서 기다리는 coding 맡기기가 session 목록에 보인다 | req-0083, 0085, S6 2장 2 | composer chip, session 목록 |

### 3.3 project 화면

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| agent grant 할당 화면 | agent 설정 화면에서 사람이 agent에게 앱(앱 하나 = 그 앱의 app-api 전부), 외부 MCP tool, 부를 수 있는 다른 agent, 설정 고치기를 붙이고 대상마다 묻는지를 정한다. 효과별 기본값(read·write 묻지 않음, external·설정 고치기 물음)을 보이고, app-api마다 빼거나 묻는지를 바꾼다. 새 release가 더한 app-api는 기본값으로 들어왔다고 보인다 | req-1493, S2 4장, #34 | `workspace/agents/` agent editor |
| 내장 skill 표시 | Project Manager의 Skills 칸에 context-init과 context-update가 내장 표시로 보이고, 끌 수 없어 스위치 대신 "Built-in"이 보인다 | req-1525, req-0098 | `workspace/agents/` agent editor, Agents 탭 |
| agent 층 MCP server 붙이기 | agent editor에서 서버를 더하는 폼 | S4 2장 | `workspace/agents/editor/`(지금 전역·project 폼 `extensions/server-form.tsx`가 있다) |
| 확장자별 viewer 고르기 | 파일 확장자로 viewer를 고른다. md는 지금의 live preview 편집기 | req-1474 | `editor/document-view.tsx`가 md 전용이라 앞에 viewer 고르는 층을 새로 둔다 |
| text 파일 편집기 | JSON, YAML, 코드 같은 text 파일을 열고 고친다. CodeMirror 언어 팩을 더한다 | req-1474 | `renderer/editor/`(CodeMirror는 이 폴더에만) |
| 이미지·pdf viewer | 열어 보기만 한다. 바이트를 renderer에 넘기는 통로가 필요하다(지금 `ipc/editor.ts`는 8MB 글 전용) | req-1474 | `renderer/editor/` |
| project 밖 파일 열기 | OS dialog나 팔레트 입력으로 아무 경로나 문서 탭으로 연다 | req-1474 | 탭 key가 경로가 되는 일과 한 묶음 |
| project 키워드 검색 | rail의 Search가 연다. 검색어, 폴더 하나로 좁히기, 결과를 경로 순·줄 순으로, 일치한 부분이 든 snippet, 결과를 눌러 그 줄에서 파일 열기 | req-1476~1480, #97, #116 | `kinds/search.tsx`. 지금 Search 탭은 context에 선언한 검색만 그린다 |
| 줄 번호로 문서 열기 | 검색 결과의 줄로 읽기 모드에서도 scroll한다 | req-1479 | 지금은 편집 모드의 `revealLine`(`markdown-editor.tsx`)뿐 |
| sidebar의 saved view 목록 | project 화면 sidebar에서 saved view 이름을 눌러 결과를 연다 | req-0082 | sidebar. 지금 rail의 "Saved views"는 Search 탭만 연다 |
| Context 탭의 판 목록과 되돌리기 | context의 판 목록을 보이고 사람이 옛 판으로 되돌린다 | req-0022, #106 | Context 탭 머리([History]가 있던 위치) |

### 3.4 앱 공간

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| annotate mode | 앱 공간 바에서 켜고, 요소를 클릭하거나 영역을 끌어 고르고, 고른 곳마다 메모 칸이 붙는다. 모은 annotation을 보고 지우고 한 번에 보낸다. 고른 곳의 screenshot을 main이 뜬다. 보낸 annotation은 그 앱의 App Engineer session 메시지가 된다. source 위치를 얻는 방식은 refactor session | req-1486, 1487, 1488, #88 | `app-frame/app-bar.tsx`, `embedded-view.tsx`, `view-chrome.tsx`, `shell/main/app-frame/`(view capture). 지금 shell에 annotate 코드는 없다 |
| 앱 rewind 확인 panel | Activity 탭 안 panel. 고른 invocation부터 최신까지 함께 되돌아갈 목록(시각, 효과, 누가 한 호출인지)을 보이고, external은 "되돌아가지 않음", 결과를 모르는 write는 "되돌릴 수 없음"으로 표시한다. 그 앱을 쓴 모두의 변경이 함께 사라진다는 안내. 사람이 확인해야 시작하고, 사람만 한다 | S5 7장, 10장, 11장 1, #25, #54 | `app-detail/activity/` |
| rewind 진행과 결과 | 접수를 닫고 도는 호출을 기다리는 동안의 상태, 붙잡힌 호출 안내, 충돌로 통째로 취소된 이유, 성공 뒤 갱신 | S5 7장, 11장 2 | 위 panel |
| invocation 세부 | project로 거르기, 한 invocation의 세부(부른 쪽 session·turn·tool call, 입력 지문, 결과 요약, 되돌림 기록) | S5 5장, req-0894 | Activity 탭 |
| 앱 place에서 project 고르기 | 앱 place에서 연 앱 화면이 project를 정하지 못했으면 shell이 화면 안에 project 고르기를 띄운다. 목록은 core에서 받는다 | req-1515, #58 | `app-frame/app-space.tsx` |
| 이전 release로 돌아가기 단추 | 대체된 release 가운데 지금 data schema와 같은 것에만 켜진다. 다르면 꺼지고 이유를 보인다. 사람만 누른다. 돌아간 뒤 DB는 그대로라고 알린다 | req-0832, 0961, S7 8장 | `versions-tab.tsx`의 `VersionCard` |
| activation 진행과 실패 | 사람이 시작하지 않는 activation이라 "적용 중", 실패 이유, 이전 release로 남아 있음을 보인다. 실패는 App Engineer가 이어 받는다고 알린다 | req-0830, S7 7장 | `versions-tab.tsx`(`VersionFacts`의 `failure`, `data-apply-failed`를 넓힘) |
| 문제의 재발 표시 | 해결됨이던 문제가 다시 열린 것을 나눠 보인다. 이전 해결 시각과 다시 난 release | req-0168 | `issues-tab.tsx`(`IssueItem`, `IssueBody`) |
| 문제의 해결됨·무시 단추 | 사람이 상태를 바로 바꾼다. 확인을 묻지 않는다 | req-0154, #27 | `issues-tab.tsx` |

### 3.5 Lophn Workspace

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| Settings의 reaction grant | 새 일을 여는 domain event 다섯(문제 열림, 문제 다시 열림, 앱 반복 종료, activation 실패, context 위반)마다 끔, 묻지 않음, 물음을 고른다. 기본은 열고 묻지 않음. call을 닫는 event는 항목이 없다 | req-1494, S2 4장, 8장 | `settings-screen.tsx`의 nav 한 항목과 새 panel |
| 필수 설정이 비었을 때의 안내 | 그 기능만 시작하지 않는다는 상태와 고르러 가는 길 | req-0366 | Settings와 그 기능 화면 |
| 폴더를 찾을 수 없음 | 등록한 폴더가 사라지면 "찾을 수 없음"으로 보이고, 사람이 새 위치를 골라야 이어진다 | req-1472 | `lophn-space/projects`, `shell/ipc/folder-picker.ts` |

### 3.6 터미널

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| lophn이 여는 터미널 탭 | 사람이 누르지 않고 core 요청으로 열린다. 그 앱의 앱 공간에서 열고 focus를 옮기지 않으며 toast로 알린다. 사람이 그 탭에 focus해 있으면 lophn은 메시지를 넣지 않고 기다린다. 탭 key와 `terminal_ref`는 main이 정한다 | S6 5장 4, 7장, req-1091, #70, #71 | `workspace/kinds/terminal.tsx`, `shell/main/workspace/kinds/terminal.ts`(layout이 `project_folder`뿐), `terminal/store.ts`(`request`가 사람 클릭만 받음) |

## 4. 만들지 않는 UI

| 항목 | 근거 |
|---|---|
| notification 기록과 읽음, OS notification, notification chip | 보류, 코드도 지운다(#123~126). toast는 renderer 정책이다(S1 8장) |
| Things to confirm 화면 | 보류. 대기 목록이 대신한다(#28) |
| 앱 automation 화면 | 보류 |
| Settings Update 탭 | install-and-update 보류 |
| 표·차트·도표 시각 블록 | MVP 밖. 앱 카드는 남는다(#110) |
| `@me/` package로 UI 부품을 고치는 흐름 | 사람 확인이 없었다(#111, #113) |
| session 되살리기 | 나중이다(S8 3장) |
| 사람용 package 화면 | 요구가 없다(req-1001) |
| secret을 모아 보이는 화면 | 요구가 없다. 입력은 보호 입력뿐이다(#122) |
| 앱 상세의 activation 허락 | 대기 목록 하나면 된다(#29) |
| Tasks 탭과 사람이 ticket을 만드는 화면 | ticket은 사람 화면에 따로 보이지 않고 사람은 App Engineer에게 청한다(PRODUCT.md 4절, #72) |
| ticket, claim, call 진행을 사람 화면에 따로 보이는 것 | S1 13장 |
| harness의 권한 물음에 lophn 화면에서 답하기 | S6 11장. 대기 목록은 보이기만 하고 터미널 탭으로 보낸다 |
| 화면마다 둔 agent 부르기 단추 | removed.md 1장. 남는 것은 위반 toast와 위반 목록의 [Send to …]다 |
| context 만드는 중(drafting) 화면 | #105 |
| 문서의 판, 비교, 복원 | removed.md 1장 |
| project 검색의 취소, snippet redaction, 건너뛴 파일 알림, 50개씩 이어 보기 | req-1481~1483 폐기 |
| 놓친 toast 다시 띄우기 | S1 8장 |

## 5. 순서 제약 (UI 쪽)

| 먼저 할 것 | 그 뒤에 할 것 | 근거 |
|---|---|---|
| event client, store 층, 반응 층, 새 대기 목록 | Things to confirm 화면, notification chip, 3초 polling, context watch 30초 polling 삭제 | 01, 02, 09 |
| renderer event client와 Gateway | shell main의 `events.list` 따라잡기 삭제 | 01 |
| 새 질문 tool과 `QuestionAsked`·`QuestionResolved`, 새 대기 목록 | `question-group.tsx`와 질문 카드 옛 모양 삭제 | 04, 02 |
| secret 보호 입력을 창 틀에서 떼고, `confirmation: "required"`를 쓰는 route 12개의 확인 handle을 정리 | 확인 창 main과 renderer 전체 삭제 | 02, 09 |
| 앱 rewind panel과 session rewind의 앱 고르기 | `confirmation/kinds/rewind`와 session rewind의 옛 앱 단계 삭제 | 05, 08 |
| shell main `refreshAppViews`를 대신할 신호(남지 않는 event로 앱 view에 알림, #17) | `GrantCreated`·`GrantRevoked`·`ReleaseActivated` event 삭제 | 01 |
| 앱 화면 byte(`/screens`)를 내주는 새 길(refactor session) | 앱 직접 통로 삭제 | 05 |
| blueprint `confirm` 칸 삭제 | SDK `CommandButton`의 확인 표시 삭제(같이 한다) | 02, 12 |
| 지침 진입을 일반 문서 탭으로 바꾼다 | `editor/draft-document.ts`의 series 흐름 삭제(이 파일은 지침 첫 저장에도 쓰인다) | 09, 10 |

## 6. wireframe 리뷰에서 정한 화면 (2026-10-15, 사람 확정, 앱에 옮긴다)

wireframe gallery(`tools/wireframes`, artifact "lophn wireframes")의 새 설계 part를 사람이 다섯 번 보고 정한 것이다.
- **모양의 정본은 gallery다.** 줄마다 "본보기"에 그 모양을 그린 gallery 파일을 적었다.
- **옮길 곳.** design 쪽은 `packages/design`(component, token)이고, 창과 화면 쪽은 `packages/shell/renderer`다.
- **옮기는 방식.** gallery는 실제 component를 감싸거나 CSS로 덮어서 그렸다. 앱에서는 그 component 자체를 고친다.

### 6.1 모든 화면의 규칙

| 규칙 | 본보기 | 옮길 곳 |
|---|---|---|
| 토글과 행동 단추는 줄 오른쪽 끝의 고정 열에 둔다. 이름 길이와 상관없이 같은 위치다. form의 Save·Cancel, 카드의 Open·Archive, toast 단추도 오른쪽 끝이다 | `agent-setup/parts.tsx`(skill·MCP 줄), `workspace/general-pane.tsx` | 각 화면 |
| 탭 본문의 내용은 최대 폭을 둔 기둥을 가로 가운데에 놓는다 | `context-body.tsx`, `agent-setup/agent-editor.tsx` | 각 화면 |
| 고른 탭과 탭 본문은 배경이 같아 하나로 보인다. 본문 안에 배경색이 다른 넓은 영역을 두지 않는다. image, pdf, terminal의 바탕도 같다 | `project-files/viewers.tsx`, `app-space/coding-tab.tsx` | 각 화면 |
| 탭 안 알림은 그 탭의 위쪽 toast로 띄운다. 색 다른 띠나 상자는 쓰지 않는다 | `project-files/notices.tsx`, `contexts/tab-toast.tsx`, `app-space/toast.tsx` | design `Toast`와 각 화면 |
| design `Toast`는 행동 단추를 오른쪽 끝에 둔다(지금은 왼쪽). gallery에는 worker들이 따로 만든 look-alike가 넷 있다. 하나로 합친다 | `waiting/waiting-toast.tsx`, `app-space/toast.tsx` | `packages/design/components/toast` |
| 글을 넣는 칸(input, textarea, select)은 focus 때 바깥 outline을 띄우지 않고 칸 테두리 색만 `--color-focus`로 바뀐다 | `frames/chrome/chrome.css` | design `Input`, `Textarea`, `Select` |
| harness(Claude Code, Codex, Gemini CLI, OpenCode, pi, Hermes, OpenClaw)와 provider 이름 옆에 vendor 아이콘을 붙인다. 아이콘 출처는 `@lobehub/icons-static-svg`(MIT)다 | `frames/vendors/` | Settings, 터미널 탭, 대기 목록, model picker, 보낸 쪽 chip |
| 파일과 폴더에는 종류 아이콘을 붙인다. 출처는 `@iconify-json/catppuccin`(MIT)이다. 색은 light에서 Latte, dark에서 Macchiato다 | `frames/chrome/file-icon.tsx`, `chrome.css` | 파일 tree, 파일 탭, 새 탭 menu |
| menu 항목에는 아이콘을 붙인다 | `project-files/menu-icons.tsx` | 각 menu |

### 6.2 창 크롬

| 정한 것 | 본보기 | 옮길 곳 |
|---|---|---|
| 창 위쪽 바는 36px다(지금 48px). 창 단추는 46px이고, 닫기 단추는 올리면 빨간 바탕(#c42b1c)에 흰 아이콘이다 | `frames/chrome/title-bar.tsx`, `title-bar.module.css` | `packages/shell/renderer/desktop/top-bar/` |
| 위쪽 바 오른쪽 묶음은 창 단추 바로 옆에 붙는다. 명령 palette 단추는 돋보기 대신 ⌘ 아이콘이다 | 같음 | 같음 |
| sidebar 머리는 위쪽 바와 높이가 같고 경계선이 한 줄로 이어진다. 경계선은 겹치지 않는다 | `project-window.tsx`, `workspace-page.tsx` | shell sidebar |

### 6.3 탭 줄

| 정한 것 | 본보기 | 옮길 곳 |
|---|---|---|
| 탭 줄은 component 하나(`TabStrip`)다. project 창과 앱 공간 pane 머리가 같이 쓴다 | `frames/chrome/tab-strip.tsx` | shell `workspace/tab-strip`, `app-frame` |
| 모양은 아이콘과 이름, 고른 탭 아래 3px 밑줄, 상자 없음이다. 탭 이름 오른쪽의 종류 글자(Document editor, Agent 등)는 없다 | 같음 | 같음 |
| 파일 탭 아이콘은 파일 종류 아이콘, agent 탭 아이콘은 그 agent의 profile 아이콘, coding 터미널 탭 아이콘은 harness vendor 아이콘이다 | `project-window.tsx`(`TabBar`) | 같음 |

### 6.4 project 창

| 정한 것 | 본보기 |
|---|---|
| sidebar 맨 위에 밑줄 글자 탭 Explorer / Context / Agent를 둔다. 한 번에 하나만 보인다 | `project-files/explorer.tsx` |
| Explorer: 루트는 한 줄 머리(`▾ PHRONER`)이고, menu로 연결 폴더와 하위 폴더(req-1524)를 골라 바꾼다. tree에 파일 종류 아이콘을 붙인다 | `project-files/explorer.tsx`, `file-tree-data.ts` |
| Context: contexts 목록과 saved views | `project-files/pages.tsx`(`ContextSidebar`) |
| Agent: agent마다 열린 session을 들여 써 보이고, 맨 아래에 Recent session 몇 개를 둔다 | `project-files/agent-panel.tsx` |
| 새 탭(+) menu 항목과 하위 menu에 아이콘을 붙인다 | `project-window.tsx`(`TabMenu`) |
| 문서 탭: 파일 지우기 확인은 화면 가운데 modal이다. 편집 중에는 focus 테두리가 없다. 정보 panel은 위 border가 있는 overlay다. view bar는 경로 없이 한 줄이다. 밖에서 바뀜과 충돌은 탭 위쪽 toast다 | `documents.tsx`, `project-files/` |
| 용어집: 머리 줄(Glossary, 용어 수, 오른쪽 끝 [Add term])을 둔다. 더하기와 고치기는 그 줄에서 바로 한다(Enter·✓ 저장, Esc·× 취소). Edit과 Delete는 hover 때 보이고, 지우기 확인은 modal이다 | `contexts/glossary.tsx` |

### 6.5 Agent 탭과 대기 목록

| 정한 것 | 본보기 |
|---|---|
| composer에 보내기 방식 menu는 없다. 일하는 중 보낸 메시지는 composer 위 Next turn 줄에 쌓이고, 줄의 [Send now]가 steer다(req-1509) | `agent-tab/queued.tsx`, `agent-chat.tsx` |
| 질문 카드는 한 번에 질문 하나를 보이고 ‹ 1 of N ›로 넘긴다 | `agent-tab/cards.tsx` |
| agent header 위에 여백을 둔다 | `agent-chat.tsx` |
| `/` 명령 창은 아이콘, 이름, 설명이 한 줄인 얇은 행이고 묶음은 선으로 나눈다 | `slash-menu.tsx` |
| model picker에는 안내 문구가 없다. 고른 model의 variant만 보인다. model을 바꾸면 새 model의 기본 variant로 조용히 맞춘다. provider 요청 오류는 대화 안 메시지와 [Retry]로 보인다 | `model-picker.tsx`, `agent-tab/error-message.tsx` |
| 대기 목록: pill은 위쪽 바 안에 있다. 항목 세부는 기본으로 접는다(제목, 한 줄 설명, 단추만). 단추는 오른쪽 끝이다 | `waiting/` |

### 6.6 앱 공간

| 정한 것 | 본보기 |
|---|---|
| 앱 화면은 위쪽 바 아래 전체를 쓴다. 탭 줄이 없다 | `app-space/space.tsx` |
| agent와 앱 상세는 앱 화면 옆 pane이다. coding 터미널은 그 pane 머리의 탭으로 바꿔 본다 | `app-space/side-pane.tsx` |
| 위쪽 바 오른쪽은 아이콘 단추만 둔다. 순서는 [Annotate, Report(깃발)] \| [Agent ▾, 앱 상세] \| ⌘이고, 켜진 것은 눌린 모양이다 | `app-space/space.tsx` |

### 6.7 Lophn Workspace

| 정한 것 | 본보기 |
|---|---|
| sidebar 줄(Projects, Apps, Settings와 하위 항목)은 40px 높이로 넉넉하게 둔다 | `workspace-page.tsx` |
| Settings 항목은 sidebar의 Settings 아래에 아이콘과 묶음으로 들어간다. 묶음은 General(General, Appearance), Agents(Providers, Agents, Tools and skills, Coding agents), System(Reactions, Diagnostics)이다. 고른 줄은 둥근 배경이고, Settings 안에 둘째 목차 열은 없다 | `workspace/settings-shell.tsx` |
| Appearance: Theme(Light, Dark, System이 기본), Text size, Reading width, Density | `workspace/appearance-pane.tsx` |
| Projects: 목록의 마지막 카드 아래에 동그란 + 단추로 등록한다. 등록 폴더 아래에 하위 폴더가 중첩으로 보인다(req-1524). Folders 머리 아래에 여백을 둔다 | `workspace/projects-screen.tsx` |
