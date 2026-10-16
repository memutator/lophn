# cleanup-dead

모든 단위가 merge된 뒤, 어디서도 쓰지 않는 옛 protocol, 옛 route, 옛 schema step, 쓰는 곳 없는 file과 export, 쓰는 곳 없는 wording key를 지운다. 새 설계에서 안 쓰게 된 것만 지운다. 새 코드는 만들지 않는다.

- 단위: cleanup (wave 4)
- 선행: 없음 (wave 4는 wave 0~3이 모두 merged이고 통합 gate(`../orchestrator.md` 8장)가 끝난 뒤에만 열린다. cleanup task끼리는 이 task가 먼저다)
- 소유(이 task만 고친다):
  - `packages/` 전체, `tools/` 전체 (저장소 전체. cleanup은 혼자 돈다)
  - 고치지 않는 것: `deno.json`, `deno.lock`, 각 package의 `deno.json`, `packages/shell/main/package.json`의 `dependencies`, `AGENTS.md`, `project-docs/`. 지울 의존성은 보고에 목록으로 쓴다.
- 읽을 것:
  - inventory(lead가 맞추며 더함): `I1.1#9`
  - 계획: `../README.md` 2.7의 "청소", 3장(계약 결정), 1장 규칙 3(옛것과 새것이 잠시 같이 있어도 된다. 옛 계약은 여기서 지운다)
  - dev: `/home/pyosechang/projects/lophn/project-docs/dev/code.md` "호환성", "주석과 죽은 코드"
  - inventory: 없음 (`../assignment.md`에서 cleanup은 줄 배정이 없다. 지울 대상은 `/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md` 1장 "덜어낼 것"에 적힌 옛 이름과 path를 후보 근거로 쓴다)
  - 지금 코드: `packages/`, `tools/`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음 (지우기만 한다)

## 할 일

1. **기준선**: `deno task check:full`이 통과하는지 본다. 통과하지 않으면 이 task를 시작하지 않고 보고한다. 부팅 확인도 한 번 해 둔다 (`/home/pyosechang/projects/lophn/project-docs/plan/tasks/core-wiring-trim.md` 1번의 명령).
2. **후보를 찾는 임시 script를 scratchpad에 만든다** (저장소에 넣지 않는다). 도구는 `grep`과 `deno info --json`이다.
   - **쓰는 곳 없는 export**: `packages/protocol/**`, `packages/core/**`, `packages/shell/ipc`, `packages/shell/preload`, `packages/coding-agent/**`, `packages/base/**`에서 `export (const|function|type|interface|class|enum) <이름>`과 `export { ... }` 이름을 뽑고, 정의한 file 밖(test 아닌 코드)에서 단어 경계로 한 번도 나오지 않는 것을 모은다. `mod.ts` 같은 재내보내기는 한 겹 따라간다. 지우고 나면 새로 쓰는 곳이 없어지는 것이 생기므로 후보가 0이 될 때까지 되풀이한다.
   - **쓰는 곳 없는 file**: 아래 root 목록에서 `deno info --json <root>`로 닿는 module을 모두 모으고, `git ls-files 'packages/**/*.ts' 'packages/**/*.tsx' 'tools/**/*.ts'`와 견줘 닿지 않는 file을 후보로 한다.
     - root: 각 process의 entry (`packages/core/main/{daemon/main,daemon/io-entry,worker/*,agent-runtime/main,app-supervisor/main}.ts`), `packages/shell/main/entry.ts`·`build.ts`, `packages/shell/renderer/**/build.ts`가 bundle하는 entry들, `packages/shell/preload`, `packages/shell/terminal-host/cli.ts`, `packages/coding-agent`의 CLI entry, `tools/*.ts`, 각 package `deno.json`의 `exports`, `packages/core/main/daemon/assembly.ts`
     - 문자열로만 이어지는 module도 root다. `grep -rn "new URL(\|import(" packages tools`로 찾는다 (`teamModules` URL, `register.ts`, `reader-registration.ts`, 설정 module, worker entry, `registration` 파일들).
   - 후보마다 `grep -rn "<file 이름 또는 export 이름>" packages tools`로 문자열 참조(route 이름, event 이름, schema table 이름, wire 이름)가 있는지 본다. 있으면 후보에서 뺀다.
3. **지운다.** 후보 묶음마다 `deno task check`가 통과한 뒤 commit한다 (메시지: `Remove unused <대상>`). 우선순위는 이렇다.
   1. `packages/protocol`: 계약 단위가 새것 옆에 두었던 옛 type·schema·route·event 정의. `ROUTES`/`ALL_EVENTS`/`ALL_ROUTES` 같은 목록에서 빠진 것과 그 목록 항목 중 handler·client·구독자가 없는 것.
   2. `packages/core`: 위 정의를 쓰던 command·read·handler·store와, 그것만 쓰던 module. event 이름이 문자열로 남은 schema step의 표(예: 더 이상 읽지도 쓰지도 않는 표)는 schema step 자체를 지운다. 개발 data는 schema가 바뀌면 지우고 새로 만든다(`code.md` "호환성"). migration을 만들지 않는다.
   3. `packages/shell`: 쓰는 곳 없는 IPC channel(`packages/shell/ipc`, `preload`, main의 handler, renderer의 호출), 쓰는 곳 없는 component와 CSS module.
   4. `packages/coding-agent`, `packages/base`, `tools`: 쓰는 곳 없는 export와 file. `tools/fake-provider`와 `tools/wireframes`는 gallery가 쓰는 것만 남긴다. `tools/wireframes/frames`의 compositions는 `pages.ts`에서 닿지 않으면 후보다.
   - **지우지 않는 것**: `packages/sdk/*`의 공개 export(앱이 import한다). 지금 코드에서 쓰는 곳이 없어도 SDK 입구는 남기고, 인벤토리에서 지우기로 한 것(`cap-schedule`, `DocumentAddress`, `CommandButton`의 확인 표시)만 이미 지워졌는지 본다. `packages/design/components`의 공개 export도 같다.
4. **쓰는 곳 없는 wording key를 지운다.** `wording-split`의 방법과 같다. `packages/design/wording/catalog/*.ts`의 key 가운데 `packages/`(`packages/design/wording/` 밖)에서 글자 그대로도, 동적 이어 붙이기로도 나오지 않는 것을 지운다. 대표적인 후보: `common.button.copy-address`, 지워진 화면(things-to-confirm, notification, documents, Tasks, Automations, Data, 확인 창의 approval·grant·release-activation·confirm·automation·account)이 쓰던 key, `settings.coding-agent.*`의 MCP 안내와 `task`·`coding` 옛 문구. 지운 뒤 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 영역별 생성물을 다시 만들고 `--check`를 통과시킨다.
5. **의존성 후보를 모은다.** 지우고 나서 `packages/**/deno.json`의 `imports`와 `packages/shell/main/package.json`·`packages/shell/renderer` package 설정의 의존성 가운데 어떤 `.ts`/`.tsx`도 import하지 않는 것을 찾아 보고에 쓴다 (예: 문서 format 쪽 `quickjs-emscripten`, `parse5`, `picomatch`, `@std/yaml`이 남았는지). 이 task는 `deno.json`·`deno.lock`을 고치지 않는다.
6. `tools/check-wording.ts`가 `RESERVED_PROBLEM_CODES`(problem code의 message key)를 알려진 key로 넘기고 있다. problem code와 그 key를 쓰던 화면이 지워졌으면 그 입력과 import를 걷는다.
7. 빈 폴더, 이름만 남은 `testdata/` 폴더, 지운 module을 가리키던 `guide.md`·README 안의 목록을 정리한다 (주석 속 문서 가리킴은 `cleanup-comments`가 한다).
8. (lead가 맞추며 더함 (`I1.1#9`)) 앱·release·ticket·context의 상태 event. 읽는 곳이 모두 빠진 뒤 옛 상태 event 정의를 지운다

- (lead가 더함, wave 3 보고 모음) shell preload `shell.ts`의 `openConfirmation`·`onConfirmationEnded`·`confirmWithoutWindow`와 `preload/confirmation-open.ts`·`confirmation-ended.ts`·`confirmation.ts`, `ipc/windowless-confirmation.ts`, `ipc/confirmation-channels.ts`의 open·display·submit·cancel·ended 채널과 `ipc/confirmation.ts`의 `DECISION_HANDLE_CHANNEL`·`decisionHandleRequestSchema` 밖의 것, `protocol/shell/confirmation.ts`의 창 열기 쪽. `WorkspaceSource.documents`·`DocumentRow`, `AgentTab`의 `hint` prop, `workspace/model.ts`의 `splitPane`, gallery `project-files` css 일부와 `compose.module.css`의 sidebar·rail 규칙. app-detail 옛 wording key(automation, task, confirm, test 줄, `tab-connections`). run-loop `mod.ts`의 별칭 블록, `scope.ts`(`computeAgentAppScope`), tools의 `listTools`·`executeTool`·`RunCredential`, `tool-judgment`·`Toolkit.binding`·`McpToolkit.connectionRevision`. 주석의 "confirmation window"(`main/desktop/wiring/feedback.ts`, `main/app-frame/{feedback,app-call}.ts`, `main/workspace/current-view.ts`)와 `wiring/app-calls.ts`의 "confirmation is not ready".

- (lead가 더함) `desktop/notification-chip/space-decisions.tsx`(`SpaceDecisions`, `WaitingPill`, `useRequestOverview`)는 app space와 launcher가 그만 쓰면 지운다. `contexts/violation-toast.tsx`. screens-agents-editor의 안 쓰는 wording key 24개(`project-workspace.` 아래 agent-editor·model·permission 계열, 보고 원문은 docs-review). `models.ts`의 role별 slot 넷. gallery `agent-setup/settings-agents.module.css`는 `settings-agents.tsx`가 지워질 때 같이.

- (lead가 더함, places-sessions-projects·app-calls-shell 보고) `protocol/projects/projects.ts`의 `projectSchema`·`userProjectSchema`·`agentProjectSchema`·`projectCreateInputSchema`·tracking 계열·`PROJECT_EVENTS`와 project event 다섯. `protocol/projects/project-routes.ts`는 `projectResolveCwd`만 남긴다. app frame의 `ConfirmGate`·`SignedProof`·`Invoker`·`InputRules`·`nodeUpstream`·`screenPath`·`SOCKET_HOST`·`CONNECTION_RENEW_MS`·`ClosedView`·`connectCommands`·`checkConnectOutput` 남은 것.

- (lead가 더함, screens-workspace-settings 보고) wireframe `workspace/data.ts`의 `CODING_PRODUCTS`·`REACTIONS`·`DIAGNOSTICS`와 `workspace.module.css`의 옛 pane 규칙. `workspace-settings` 옛 key(`apply-*`, `tab-update`, `tab-notifications`, `backup.*`, `update.*`, `coding-scope-*`). fake 예시용 설정 이름·설명 key(`agents.model.catalog_auto_update`, `agents.run.max_tool_calls`, `agents.run.max_minutes`, `agents.run.on_limit`, `projects.search.skip_patterns`, `agents.run.fallback_model`)는 실제 선언이 없으면 지운다.

- (lead가 더함, platform-desktop 보고) `electron-builder.yml`의 `protocols: lophn`과 `x-scheme-handler/lophn`(URL scheme 처리는 코드에서 지웠다). shell allowlist `READING_WORKER_ROUTES`의 없는 route 넷(`outline/document`, `documents/read`, `documents/export`, `search/query`). `ipc/shortcuts.ts`의 `ConfirmTargetIntent`·`CodingTargetIntent`·`DESKTOP_INTENTS`의 `things-to-confirm`, `protocol/shell/launch.ts`의 `thingsToConfirmLinkSchema`, `ipc/windowless-confirmation.ts`와 preload의 그 줄, wording `common.label.tray-notifications-unavailable`. `core/config/shell-settings.ts`의 `shell.os_notifications`가 쓰이지 않으면 지운다.

- (lead가 더함, places-sessions-rewind가 넘긴 것) `session/mod.ts`의 `recordFactMessage`·`factMessageContent`, `tools/questions`의 `cancelGroupsFrom`. 계약 `session-rewinds.ts`의 `previewItemSchema` app 항목과 app 이유 코드, `preparedFileSchema.redo_ref`(늘 null), header의 `redo`(lead 계약 고침으로 같이 지운다).
- (lead가 더함, places-sessions-contexts-drafts가 넘긴 것) protocol `draftContentSchema`가 `context.draft` 읽기 출력 말고 쓰는 곳이 없으면 정리. core는 `parseOutline`(옛 md 목차 parser)을 안 쓴다. `shell/renderer/editor/model.ts`가 쓰는 것만 남는지 본다.
- (lead가 더함, releases-problems-bundle이 넘긴 것) 계약의 옛 `releases.list`·`releases.get`·`releases.compare`(`RELEASE_ROUTES`)와 core `releases/reads.ts`의 그 handler, `compareReleases`. 옛 `release.start_activation`·`release.record_*`·`release.complete_activation`·`release.fail_activation`(모두 `activation.*`로 대체). 계약 줄은 lead와 같이 지운다.

- (lead가 더함, platform-diagnostics가 넘긴 것) protocol `diagnosticsCheck`·`DIAGNOSTIC_CHECKS`(registry의 `DIAGNOSTIC_ROUTES`에서 빼고 `diagnosticsList`만 남긴다. handler가 없다), 쓰는 곳이 없으면 `platformStatus`도.

- (lead가 더함, fix-problem-fixes가 넘긴 것) ticket completion의 `fix_records` 칸(계약 `ticket-claims.ts`·`ticket/claims.ts`·`ticket/values.ts`·`ticket-screen.ts`, coding-agent `ticket-ops.ts`, DB 열)은 받고 저장하지만 이제 보는 곳이 없다. 걷는다. "고친 기록" 주석(`problem-views.ts`, `ticket-claims.ts`). handler가 없는 `codingAgentSessionSummary`·`REPAIR_CONTEXT_ROUTES`(계약 `repair-context.ts`, `sessions.ts`)와 그것을 부르는 `mcp-problem`·`cli-setup` 줄.

- (lead가 더함, router-waiting이 넘긴 것) `tools/questions/text-prepare.ts`의 `waitRun` import, protocol `run-wait.ts` 전체와 `runs.ts`의 `waitRun`·`resolveRunWait`·`correctWaitingRun`·`recoverRun` re-export, `run-reads.ts`의 `runBody`·`runBodyView`, handler가 막힌 stub인 `ApplyMessages`·`AssignMessage`. `ReactionRouter.send`의 반환 `{call}`(늘 빈 문자열)은 `Result<void>`로.
- (lead가 더함, screens-project-main이 넘긴 것) `main/editor/core-port.ts`가 지워졌으니 `ipc/editor.ts`(먼저 `EditorReply`·`CreateReport`를 `ipc/instructions.ts`로 옮긴다)·`preload/editor-api.ts`, `VIEW_HINT_CHANNEL`과 `preload/workspace-api.ts`의 힌트 보내기, renderer `workspace/view-hint.ts`와 `workspace.tsx`의 `layoutHint` 호출(main handler가 없어 invoke가 reject된다), `ctx.relay.beforeCall`, `INSTRUCTIONS_CREATE_CHANNEL`·`InstructionsApi.create`·`InstructionsCreated`. 계약 `InstructionsOpened.path`를 필수로(lead와 같이).
- (lead가 더함, platform-install이 넘긴 것) `core/install-and-update/credential-{channel,helper,helper-main}.ts`와 mod.ts의 credential export(`serveCredentialSocket`, `credentialSocketPath`, `relayCredential`, `CREDENTIAL_SOCKET_NAME`, `unixProtectedChannel`, `CredentialSocket`), `credentialLoaderIdentity`·`mcpLauncher`·`LinuxInstallLayout.credentialHelper`(linux-install.ts, mod.ts re-export), `daemon/main.ts`의 `codingLoaders: [credentialLoaderIdentity()]`(→ `[]`)와 helper 주석, `shell/main/desktop/core/supervise.ts`의 `guides` read 경로와 `unix:…/run/credential.sock` net 권한, protocol `connection-auth.ts`의 `CREDENTIAL_HELPER`. CLI launcher의 `instance.lock` 쓰기는 쓰는 곳이 없으면 뺀다. secret-tool 실행 권한과 `libsecret-tools` 의존은 core keychain이 쓰니 남긴다.

- (lead가 더함, screens-contexts-views가 넘긴 것) protocol `contextViolationsHandedOffEvent`, `context-api-content.ts`의 hand-off 근거용 `evidenceOf`·`keyOfViolation`, `contexts/ledger/adapter.ts`의 `ContextViolationsHandedOff` 주석, gallery `tab-toast.tsx`의 `TabToast`(쓰는 곳 없음)와 `compose.module.css`의 옛 `ContextBody` class(`ctxHead`, `diagram` 등). 그리고 `workspace/kinds/search.tsx`에 `<SearchTab ... onTitle={(title) => host.patchTab(tab.key, (c) => c.title === title ? {} : { title })} />` 한 줄을 넣는다(복원한 Search 탭 이름).

- (lead가 더함, screens-app-space-main이 넘긴 것) `desktop/main.ts`의 `feedback.register(ctx, views, calls)`에서 `calls` 인자(`wiring/feedback.ts`의 `_calls`), `main/entry.ts`의 `--app-screen-test` 분기(그 file이 없다), `preload/screen-test.ts`·`ipc/screen-test.ts`·protocol `shell/screen-test.ts`, `VIEW_SCHEMES`·`DOCUMENT_SCHEME`의 `lophn-document`, `app-call.ts`의 `commandStart`, `view-model.ts`의 `FeedbackViewSnapshot.capture/url/visible`, `ipc/feedback.ts`의 preview·selection·capture 타입과 submit·preview channel, 계약 `protocol/shell/feedback.ts`의 `feedbackSubmitSchema`·`shell:feedback-submit`·`feedbackPreviewSchema`·`FEEDBACK_PUSH`·`FEEDBACK_SCREENSHOT_STATES`·`submitFeedback`, 옛 `problems/feedback.ts`의 `submitFeedback` route.

- (lead가 더함, screens-workspace-space가 넘긴 것) gallery의 쓰는 곳 없는 `workspace/{general,appearance,coding,diagnostics,reactions}-pane.tsx`·`apps-screen.tsx`·`projects-screen.tsx`·`subfolder-picker.tsx`, `compositions/workspace-settings.tsx`의 `ConnectDialogsStatic`·`ConnectDialog`·`ProvidersPane`·`AgentsPane`·`ToolsPane`, gallery `pages.ts`의 옛 page `settings-connections`·`settings-extensions`·`project-app-panel`, `agents-page.tsx`의 `AgentsPageProps.onChangeDefaults`, `desktop/router.ts`의 `routeTitle`.

## 끝남

- `deno task check:full`이 통과한다.
- 부팅 확인이 기준선과 같다.
- 위험 test: 없음 (지우기만 한다. 지운 것을 쓰는 곳이 있었다면 type check가 잡는다. 문자열로 이어지는 것은 2번의 grep으로 잡는다)
- 남지 않음: 2번의 두 후보 script를 다시 돌리면 후보가 0개다 (남긴 것은 이유와 함께 보고의 "남긴 후보"에 쓴다).
- (lead가 더함) `tools/check-deps.ts`의 `LEAVING_FILES`가 비어 있다. 목록의 file이 남아 있으면 지우고, 지울 수 없으면 이유를 보고한다. 빈 목록이 되면 상수와 그 검사 줄도 지운다.

## 보고

- 바꾼 file: 지운 file 수, 지운 export 수, 지운 줄 수(`git diff --stat`의 합), 지운 wording key 수
- 등록할 것: lead가 고칠 목록 file — `packages/protocol/*/mod.ts`·`ROUTES`에서 빠진 항목이 있으면 목록, `deno.json`의 `workspace`·`fmt.exclude`·`lint.exclude`(예: 사라진 `packages/core/projects/formats/guest/bundle.js`), 지울 의존성 후보 목록
- 안 쓰게 된 export: 없음 (이 task가 지운다)
- 정한 것: 남긴 후보와 이유(문자열로 이어져 지울 수 없었던 것, SDK 공개 입구), 지운 schema step 목록
- 계약 바꾸기 요청: 없음. 지운 것이 새 설계의 일부로 판명되면 되돌리고 그 항목을 보고한다.

- (lead가 더함, screens-app-space-frame가 넘긴 것)
  - 안 쓰는 wording key: `app-space.button.{documents,new-window,add-shortcut,remove-shortcut}`, `app-space.heading.this-computer`, `app-space.notice.shortcut-*`, `app-space.notice.window-failed`, `report-problem.{label.screen-details,label.screenshot,notice.screenshot-*,notice.capturing,notice.existing-issue,notice.new-issue,notice.screen-not-sent,heading.sent-with,hint.draft-memory}`
  - 안 쓰는 export: `ReportButton`의 글자 단추, `AppBar`의 `onDocuments`·`onNewWindow`·`ShortcutNotice`, `feedback-dialog`의 preview·screenshot·`Checkbox`, `appSpaceIcons.{report,documents,newWindow}`
  - `AppDetailProps.preview`·`onPreview`(필수 prop이라 app-frame이 `preview={null} onPreview={noop}`을 넘긴다)를 지우고 그 넘기는 줄도 지운다.
- (lead가 더함, releases-problems-activation가 넘긴 것) `protocol/apps/data-job.ts`의 옛 `DataJob*`과 `main/worker/data-job.ts`(아직 `runDataWorker`를 부른다), 옛 `Release`·`Activation` type, `permissions/store.ts`의 `activationInProgress`, 옛 `release.*_activation`·`release.record_*` route 이름. `loadMigrationHistory`는 쓰는 곳이 없다.
- (lead가 더함, screens-conversation-view가 넘긴 것) `AgentViewHost.openResult`·`contexts`, `ContextLinks`·`FileLinks`(`file-links.tsx`), `AgentViewSourceFactory`·`coreAgentViewSourceFactory`·`mockAgentViewSource`(새 이름으로 바꾼 뒤), `PickerNoticeView`(옛 Agents 화면이 안 쓰면), `conversationIcons.dock`이 안 쓰이면.
- (lead가 더함, screens-contexts-overview가 넘긴 것) `ContextsSource.draft`·`operatorCounts`, `DraftProgress`, `ContextDraft`, `RailAction`(shortcut-rail), `ContextRows`, `useContextWatch`, `contextStamp`, `settleContextTabs`.
- (lead가 더함, coding-agent-cli가 넘긴 것) `protocol/coding-agent/`의 mcp-core, mcp-app, mcp-problem, mcp-session, mcp-decisions, cli-core, cli-app, cli-decisions, cli-setup, connections, connection-auth, output(`cliExit`·`CLI_EXITS`). 옛 `ticket-routes.ts`·`ticket-claims.ts`와 새 `ticket/`가 같은 이름을 둘 다 낸다. 옛 것을 지우면 `coding-agent/connection/ticket-ops.ts` import를 따라 바꾼다.
- (lead가 더함, router-calls가 넘긴 것) `core/lophn-agent/tools/handoff/`(`adoptionOf`만 남음)는 `core/apps/tickets/ports.ts`가 import를 끊으면 폴더째 지운다. `HANDOFF_DIRECTIONS`·`handoffAllowed`(`protocol/lophn-agent/decision-values.ts`)가 안 쓰이면 지운다. `protocol/lophn-agent/handoffs.ts`는 lead가 지웠다.
- (lead가 더함, coding-agent-tickets가 넘긴 것) `protocol/coding-agent/ticket-*.ts`(values, routes, claims, screen, repair-prepare, hash)와 옛 ticket event, `ticketReleaseClaim`·`ticketChecks`·`ticketScreenList`·`repairPrepare`·`ticketMakeReady`. registry는 lead가 `TICKET_ROUTES`로 바꿨다. `tickets/checker/{ids,connection}.ts`의 visibility 잔재(`isTicketCheckFeed`, `ticketCheckFeedVisibility`)는 events visibility 장치와 같이 지운다. `launcher.label.{detail-gitignore,rule-exclude,rule-include}`(common.ts)와 `notification-chip/space-decisions.tsx`(screens-workspace-screens가 넘긴 것).
- (lead가 더함, approvals-tool-judgment가 넘긴 것) `tool-judgment/builtin-binding.ts`·`app-judgment.ts`, `work.ts`의 `ToolBinding`·`ResolvedAction`·`CoreCall`·`Admission`·`CallRequest`(안 쓰이면), `core-call.ts`.
- (lead가 더함, places-sessions-contexts-authority가 넘긴 것) `contextViolationsRecordedEvent`, `contextViolationsHandedOffEvent`, `SAVED_VIEW_ORIGINS`, `context-api-content.ts`의 `evidenceOf`·`chooseViolations`·`keyOfViolation`·`sameViolationKey`.
- (lead가 더함, agent-definition-models가 넘긴 것) contract의 `changeModelDefaults`, `modelDefaultsRead`, `modelDefaultsChanged`, `modelFavoritesChanged`, `providerRegistered/Changed/Disconnected`, `modelCallStarted/Finished/Supplemented`, `agentTraceExport`. `observability/reads.ts`의 `subjects("ModelCallStarted", ...)` 조회는 event가 없어 빈다(trace 저장 위치를 정할 때 같이).
- (lead가 더함, releases-problems-tests가 넘긴 것) `protocol/problems/problem-detail.ts`의 `ProblemTestPort`·`ProblemTestLookup`·`ProblemTestFact`·`ProblemTestRecord`, `protocol/problems/reports.ts`의 `reportProblem`·`reportProblemInputSchema`·`ReportProblemIngress`, `core/problems/problem-codes/` 전체, protocol `reconcileProblemWork`·`closeProblemVerified`·`getProblem`(handler가 없으면), `protocol/problems/tests.ts`의 `TEST_KINDS`·`TEST_SIDES`·`symptom`·`failure_paths`·Verification의 problem·basis_seq·before·after, shell의 screen-test 일체(`shell/main/app-frame/screen-test-host.ts`, `entry-screen-test.ts`, `entry.ts`의 `--app-screen-test`, `preload/screen-test.ts`, `ipc/screen-test.ts`, `protocol/shell/screen-test.ts`), `writer-assembly.ts:219` 주석의 `problems.work`.
- (lead가 더함, agent-definition-agents가 넘긴 것) 옛 agents route 정의(`agentsSave/Delete/changeSettings`, `placeAgentSettings*`, `agentProfiles*`), `BUILTIN_AGENT_NAMES`(agent-values.ts, 옛 `context_engineer`).
- (lead가 더함, agent-definition-extensions가 넘긴 것) contract의 `McpServerConfig`·`mcpServerConfigSchema`·`mcpToolClassificationSchema`·`SKILL_SOURCE_KINDS`·`SkillSummary`·`SkillShadow`·`extensionSettingsSchema`(전역 MCP setting `mcpServersSetting`을 층과 같은 `mcpServerSchema` 배열로 바꾼 뒤), `productSkillStores`·`registeredSkillEntries`(product-driver가 안 쓰면).
- (lead가 더함, annotation-core가 넘긴 것) `prompt-assembly/input-tags.ts`의 `annotationBlock`(spec의 `Area:`가 아니라 `Position:`이고 쓰는 곳이 없다)과 `input-tags_test.ts`의 그 줄.
- (lead가 더함, agent-tools-app-api가 넘긴 것) `run-loop/scope.ts`의 `AppOffer`·`computeAgentAppScope`(router-waiting이 못 지우면).
- (lead가 더함, coding-agent-harness가 넘긴 것) `protocol/coding-agent/`의 `launch.ts`, `sessions.ts`, `guides.ts`, `cli-setup.ts`, `harnesses.ts`의 integrationTarget·component*·loading*·receipt/resourceInstall·harnessSuggestion·harnessProfileSetting(다른 package가 안 쓰면). `harnessDetectionSchema`의 `profile_id`·`environment`·`catalog_revision`·`freshness` 칸(값이 늘 같다)을 빼고 `harnesses/detect.ts`의 상수 채움을 지운다.
- (lead가 더함, agent-tools-work가 넘긴 것) `tools/visuals/*`(`checkCardScreen` 등, `session/message-body.ts`의 `checkVisualContent`만 남음), `protocol/lophn-agent/visual-source.ts`의 `document` 출처.
- (lead가 더함, agent-tools-call이 넘긴 것) `tools/questions/` 폴더 전체(사용처 다섯이 걷힌 뒤), `tools/registry.ts`의 `questionSubmitTool`, `tool-judgment/builtin-binding.ts`의 `question.submit`·`handoff.submit` 줄, wording key `question-submit`.
- (lead가 더함, lead commit `aeb55cb8`) machine credential을 기동마다 덮게 바꾸며 `FIXED_CREDENTIALS`를 지웠다. 그 목록에만 쓰이던 principal 상수(`APPS_CONTROL_PRINCIPAL` 등)가 다른 곳에서 안 쓰이면 지운다.
- (lead가 더함, events-identity가 넘긴 것) 옛 coding connection 모델: `server/identity/connection/`, `coding-connection.ts`, `coding-credential.ts`, `coding-credential-assembly.ts`, `ExternalCredentialResolver`·`ExternalCredential`·`externalContext`·`external` 옵션, `wiring/server.ts`의 `createCodingCredentials`·`withRevocationSweep`·connect·registerChild handler, `codingAgentConnectionDefinitions`를 쓰는 곳(`writer-assembly.ts`, `config/settings.ts`, `main/daemon/{assembly,registration,core}.ts`, `wiring/context.ts`), `secrets/coding-credential.ts`, `protocol/coding-agent/{connections,connection-auth}.ts`, shell `coding-ipc.ts`·`wiring/coding.ts`·`core/allowlist.ts`의 connection 줄, wording `workspace-settings*`의 connection key, `core/main/daemon/main.ts`의 credential socket(platform-install이 먼저 보면 그쪽). `server/credentials.ts`의 `coding:cac_` 비교도 connection이 없어지면 지운다.
- (lead가 더함, coding-agent-settings가 넘긴 것) `shell/main/desktop/coding-start.ts`(`createCodingStart`, `childPlanRunner`), `coding-connection.ts`의 `createCodingConnection` 등 옛 export, `shell/ipc/coding.ts`의 `ConnectRequest`·`ConnectView`·`DetectView`·`HarnessView`(`HarnessSettingsView["login"]` 참조를 풀고)·`FolderChoiceView`·`SessionView`·`StartView`·`CONNECT_INTENT`·`connectRequestSchema`.
- (lead가 더함, events-reactor가 넘긴 것) `platform-register.ts`의 `ASSIGNMENT_REACTIONS_*`·`isAssignmentReactions`·`assignmentReactionsOnlyVisibility`·`notificationsOnlyVisibility`·`NOTIFICATIONS_PRINCIPAL`(`apps/register.ts`가 끊은 뒤), `apps/tickets/checker/connection.ts`의 visibility. `SettleTicketSessions`(`apps/tickets/settle.ts`)와 coding `recover()`가 같은 일을 하니 하나로 모은다.
- (lead가 더함, places-sessions-conversation이 넘긴 것) `prompt-assembly/summary.ts`의 `COMPACT_RESHRINK_MAX`·`clampSummaryText`·`SummaryParts`·`SUMMARY_PART_KEYS`·`assertsNoPreferenceGeneralization`·`latestCompactSummary`, `compactSummaryRequest`의 `shorten` 인자, protocol `sessionCompactRequested`·`sessionCompacted`·`sessionCompactFailed`.
- (lead가 더함, agent-definition-register가 넘긴 것) protocol의 옛 `AGENT_ROUTES`·`AGENT_EVENTS`(`agents.ts`), `changeModelDefaults`·`modelDefaultsRead`·`modelCatalogRefresh`·`modelDefaultsChanged`, `applyQuestionOption`(lead가 registry에서는 뺐다, `8ca22f46`). `UNWIRED_END_DEPS`, `OPTION_ACTION_OWNERS`·`chosenOptionCall`·`createApplyQuestionOption`·`OptionOwnerHandlers`. `wiring/projects-registration.ts`는 place 환경까지 놓으니 이름을 `lophn-agent-registration.ts` 같은 것으로 바꾸고 assembly 경로를 맞춘다(lead와 같이).
- (lead가 더함, agent-tools-context가 넘긴 것) `tools/context-search.ts`·`context-search-tools.ts`·`context-route-shapes.ts`와 `tools/mod.ts`의 그 export 줄, `bundles/common.ts`의 옛 positional `defineBuiltin`·`DefineOptions`(router-waiting이 import를 끊은 뒤).
- (lead가 더함, coding-agent-terminal이 넘긴 것) `shell/ipc/terminal.ts`의 `TerminalCoding`, `TerminalRuntime.coding`, `PromptOutcome`의 `unknown`, `desktop/coding-connection.ts`의 `LOPHN_TERMINAL_OBSERVE` 필터.
- (lead가 더함, platform-config가 넘긴 것) protocol의 옛 `settings/definitions|get|history|apply|reload` route, `defineSetting`·`SettingDefinition`, `SettingsChanged`·`SettingsReloaded`(`protocol/config/settings.ts`), `harnessEnabledSetting`·`harnessProfileSetting`·`harnessSettings`, problems의 `settings?: SettingDefinition[]`, 루트 `deno.json`의 `@std/toml`(쓰는 곳 0, lead가 의존성을 뺀다).
- (lead가 더함, releases-problems-repairs가 넘긴 것) `problemCounts(sql)`는 있는데 apps 쪽에 `ProblemCounts`를 받는 곳이 없다. `app.get`이 open 문제 수를 보여야 하면 잇고, 아니면 `problemCounts`를 지운다.
