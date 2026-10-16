# coding agent 연결과 ticket (S6) 구현 목록 (2026-10-15)

기준 코드: main `acfe4cc3`. 본 설계: S6(`tmp/specs/coding-agent.md`), S3 7장(transport), S1 5·6·8·10장(domain event, agent event, 대기 목록, 꺼졌다 켜질 때), S4 4장(ticket tool 6개)·9장, S7 5장(`TicketVerified`), `requirements/coding-agent.yaml`, `coding-agent-cli.yaml`, `core-app-tickets.yaml`(0728~0749), req-1450~1457, 1491, 1498, 1507, 1516, 1517, `tmp/changes.md` 2·3장, `tmp/changes-by-topic.md`의 coding-agent/*, `tmp/docs-review.md`(coding-agent 절과 2026-10-15 S6 결정), `tmp/research/turn-end-hermes-openclaw.md`.

코드 경로는 모두 `/home/pyosechang/projects/lophn/` 아래다. 줄 수는 test를 뺀 대략이다. 코드는 읽기만 했고 실행하지 않았다.

## 덜어낼 것

| 항목 | 근거 | 지금 코드 | 비고 |
|---|---|---|---|
| MCP server 전부 | S6 10장, docs-review "coding-agent: CLI와 MCP", changes.md 3장 | `packages/coding-agent/mcp-server/`(server, stdio, launch, main, registry, result, tools/ 14개, test 26개, 약 3.4k줄) | CLI가 MCP의 op→route 표를 빌려 쓴다(`cli/commands/app.ts`의 `APP_OP_ROUTES`, `problem.ts`의 `MCP_PROBLEM_ROUTES`). 표를 CLI 쪽으로 옮긴 뒤 지운다 |
| MCP 쪽 protocol 정의 5개 | 위와 같음 | `packages/protocol/coding-agent/mcp-core.ts`, `mcp-app.ts`, `mcp-problem.ts`, `mcp-session.ts`, `mcp-decisions.ts` | `mcp-decisions.ts`의 `decisionLink`는 CLI도 쓴다(사람 전용 안내 command와 함께 지워진다, 아래) |
| `--toolsets`와 `LOPHN_MCP_TOOLSETS`, MCP tool 출력 꼴 | S6 10장 | `packages/coding-agent/harnesses/launch.ts`(`launchOf` 인자), `packages/protocol/coding-agent/output.ts`의 `Toolset`·`readOnlyHint`·`ScopeMark` | `agentResultSchema`는 CLI도 쓰니 남기고 MCP 전용 타입만 뺀다 |
| MCP 설정 출력 | S6 10장, req-1209 폐기 | `packages/coding-agent/cli/commands/mcp.ts`(`lophn mcp config`), `packages/coding-agent/harnesses/launch.ts`의 `mcpEntryOf`·`McpLaunch`, `cli-setup.ts`의 `cliMcpConfigSchema`, catalog 일곱의 `config_targets`·`mcp_shape` | |
| MCP 연결 관측 | MCP 없음, req-1211 폐기 | `packages/coding-agent/harnesses/mcp-probe.ts`(242), `harnesses/loading.ts`(1102, mcp_initialize·tool_discovery·app_guide_loading), `harnesses/inspect.ts`(235), `lophn doctor`(`cli/commands/doctor.ts`, 269) | skill 발견 관측과 trust gate를 남길지는 설계에 없다(확인 못함 절) |
| 안내 파일 배포와 관리 구간 | docs-review "안내와 skill"(자동 배포 안내 파일 고려 안 함), req-1115~1120 폐기 | `harnesses/adapters/region.ts`, catalog의 `instructions`(Claude `CLAUDE.md` `@AGENTS.md`, Gemini `context.fileName`, Codex override), `guides/managed-files.ts`(200), `guides/templates/`(app-root-guide, app-ignore, thin-claude, sync), `guides/sync-tools.ts`(211), CLI `app sync-tools` | |
| 시작 summary와 hook | req-1121~1127 폐기, changes-by-topic "coding-agent/guides" | `guides/hook.ts`(190), CLI `session summary`(`--hook`), `protocol/coding-agent/sessions.ts`의 `codingAgentSessionSummary`·`HOOK_*` 상수, `packages/core/problems/repairs/assembly/summary.ts`(310)와 `repairs/worker/session-summary.ts`(85), catalog의 `purpose: "summary"` hook(Claude, Gemini SessionStart), `summaryHookSupported`·`summaryGuideOf` | |
| 수리 자료 묶음 조립 | req-1359·1361·1377(묶음을 밀어 넣지 않고 종류를 골라 읽음), changes-by-topic "coding-agent/repair-context" | `packages/core/problems/repairs/assembly/`의 `assemble.ts`(438), `sections.ts`(1210), `budget.ts`, `draft.ts`, `select.ts`, `text.ts`, route `repairContextBundle`·`repairContextSummary`(`protocol/coding-agent/repair-context.ts`) | `repairContextMore`(종류별 읽기)와 `fenceBlock`은 아래 고칠 것으로 살린다. `sections.ts`를 종류별 읽기에 재쓸 수 있는지는 확인 못함 |
| 사람이 만드는 연결(connection) 모델 | req-1052(session마다 새 token, 저장 안 함), docs-review "keychain" | `packages/core/server/identity/connection/`(schema, store, commands, reads, rows, cursor, secret-refs, auth), `protocol/coding-agent/connections.ts`(`connectionCreate`·`Revoke`·`List`·`Show`·`Connect`·`RegisterChild`·`EndChild`·`EndConnection`, `CodingAgentConnectionCreated/Revoked` event, `CODING_AGENT_CONNECTION_REVOKE` 결정), `server/identity/coding-connection.ts`, settings 셋 중 `harnessEnabledSetting`·`harnessProfileSetting` | scope `all`(전체 범위 연결)도 같이 없어진다. 인증 port(`connectionAuthPort`)는 token 조회로 바꿔 살린다(고칠 것) |
| coding token의 keychain 보관·전달 | S6 10장, req-1052 | `packages/core/server/identity/coding-credential.ts`(530), `coding-credential-assembly.ts`(362), `packages/core/secrets/coding-credential.ts`(144), `install-and-update/credential-channel.ts`·`credential-helper.ts`·`credential-helper-main.ts`, 설치 binary `lophn-credential`(`packages/base/install/linux-install.ts`, `tools/package-linux.ts`, `tools/verify-linux-install.ts`), daemon의 `credentialSocket`(`core/main/daemon/main.ts`, `core.ts`), CLI `connection/credential/helper.ts`·`provider.ts`, `protocol/coding-agent/connection-auth.ts`의 delivery 계약 | `core/secrets/adapters/keychain.ts` 자체는 secrets 영역(0600 파일 전환)이라 넘긴다 |
| 사람이 직접 시작하는 길 | req-1051(App Engineer가 맡길 때만 process가 열림), S6 2장 | `sessions/plan.ts`의 `guideOf`·`OWN_TERMINAL_METHOD`·`SessionGuide`, `human_start_handle`·`ticket_revision`, CLI `session plan`, `shell/main/terminal/coding/coding-start.ts`의 click→issue→start 흐름 | `launchPlanOf`의 harness·detection·version·executable 검사는 고칠 것으로 남긴다 |
| terminal host의 관측 socket | req-1517(hook→CLI→core), S6 4장 | `packages/shell/terminal-host/observe-socket.ts`(144), env `LOPHN_TERMINAL_OBSERVE`, CLI `session observe`(`cli/commands/session.ts`), `protocol/coding-agent/sessions.ts`의 `ObserveEnvelope`·`harnessSessionObservationSchema`·`acceptObservation`·`unknownObservation`·`endedByProcessExit`, `coding-start.ts`의 `ObservationStore` | |
| TUI 아래 MCP·CLI process 관측과 core 등록 | req-1052(token은 환경 변수), S6 10장 | `packages/shell/terminal-host/child-watch.ts`(253), `shell/main/terminal/coding/coding-children.ts`(157), host의 `credential_helper`·`child_started/ended/tui_ended` 줄 | |
| 사람 전용 안내 command | docs-review "길 없는 동작을 못 한다고 늘어놓지 않는다", req-1213·1217 폐기 | `cli/commands/ticket.ts`의 `ticket create`·`ticket cancel`(`ticketHumanOnly`), `problem.ts`의 `report`·`request-repair`·`confirm`·`dismiss`, `app.ts`의 `app start`·`stop`·`release activate`·`automation run`, `approval.ts`, `question.ts`, `protocol/coding-agent/cli-decisions.ts`, `connection/decision-view.ts`, `decisionLink` | |
| 금지 작업 목록 | 같은 기준 | `connection/policy.ts`의 `FORBIDDEN_ACTIONS`·`FORBIDDEN_ROUTES`·`registrationAllowed`, `cli/forbidden_test.ts`, `connection/scope_test.ts` | 범위는 token이 정한다(core-server req-0206). 막는 목록은 두지 않는다 |
| CLI의 앱 밖 명령(문서·project·series·format) | removed.md 1장(context 통로, 앱 밖 tool), changes.md 3장 | `cli/commands/index.ts`(`index`, `search`), `document.ts`(`read`, `document list/history/diff`), `save.ts`, `project.ts`, `format.ts`, `series.ts`, `connection/document-save.ts`(375), `upload-bytes.ts`, `submission.ts`(295), `save-result.ts`, `protocol/coding-agent/cli-core.ts`의 해당 schema | policy의 `APP_SCOPE_CONCERNS`에서 documents·formats도 뺀다 |
| 앱 직접 통로 | 앱 직접 통로 폐기(req-0883~0892, 0919, 0920), coding agent는 app-api를 부르지 않음 | `connection/app-direct.ts`, `app-direct-unix.ts`, CLI `app command`, `appConnect` 호출, CLI 권한 계획의 앱 socket `--allow-write` | |
| 사람이 하는 harness 관리 command | req-1210·1212 폐기(Settings가 맡음) | `cli/commands/harness.ts`·`harness-run.ts`(`harness list/detect/refresh/inspect/plan/install/update/remove`), `connection.ts`의 `connectAndInstall`·`connection install`, `skills.ts`(`skills list/install`), `daemon.ts`(`daemon start/stop/status/logs`, req-1208 폐기) | 설치 engine 자체는 Settings가 쓰니 남긴다(고칠 것) |
| 기본 harness 제안 | req-1081 폐기 | `harnesses/selection.ts`(`decideDefaultHarness`, 133) | |
| 환경·profile 분리 | req-1079 폐기 | catalog의 `environments`(wsl, remote), `harnessProfileSetting`, `IntegrationTarget`의 `profile_id`·환경 칸, `harness/resolvers.ts`의 profile 해석 | `codex_home`·`hermes_home` 같은 root 해석은 skill 위치에 필요하니 남는다 |
| 제품 안내 skill 둘 | req-1103(제작과 수리 두 절차), removed.md 1장 | `guides/skills/lophn-navigate/`, `guides/skills/lophn-save/`, `guides/manifest.ts`의 두 항목, `protocol/coding-agent/guides.ts`의 `DEPLOY_SKILL_NAMES` | |
| ticket 준비 상태와 채택 질문 | req-0730 폐기, req-0729(필수 칸은 제목·무엇과 왜·조건·근거) | `protocol/coding-agent/ticket-routes.ts`의 `ticketMakeReady`·`ticketMadeReady`·`adoption_questions`·`needs`·`readiness`, `ticket-values.ts`의 `TICKET_READINESS`·`TICKET_NEEDS_LIMIT`, `core/apps/tickets/model.ts`의 `readinessOf`·`adoptionMatches`, `commands.ts`의 `make_ready`·`QUESTION_ADOPTIONS_PORT`, `schema.ts`의 `readiness`·`needs` 열·`ticket_adoption_questions` 표·`tickets_no_readiness_change` trigger | 개발 데이터는 schema를 고쳐 지우고 새로 만든다(AGENTS.md 호환성). migration 없음 |
| 종류별 필수 조건 강제 | req-0735·0736 폐기 | `core/apps/tickets/model.ts`의 `readyKindsComplete`·`humanConfirmationCoupled` | |
| ticket 화면 읽기와 [Start] 다음 행동 | req-0754 폐기, PRODUCT.md 4절(ticket은 사람 화면에 안 보임), changes-by-topic "ticket 화면은 뺌" | `protocol/coding-agent/ticket-screen.ts`(`TICKET_SCREEN_STATES`, `TICKET_NEXT_ACTIONS`의 `start`), `core/apps/tickets/reads.ts`의 screen 읽기, `ticket-repair-prepare.ts`(`repairPrepare` 읽기)와 `core/apps/tickets/prepare.ts`(사람 화면 repair 준비) | `prepare.ts`는 증상·snapshot·채택 문서에서 ticket을 자동으로 채우는 코드다. req-0753 폐기 |
| ticket 자동 확인 판정 | req-0746(확인됨·확인 실패는 App Engineer가 정함), req-0748 폐기 | `core/apps/tickets/checks.ts`의 `ticketRecordChecks`가 pass/fail로 `confirmed`·`check_failed`를 바로 두는 부분, `checker/judge.ts`의 `outcomeOf`·`repairCoverageGap`, `ticketConfirmed`·`ticketCheckFailed` event | 조건별 결과 기록은 고칠 것으로 남는다 |
| claim 시작·갱신·반납의 ledger event | req-1400~1402 폐기, S1 5장(상태가 바뀔 뿐) | `protocol/coding-agent/ticket-claims.ts`의 `ticketClaimed`·`ticketClaimRenewed`·`ticketClaimReleased`, `core/apps/tickets/claims.ts`의 `tx.emit` 호출 | `ticketClaimReleased(expired)`는 `TicketClaimExpired`로 바뀐다(고칠 것) |
| 옛 ticket event 나머지 | S1 5장 목록에 없음(ledger에는 반응할 domain event만) | `TicketCreated`, `TicketMadeReady`, `TicketChecksRecorded`, `TicketConfirmed`, `TicketCheckFailed`, `TicketCancelled`(`ticket-routes.ts`, `ticket-claims.ts`) | `problems/grouping/work.ts`가 이 event를 구독한다(넘긴 것 절) |
| 사람의 revert로 ticket 취소하는 machine 경로 | 앱 revert 계약 폐기(changes.md 3장) | `core/apps/tickets/model.ts`의 `cancelActorAllowed`의 `machine`, `report.ts`의 외부 claim·보고·결과가 없을 때만 취소하는 분기 | |
| 사람이 보는 ticket 링크 intent | req-0754, req-1213 | `packages/shell/ipc/shortcuts.ts`의 `CODING_TARGET`(`cac`·`tkt`·`app`), `shell/main/desktop/open-intent.ts`(`lophn://things-to-confirm/<cac or tkt or app id>`), `os-notification.ts`, `preload/shortcut-api.ts` 안 해당 부분 | |
| e2e 중 옛 설계 시험 | AGENTS.md 호환성(틀린 옛 test는 지우고 다시 씀) | `e2e/coding-agent/`의 `connect-coding-agent_test.ts`, `start-coding-agent_test.ts`, `session-plan_test.ts`, `manage-tickets_test.ts`, `adapter-install_test.ts`, `repair-steps/mcp-bridge.ts`, `stages_test.ts`(985), `e2e/flows/flow-new-app_test.ts`·`verify-app-repair_test.ts`의 MCP handler 호출, `packages/core/testing/coding-agent-scope.ts`(mcp-server tool을 import) | `repair-steps/stages_test.ts`가 보는 수리 단계는 새 설계(CLI claim, 완료 보고)로 다시 쓴다 |

## 고칠 것

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| CLI의 `ticket claim` | 실행하지 않고 MCP 안내만 하는 command → 실제로 claim한다 | req-1216, 1218 폐기, S6 5장 6 | `cli/commands/ticket.ts`(route 없는 `ticket claim`), `protocol/coding-agent/cli-core.ts`의 `cliTicketClaimSchema`, 이미 있는 route `ticketClaim`(`ticket-claims.ts`) |
| CLI 인증 | 연결 참조(`LOPHN_CONNECTION`)로 helper에서 token을 받음 → session 환경 변수의 coding token을 직접 읽음 | req-1052, 1517 | `cli/main.ts`, `cli/dispatch.ts`, `connection/client/core.ts`(`connectionFromRef`), `connection/client/daemon.ts`(주소 찾기는 유지), `protocol/coding-agent/connections.ts`의 `LOPHN_CONNECTION` |
| CLI 권한 계획과 launcher | helper 실행, 제품 설정 파일·`<H>/integrations` 쓰기, 앱 socket 쓰기를 허락하는 Deno 권한 계획 → core loopback과 읽기 위주로 줄인다 | S6 10장 | `cli/launch.ts`, `cli/launch-entry.ts`, `packages/base/install/linux-install.ts`의 `bin/lophn` wrapper(`--allow-run=…lophn-credential`) |
| CLI `app` 명령 표 | 17개 + 사람 전용 4개 → 시험, preview 시작·멈춤, release 준비, 상태·process·preview·release 읽기, 현재 blueprint, app-api 호출 이력, 앱 log만 | req-1132, 1134, 1135, 1137 | `cli/commands/app.ts`, `connection/app-ops.ts`. 빼는 것: `register`(req-0720 폐기), `source`, `sync-tools`, `command`, `list`·`path`(token이 앱 하나라 필요한지는 확인 못함), `validate`(release 준비와 같은 route) |
| CLI `sdk` | `catalog`·`show`·`add`(`--apply`로 `deno.json`·`deno.lock` 쓰기) → 의존으로 선언된 package의 안내 읽기만 | req-1145, 1457, docs-review("SDK 추가는 App Engineer 책임") | `cli/commands/sdk.ts`, `connection/sdk-ops.ts`(638), `sdk-source.ts`(90), `protocol/coding-agent/cli-core.ts`의 sdk schema |
| CLI `problem` | `list`·`show`·`snapshot`·`fix-records`·`summary`·`bundle`·`more`·`record-fix`·`test`·`attachment open` → 진행 상태로 좁힌 목록, 발생 release·commit이 붙은 상세, 종류를 골라 읽기, 두 release 사이 source diff, 고친 기록, test 요청 | req-1149, 1350, 1353, 1359, 1361, 1377 | `cli/commands/problem.ts`, `connection/problem-ops.ts`(582), `protocol/coding-agent/cli-core.ts`. `snapshot`은 problems/snapshots가 없어지므로 뺀다. source diff는 지금 command가 없어 새로 만든다(새로 만들 것) |
| CLI 출력의 data fence | 수리 묶음 조립(`fenceBlock`)에서만 쓴다 → CLI가 내는 사람 말·앱 문자열·log 원문 모두 | req-1380 | `core/problems/repairs/assembly/text.ts`의 `fenceBlock`, `cli/output.ts`, ticket·problem·app 읽기 출력 전부 |
| `repairContextMore` | 묶음의 추가 근거 읽기 → 문제마다 종류(발생 목록, 실패 invocation, log, 직전 release와 설정 변화, 지난 고친 기록, 관련 문제, 첨부)를 골라 읽기 | req-1361 | `protocol/coding-agent/repair-context.ts`, `core/problems/repairs/assembly/more.ts`(276), `reads.ts`, `repairs/worker/context.ts`(271) |
| 읽기·변경 command 이름 | op 이름이 섞여 있다(`app test`는 변경, `app status`는 읽기) → 이름 pattern만으로 읽기를 가려 허락할 수 있게 | req-1219 | `cli/registry.ts`, `cli/commands/*.ts`, `cli/help.ts` |
| 배포 skill 본문 | MCP tool 이름·`op`, `[Start]` 첫 prompt, 시작 summary, `lophn_app register`, `sdk add`, 앱 command, "CLI는 claim 안 함" → CLI 명령으로 claim·갱신·완료 보고, blueprint나 의존을 바꿔야 하면 직접 고치지 않고 CLI 메시지로 App Engineer에게 요청 | req-1108, 1109, 1110, 1113, 1114, 1491 | `guides/skills/lophn-build-app/SKILL.md`(111), `lophn-repair/SKILL.md`(110), `references/investigation.md`, `guides/manifest.ts`(version과 hash 갱신) |
| 첫 prompt | MCP `lophn_ticket`의 show·claim·report 지시 → CLI 명령. 근거는 문제 ID·source 상대 경로 참조만 | req-1095, 1097 | `sessions/prompt.ts` |
| 맡기기 계획 `launchPlanOf` | 사람이 누른 click의 사실(`SessionPlanFacts`, project·`folder_ref`·profile·`ticket_revision`·연결 상태·ticket screen 상태)을 입력으로 받음 → Router가 넘기는 ticket, harness, 실행 옵션, 앱 source 폴더(cwd), 새로 만든 token | req-1067, 1080, 1091, 1097 | `sessions/plan.ts`(315), `protocol/coding-agent/launch.ts`(`sessionPlanInputSchema`, `codingAgentLaunchPlanSchema`). 남기는 것: detection·version 정책·실행 파일이 옮겨졌는지 검사, argv 한 인자로 prompt 넘기기, `.cmd` shim 거절 |
| cwd를 등록 project 폴더로 요구하는 검사 | project 폴더가 아니면 시작하지 않음 → 앱 source 폴더(임의 위치의 git 폴더일 수 있음) | req-1067, req-0721 | `sessions/plan.ts`의 `input.project === undefined` 분기, `shell/main/terminal/coding/coding-start.ts`의 `folder_changed`·`project`·`folder_ref` 검사 |
| Hermes·OpenClaw 첫 prompt 전달 | 검증한 adapter가 없어 시작 자체를 거절 → turn 끝 신호가 없는 제품으로 시작하고 첫 prompt만 넣는다 | S6 2장 1, 12장 1 | `sessions/model.ts`의 `PROMPT_ADAPTERS`(hermes·openclaw `verified: false`), catalog `hermes.ts`(`launch_argv: ["hermes","--tui"]`), `openclaw.ts`(`stdin_after_ready`, `capability: "unverified"`) |
| 첫 prompt를 PTY에 넣는 방식 | `stdin_after_ready`가 화면 출력에서 readiness 문자열을 찾음 → 설계는 "argv 또는 TUI 준비 뒤 paste"만 말한다 | S6 4장 | `shell/terminal-host/prompt-delivery.ts`(90), `protocol/coding-agent/launch.ts`의 `PromptDelivery`. 준비를 어떻게 아는지는 어긋난 것 절 |
| hook 신호 번역 | 제품 hook payload를 session 상태(`ready`·`working`·`waiting_input`·`ended`)로 바꿈 → agent event(`SessionStarted`·`TurnStarted`·`TurnEnded`(completed, failed, interrupted)·`PermissionRequested`·`PermissionResolved`·`SessionEnded`)로 바꾼다. 상태 계산은 core | req-1098, S1 6장 | `sessions/observe/hooks.ts`(Claude, Codex, Gemini), `plugins.ts`(OpenCode, pi), `model.ts`의 `Evidence`·`observationOf`, `observe/mod.ts` |
| 제품마다 turn 끝 신호 | Claude `Stop`, Codex `Stop`(`notify`는 없음), Gemini `AfterAgent`, OpenCode `session.status` idle, pi는 코드가 `agent_settled`만 ready로 보고 `agent_end`는 일부러 뺌, Hermes·OpenClaw는 신호 없음 → 설계는 pi `agent_end`, Hermes `on_session_end`를 말하나 Hermes·OpenClaw는 없는 제품으로 확정 | S6 4장·12장 1, research R8 | `sessions/observe/*.ts`, 각 catalog의 `hooks` |
| catalog의 hook 위치 | Claude만 앱 폴더(`.claude/settings.local.json`), Codex(`$CODEX_HOME/hooks.json`)·Gemini(`~/.gemini/settings.json`)·OpenCode(`$XDG_CONFIG_HOME/opencode/plugin/lophn-status.ts`)·pi(`~/.pi/agent/extensions/lophn-status.ts`)는 사용자 전역이고 status hook 대부분이 `capability: "unverified"`라 설치하지 않음 → 모두 앱 source 폴더 안 project 설정(git에 안 들어가는 local 설정이 있으면 그쪽)이고 검증된 것만 설치 | req-1091, S6 4장 hook 칸 | `harnesses/catalog/{claude,codex,gemini,opencode,pi}.ts`의 `hooks`·`target.scope_kind` |
| catalog의 형태 | MCP 설정·안내·환경·loading 칸이 큼 → 찾기, version·로그인 확인, skill 위치, hook, 띄우기 argv, 첫 prompt 방식, turn 끝 신호 있음/없음 | S6 4장 | `harnesses/model.ts`(`HarnessDefinition`), `catalog/*.ts` 일곱 |
| version·로그인 확인 | 대부분 `version_probe`·`auth_probe`가 `present: false`(확인 안 함) → Settings가 version과 로그인을 따로 보인다. 확인 못하면 확인 못함 | req-1078 | `catalog/*.ts`(codex·opencode만 `exec.external` probe), `harnesses/detection.ts`·`detect.ts` |
| harness 설치 engine | MCP·skill·안내·hook 넷과 receipt·journal·복구를 가진 engine → skill 파일과 hook 설정 둘만. 사람이 고친 파일은 덮지 않고 충돌로 알림. 설치 실패는 따로 보임 | req-1054, 1083 | `harnesses/install.ts`(462, `INSTALL_COMPONENTS`), `builder.ts`(215), `integration/{apply,journal,plan,receipt,remove,tree}.ts`(약 1.1k), `guides/install.ts`. "마지막에 쓴 내용과 같을 때만"을 알려면 쓴 내용의 기록이 있어야 해서 receipt를 어떻게 줄일지는 어긋난 것 절 |
| 설정 파일 adapter | json·toml·yaml·region 넷 → hook 설정을 쓰는 json·toml만(Hermes 전역 yaml과 안내 region은 쓰지 않는다) | S6 12장 1(Hermes는 전역 설정을 안 고침) | `harnesses/adapters/yaml.ts`(423), `region.ts`(80)를 지우고 `json.ts`·`toml.ts`를 남김 |
| 기본 실행 옵션 setting | 기본 harness 하나(`coding-agent.default_harness`)만 → 기본 실행 옵션(제품, model 등). App Engineer가 고르지 않으면 기본 | req-1080 | `protocol/coding-agent/harnesses.ts`의 `defaultHarnessSetting`, `core/server/identity/coding-connection.ts`의 `harnessSettings` |
| coding token의 인증 | 영구 connection의 digest를 매 요청 읽음 → session token. 앱 하나 범위, 회수하면 새 호출 거절, 사람 자격으로 대신하지 않고 자동 재발급 없음 | req-1052, 1056, 1061, 0206 | `core/server/identity/connection/auth.ts`, `connection-auth.ts`(protocol), `core/server/identity/registry.ts`, `server/credentials.ts` |
| coding agent actor의 route 목록 | 문서·project·series·format·approval·질문·session·grant·blob upload에 `coding_agent`가 들어 있음 → token 범위(그 앱의 정보, 문제, ticket, 공통 SDK, template)에 필요한 route만 | req-1064, core-server req-0206, removed.md 1장 | `protocol/` 아래 `projects/documents.ts`·`formats.ts`·`project-routes.ts`·`series.ts`·`uploads.ts`·`read-values.ts`, `approvals/approvals.ts`(6곳), `lophn-agent/questions.ts`·`sessions.ts`·`assignments.ts`·`handoffs.ts`·`run-reads.ts`·`providers.ts`·`models.ts`·`model-calls.ts`, `storage/blob.ts`, `base/redaction.ts`, `events/events.ts`. 각 route를 가진 영역이 맞는지 같이 본다 |
| ticket 생성 입력 | 칸이 `references`(version·address 포함)·`adoption_questions`·`needs`·`readiness`·`conditions`·`inspect`·`preserve`·`problems` → 제목, 무엇과 왜, acceptance check 하나 이상, 근거. 근거 종류에서 문서 판(`version`+address+section)이 빠진다 | req-0728, 0729, 0731, 0732 | `protocol/coding-agent/ticket-routes.ts`의 `createShape`·`validCreate`, `ticket-values.ts`의 `ticketReferenceListSchema`·`referencePrefix`, `core/apps/tickets/commands.ts`(`writeCreate`), `schema.ts`의 `ticket_references` |
| acceptance check 종류 | 여섯(`test_command`, `app_test`, `reproduction_test`, `release_active`, `problems_closed`, `human_confirmation`) → lophn이 실행하는 둘(app test, test command)과 App Engineer가 판단하는 글 조건 | req-0734, 0737, 0745 | `ticket-values.ts`의 `ACCEPTANCE_KINDS`·`acceptanceCheckInputSchema`·`ticketConditionSchema`, `core/apps/tickets/model.ts`의 `conditionInputsValid`, `checker/judge.ts`(398), `checker/work.ts`, `ticket_conditions` 표 |
| 완료 보고 때의 검사 | 완료 보고 뒤 verification·activation·문제 닫힘 같은 사실이 바뀔 때마다 checker가 다시 비교하고 자동으로 확인됨 → 보고가 접수될 때 실행 조건을 그 보고의 release로 돌려 조건마다 결과와 근거를 남긴다. 판정은 하지 않는다 | req-0745, 0746, 0747 폐기 | `core/apps/tickets/checks.ts`(524), `worker/checker.ts`(248, VerificationRecorded·ReleaseActivated·ReleaseSuperseded를 기다림), `checker/run.ts`, `connection.ts` |
| ticket 불변 규칙 | 목표·본문·근거·조건·수리 대상이 만든 뒤 바뀌지 않음(trigger와 `IMMUTABLE`) → 닫히기 전에 고칠 수 있다(`ticket.update`) | req-0733 폐기, S4 4장 | `core/apps/tickets/schema.ts`(`tickets_no_identity_change`, `ticket_references`·`ticket_conditions`·`ticket_problems`의 `IMMUTABLE`) |
| claim의 주인 | `ticket_claims.connection`(cac id)과 `connectionOf`·`connectionAuthSyncPort`, 반납 이유 `returned/expired/connection_revoked` → coding session(token)이 주인이고 session이 끝나면 claim을 반납한다 | req-1061, 1101, 0738, 0739 | `core/apps/tickets/claims.ts`(439), `expiry.ts`, `schema.ts`의 `ticket_claims`, `protocol/coding-agent/ticket-claims.ts`, `ports.ts`(`TICKET_CLAIM_REJECTS`의 `revoked`·`wrong_connection`) |
| claim 조건 | state가 open·check_failed이고 `readiness`가 ready인 ticket만 → readiness 조건을 뺀다. check_failed ticket을 다시 맡길 수 있다 | req-0738, 0746 | `core/apps/tickets/claims.ts`(`not_ready`) |
| claim 만료 | `TicketClaimReleased` 이유 `expired`로 반납 → domain event `TicketClaimExpired`를 남기고 맡긴 call을 failed로 닫는다. 60분 기한과 60초마다 정리는 유지 | req-0739, 0740, 1403, S1 5장 | `core/apps/tickets/expiry.ts`, `claims.ts`의 `ticketExpireClaim`, `core/main/daemon/core.ts`의 만료 정리 timer |
| 완료 보고 event | `TicketCompletionReported`(payload에 `completion_seq`, `claim_seq`, release 등) → Reactor가 맡긴 App Engineer에게 보내고 call을 닫는다. claim 반납은 session 끝에서 | req-1404, 0744, S1 5장 | `ticket-claims.ts`의 `ticketCompletionReported`, `core/apps/tickets/report.ts`(413) |
| ticket 취소 | 주체가 user·machine → 사람이나 App Engineer. 취소하면 그 ticket의 coding session을 멈추고 token을 회수한다 | req-0749, 1062 | `report.ts`의 `ticketCancel`, `model.ts`의 `cancelActorAllowed`, `ticket-claims.ts`의 `ticketCancel` |
| ticket 읽기 | 목록·상세·check 결과 + screen 읽기 → App Engineer와 coding agent가 읽는 `ticket.list`·`ticket.get`(내용, 상태, claim, 완료 보고, check 결과) | S4 4장, req-0745 | `core/apps/tickets/reads.ts`(667), `protocol/coding-agent/ticket-routes.ts`의 `ticketList`·`ticketShow`·`ticketChecks` |
| 문제의 수리 ticket 사실 | `RepairTicketFact`에 `readiness`·`needs`를 싣는다 → state만 | req-0730 폐기 | `core/apps/tickets/problem-work.ts`, `protocol/problems/`의 `RepairTicketFact` |
| 수리 ticket 문제 예약 | `ticket_open_repair_problems`가 문제 하나에 열린 수리 ticket 하나를 강제 | req-0731(같은 앱의 문제 하나 이상), req-0728 | `core/apps/tickets/schema.ts`의 `OPEN_REPAIR_GUARD`·예약 표. 새 설계에 근거가 없어 남길지 확인 못함 |
| release bundle에서 빼는 경로 | MCP·안내·skill 사본 경로 → hook이 놓이는 harness project 설정 전부 | req-0817 계열(core-app-releases 121행), S6 4장 hook 칸 | `protocol/coding-agent/release-exclude.ts`(`.claude/settings.local.json`은 있고 Codex·Gemini·OpenCode·pi의 project hook 경로는 없다) |
| 새 앱 source 준비 | 빈 폴더만 받아 template을 복사 → 이미 있는 파일은 덮지 않고 채우며, 맡기기 순서 3에서 불린다 | req-1130 | `core/apps/packages/template/scaffold.ts`(`dir`은 없거나 빈 폴더여야 한다) |
| fake coding agent | MCP bridge로 repair 단계를 흉내 → CLI·hook으로 흉내 | AGENTS.md 호환성 | `tools/fake-coding-agent/`(`main.ts`가 `mcp-server/main.ts`를 부름, `repair.ts`, `tui.ts`) |
| 맡은 영역의 wording과 설정 말 | coding 연결·Task·MCP 설치 단계 문구 | 위 UI 항목 | `packages/design/wording/en.ts`(coding-, task- 키 약 120줄), `settings.coding-agent.*` 키 |

## 새로 만들 것

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| harness transport(맡기기 쪽) | App Engineer의 coding agent call을 받아 adapter로 session을 열고, 입력(메시지)을 PTY로 넣고, 끝을 안다 | S3 7장, S6 3·5장 | core의 Router에 붙는 harness transport 모듈. code-map에 줄이 없다. adapter가 `coding-agent`에 있어 core가 부를 수 없는 문제는 어긋난 것 절 |
| 앱마다 queue | 그 앱에 끝나지 않은 coding session이 있으면 새로 열지 않고 queue에 세우고 call은 accepted로 기다린다. `SessionEnded`가 오면 다음을 연다. 기다리는 동안 보낸 쪽이 cancel할 수 있다 | req-1516, S6 2장 2·5장 2, S3 5장 | harness transport(위). queue를 메모리에 둘지 표에 둘지는 설계에 없다(확인 못함) |
| coding token 발급·회수 | 맡기기마다 그 앱 하나 범위의 token을 새로 만들어 환경 변수로 넘기고, session 끝·ticket 취소·call cancel에 회수한다. 저장하지 않는다 | req-1052, 1061, 1062, S6 2장 3 | `core/server/identity/`(token 발급과 회수), 환경 변수 이름은 설계에 없다 |
| session 끝 정리 | session이 끝나면 token 회수와 claim 반납을 한 번에 하고, 완료 보고가 없었으면 `CodingSessionEndedUnreported`를 남긴다 | req-1101, S6 8장 | `core/apps/tickets/`와 harness transport 사이 |
| domain event 셋 정의 | `TicketClaimExpired`, `CodingSessionEndedUnreported`, `TicketVerified`(`TicketCompletionReported`는 고칠 것) | S1 5장 | `packages/protocol/coding-agent/`(event), 소유 concern 이름은 `app-tickets`·`coding-agent` |
| Reactor handler(call 닫음) | `TicketCompletionReported`·`TicketClaimExpired`·`CodingSessionEndedUnreported`를 맡긴 App Engineer("열린 session, 없으면 새 session")에게 보내고 같은 일 안에서 call을 done 또는 failed로 닫는다 | S1 5장, S3 7장, 8장 표 | core의 Reactor(다른 영역이 만든다). handler 본문은 이 영역 |
| 끝 표의 나머지 | ticket 취소 → 멈춤·회수·call cancelled, call cancel → 멈춤·회수(claim 풀림)·ticket은 열린 채, lophn 꺼짐 → 켤 때 token 회수·claim 반납·`CodingSessionEndedUnreported` | S6 8장, S1 10장 | harness transport, 기동 때 복구 단계(`core/main/daemon/`) |
| hook 설치 | 앱 source 폴더의 harness project 설정에 hook을 둔다. git에 안 들어가는 local 설정이 있으면 그쪽. 사람이 고친 설정은 덮지 않음. 사용자 전역 설정은 건드리지 않음 | req-1091, 1083, S6 4장 | `packages/coding-agent/harnesses/`의 설치 engine과 catalog |
| CLI hook 명령 | harness가 부르는 명령. stdin JSON을 session의 coding token으로 core에 넘긴다. 회수된 token은 거절하고 모르는 내용은 event를 내지 않는다 | req-1517 | `packages/coding-agent/cli/commands/`(새 파일), 명령 이름은 설계에 없다 |
| hook 수신 route와 event 변환 | core가 hook 내용을 agent event로 바꿔 Bus에 내고 session 상태(running, waiting, idle, unknown)를 계산한다. 모르는 것은 unknown | req-1098, 1517, S1 6장 | core(hook route와 session snapshot). 변환 표가 `coding-agent`에 있어 core가 부를 수 없다(어긋난 것 절) |
| 외부 session ID 연결 | `SessionStarted`에 hook이 실제로 준 session ID(또는 session 파일)만 잇는다. 없으면 없음 | req-1099, S6 4장 | adapter(변환), core(snapshot) |
| App Engineer 메시지를 PTY에 넣기 | reply tool로 온 메시지를 idle일 때만 넣는다. 도는 중이면 기다린다. unknown이거나 turn 끝 신호가 없으면 "이 harness는 turn 끝을 알리지 않는다"는 이유로 실패를 돌려준다. 넣으면 `MessageReceived`. lophn이 꺼지면 기다리던 메시지는 버린다 | S6 7장, 2장 1, S1 10장 | harness transport, `packages/shell/terminal-host/`(PTY 입력 통로) |
| coding agent의 메시지 command | `lophn` CLI로 맡긴 App Engineer session에 메시지를 보낸다. Router를 거치고(보낸 쪽 coding session, 근거 ticket) ledger에는 안 쓴다. 닫혀 있으면 그 앱의 App Engineer 새 session이 받는다 | req-1491, S3 4장, S6 5장 6 | `packages/coding-agent/cli/commands/`와 core route |
| source diff 읽기 | 두 release 사이 source diff. source가 보존되지 않았으면 그 이유 | req-1377 | CLI와 core 읽기 route(release 쪽 데이터는 07) |
| 실행 옵션의 전달 | App Engineer가 고른 제품·실행 옵션(없으면 Settings 기본)을 맡기기에서 adapter까지. 연결되지 않은 제품이면 띄우지 않고 이유를 App Engineer에게 돌려준다 | req-1080, S3 11장 2(봉투의 `open` 칸은 뺌) | call의 `to`/인자, adapter. 봉투에서 어디에 담는지는 설계에 없다(확인 못함) |
| turn 끝 신호 유무 표시 | adapter가 "turn 끝 신호가 있음/없음"을 갖고 Settings가 제품마다 보인다. Hermes·OpenClaw는 없음 | S6 2장 1·4장, 12장 1 | `harnesses/model.ts`(칸 추가), Settings 읽기 route |
| 터미널 탭 열기(core가 시킴) | core(Router)가 shell main에 "이 앱 source 폴더에서 이 argv·env로 TUI를 연다"를 보내고 terminal host가 PTY를 연다 | S6 3·5장 4 | `packages/shell/main/terminal/`(core에서 받는 channel), `terminal-host/launch-plan.ts` |
| session과 터미널 탭의 대응 | 권한 요청이 온 session이 어느 터미널 탭인지 알아서 대기 목록이 focus를 옮길 수 있게 한다 | req-1498, S6 2장 5 | `shell/main/terminal/coding/`(runtime 표), 렌더러 store |
| 기동 때 coding session 복구 | 켤 때 죽은 session의 token·claim을 정리하고, 보고가 없었으면 domain event를 남긴다 | S1 10장 | `core/main/daemon/`과 `core/apps/tickets/` |
| `ticket.update` command | 닫히기 전 ticket의 목표와 조건을 고친다 | req-0733 폐기, S4 4장 | `core/apps/tickets/commands.ts`, `protocol/coding-agent/ticket-routes.ts` |
| `ticket.verify` command | 보고된 ticket을 확인됨이나 확인 실패로 둔다. 확인됨이면 `TicketVerified`를 같은 tx에서 남긴다 | req-0746, 1507, S4 4장, S1 5장 | `core/apps/tickets/` |
| 글 조건 | App Engineer가 판단하는 글 acceptance check(종류, 저장, 결과 기록 칸) | req-0734, 0745 | `ticket-values.ts`, `ticket_conditions`, `ticket_check_results` |
| 읽기·변경 이름 규칙 검사 | registry를 돌며 읽기 명령과 변경 명령이 이름 pattern으로 구별되는지 검사한다 | req-1219 | `packages/coding-agent/cli/registry_test.ts` 쪽 |
| 시험 새로 쓰기 | hook→CLI→core→agent event, 앱 queue, 맡기기→claim→완료 보고→call 닫힘, 보고 없는 끝, 신호 없는 제품의 메시지 실패, token 회수 뒤 거절 | AGENTS.md 호환성 | `e2e/coding-agent/`, `packages/coding-agent/*_test.ts`, `packages/core/apps/tickets/*_test.ts` |

## UI 덜어낼 것

| 항목 | 근거 | 지금 코드 | 비고 |
|---|---|---|---|
| 앱 공간 Tasks 탭 전부 | req-0754 폐기, PRODUCT.md 4절 축 2 | `packages/shell/renderer/app-frame/app-detail/tasks/`(`tasks-tab.tsx`, `task-detail.tsx`, `start-panel.tsx`, `core-source.ts`, `model.ts`, `source.ts`, testdata), `app-detail.tsx`의 `tasks` slot과 탭, `app-space.tsx`의 `TasksTab` 연결(457행) | 새 Task 만들기, ticket 취소, 복사할 요청 문장, TUI 상태 보이기가 모두 이 안에 있다 |
| [Start] 화면 | S6 2장(맡기기는 App Engineer) | `tasks/start-panel.tsx`(267, harness·연결·폴더 고르기) | 위 탭에 속한다 |
| 연결 회수 확인 창 | req-1052(연결 회수 없음) | `packages/shell/renderer/confirmation/kinds/connection-revoke/`, `shell/main/confirmation/kinds/connection-revoke.ts`, `renderer/confirmation/screen.tsx`의 해당 분기 | |
| 회수·취소·생성 링크 화면 | req-1213 | `renderer/desktop/coding-links/coding-links_test.tsx`(시험만 있다), Settings coding 탭의 `initialConnection` focus(`settings-screen.tsx` 101행), `lophn-space.tsx`의 `coding` 전달 | `ipc/shortcuts.ts`의 intent는 main 쪽 목록에 있다 |
| Tasks 탭 문구 | 위와 같음 | `packages/design/wording/en.ts`의 `app-detail.label.tab-tasks`, `app-detail.note.tasks-unavailable`, task·start 키 | |

## UI 고칠 것

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| Settings coding agent panel | 감지된 harness를 고르고 이름·범위로 연결을 만들고 회수·재설치·doctor 네 단계를 보임 → 제품마다 실행 파일, version, 로그인, turn 끝 신호 있음/없음, skill 설치 실패를 보이고 기본 실행 옵션(제품, model 등)을 정한다. 연결 만들기·범위·이름·회수 단추와 doctor 단계는 뺀다. [Detect again]은 남는다 | req-1054, 1078, 1080, S6 2장 1 | `renderer/desktop/lophn-space/settings/connections/`(`connections-panel.tsx` 631, `model.ts`, `source.ts`, `core-source.ts`, `testdata/`) |
| Settings 쪽 IPC·source | `CodingConnectionsSource`가 connect·revoke·install 통로를 가짐 → 감지 읽기, 갱신(재감지), skill 설치, 기본 실행 옵션 | 위와 같음 | `settings-screen.tsx`, `lophn-space.tsx`, `desktop/main.tsx`, `entry.tsx`, `dev-mock/`, `shell/ipc/coding.ts`(`connect_with_harness` intent, `scopeSchema`), `shell/preload/coding-api.ts` |
| 터미널 탭이 coding TUI를 보이는 모양 | 사람이 연 일반 shell 탭만 있고 coding 표지(`TerminalCoding`)는 renderer가 쓰지 않음, 끝나면 "새 [Start]만" 문구 → App Engineer가 연 탭은 제목으로 구별되고, 끝나면 session이 끝난 상태로 보이며 다시 시작은 없다(새 맡기기만) | S6 2장 5, 8장 | `renderer/terminal/terminal-tab.tsx`(392), `exit-banner.tsx`, `store.ts`, `model.ts`, `shell/main/terminal/supervisor.ts`(170행의 coding 거절 문구), `ipc/terminal.ts`의 `TerminalCoding` |
| 문제 상세의 수리 상태 줄 | `repair: {label, needs, last_check_failed}`가 ticket의 준비 상태·확인 목록에서 옴 → state만 읽는다(ticket은 사람 화면 대상이 아니다) | req-0730 폐기, PRODUCT.md 4절 | `renderer/app-frame/app-detail/issues/core-read.ts`, `issues-tab.tsx`(229행) |
| coding 말 | `settings.label.coding-*`, `settings.label.harness-*`, 설치 단계 문구 → 위 panel의 새 항목 | 위와 같음 | `packages/design/wording/en.ts`, `placeholders.ts` |

## UI 새로 만들 것

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| 대기 목록의 coding agent 권한 요청 줄 | `PermissionRequested`(coding agent)를 목록에 보이고, 누르면 그 session의 터미널 탭으로 focus를 옮긴다. 답은 TUI에서 한다. harness별 물음 모양은 UI에 두지 않는다 | req-1498, S6 2장 5·9장, S1 8장 | 대기 목록 component 자체는 event·approval 영역이 만든다. 이 영역은 session→탭 대응(새로 만들 것)과 focus 호출 |
| 시스템이 여는 터미널 탭 | 사람이 누르지 않고 core 요청으로 열리는 터미널 탭(app source 폴더, 이미 만든 runtime에 붙음). 탭 key와 `terminal_ref`를 main이 정한다 | S6 5장 4 | `renderer/workspace/kinds/terminal.tsx`, `shell/main/workspace/kinds/terminal.ts`(layout이 `project_folder`뿐이고 복원은 종료된 placeholder), `renderer/terminal/store.ts`(`request`가 사람 클릭만 받음) |
| Settings의 skill 설치 실패와 기본 실행 옵션 입력 | 제품마다 skill 설치 실패를 따로 보이고, 기본 제품·model 입력 | req-1054, 1080 | Settings coding panel(위 고칠 것) |
| 맡기기 대기 보이기 | queue에서 기다리는 coding 맡기기가 session 목록에 보인다 | S4 4장 session 목록, S6 2장 2 | `session 목록` UI(shell 영역). 이 영역은 읽기 값만 준다 |

## 문서끼리 어긋난 것

- **adapter의 코드 위치와 core의 import 방향:** S6 3장은 adapter를 `packages/coding-agent/`에 두고 Router(core)가 부르며, 4장은 "core가 hook을 agent event로 바꾼다"고 한다. code-map의 package 표는 core가 `protocol`과 `base`만 import할 수 있고, `coding-agent`는 core를 import할 수 없으며, `coding-agent`를 쓸 수 있는 곳은 shell main의 terminal host뿐이다. 그래서 core의 Router와 hook 변환이 adapter를 직접 부를 수 없다. 변환 표와 launch 계획의 순수 값을 `protocol`로 옮기거나 adapter를 core에 둘 수 있게 code-map을 고쳐야 한다. spec에 없다.
- **req-0746과 req-1217의 폐기 이유:** req-1217 폐기 주석은 "확인됨은 조건이 통과하면 core가 정한다(req-0746)"인데 req-0746 본문과 S4 4장 `ticket.verify`는 App Engineer가 정한다.
- **pi의 turn 끝 신호:** S6 4장은 pi `agent_end`라고 쓰나, 지금 코드(`sessions/observe/plugins.ts`)는 retry·compaction·queued continuation이 남을 수 있다며 `agent_end`를 ready 근거로 쓰지 않고 `agent_settled`만 쓴다. 조사 근거가 어느 쪽인지 확인하지 못했다.
- **Codex의 turn 끝 신호:** S6 4장은 `Stop`·`notify`를 말하나 catalog는 `Stop` hook뿐이고 그것도 `unverified`다. `notify`를 쓸지는 설계에 없다.
- **권한 mode:** S6 2장 4는 lophn이 coding agent의 권한 mode를 정하지 않는다고 한다. docs-review("CLI와 MCP" 절)는 읽기 명령 자동 허락을 harness 허락 목록에 명령 이름으로 잡고 App Engineer가 띄울 때 넣는다고 했고, req-1219가 그 근거로 읽기·변경 이름 구별을 요구한다. 어느 쪽이 맞는지 spec에 없다.
- **첫 prompt를 paste하는 때:** S6 4장은 "TUI가 준비된 뒤 PTY에 paste"라고 하나, 2장 1은 화면을 읽어 짐작하지 않는다고 한다. 지금 `stdin_after_ready`는 PTY 출력에서 readiness 문자열을 찾아 짐작한다(OpenClaw만 이 방식이고 지금은 readiness 값이 없어 시작하지 않는다). 준비를 어떻게 결정적으로 아는지 정해지지 않았다.
- **receipt:** changes-by-topic은 "receipt"를 덜어낸다고 하나 req-1083은 "lophn이 마지막에 쓴 내용과 같을 때만 고치거나 지운다"를 요구한다. 마지막에 쓴 내용(또는 hash)을 어딘가 기록해야 한다. 지금 `integration/receipt.ts`와 `<H>/integrations`가 그 일을 한다. 줄여서 남길지 정해지지 않았다.
- **`changes.md` 2장 ticket 줄:** "claim 시작·갱신·반납 event(1400~1402)는 ledger에서 뺀다"는 S1과 같다. 그러나 `changes.md`의 coding agent 줄은 "hook을 받아 agent event로 바꾼다" 한 문장이라 CLI hook 명령(req-1517)과 core 변환의 나눔이 없다. spec S6 4장이 정본이다.
- **Hermes·OpenClaw의 `SessionStarted`:** S6 6장은 "hook이 session 시작을 알리면 `SessionStarted`"라고 한다. 두 제품은 hook이 없으니 이 event를 누가 언제 내는지 없다(PTY spawn으로 낼지).

## 다른 영역에 넘긴 것

- Router, Bus, Reactor, Gateway 본체, agent event 정의와 session snapshot 계산, 대기 목록 UI: event 영역.
- call 봉투, `agent_calls` 표, call·reply·cancel tool, 실행 옵션을 담는 칸: agent call 영역.
- App Engineer의 ticket tool(`ticket.create/update/verify/cancel/list/get`), `TICKET_FORBIDDEN_TOOL_NAMES`(update·cancel 금지가 새 설계와 반대), `ticket.make_ready` tool, `prepareTicket`·`splitTicketUnits`·`bundleRepairs`, FORBIDDEN_TOOL_NAMES 해제: agent definition 영역. 참고 경로 `packages/core/lophn-agent/tools/bundles/ticket.ts`, `roles/app-engineer/ticket.ts`.
- `TicketVerified`를 받아 release를 activate하는 handler와 drain: release와 activation 영역.
- problems: `core/problems/grouping/work.ts`가 `ticketClaimed`·`TicketClaimReleased`·`TicketCompletionReported`를 구독하는 것(ticket event 정리와 맞물림), `repairs/commands.ts`(고친 기록 쓰기), problems/snapshots 제거로 `problem snapshot`이 사라지는 것, `ticket_open_repair_problems`와 problems `work` 상태.
- secrets: `core/secrets/adapters/keychain.ts`와 keychain 의존 전부(0600 파일 전환).
- documents: `coding_agent` actor를 허용하던 documents·projects·series·format route의 정리(route를 가진 영역이 정한다).
- 앱 revert 계약이 없어지면서 `cancelActorAllowed`의 `machine`이 없어지는 것: 앱 rewind 영역.

## 확인 못함

- coding token의 환경 변수 이름, token 형식, session ID와 principal(`coding_agent:<id>`) 대응. 설계는 "환경 변수"까지만 말한다.
- 앱 queue를 메모리에 둘지 표에 둘지, lophn이 꺼지면 queue에서 기다리던 맡기기가 어떻게 되는지(S1 10장은 기다리던 입력과 session을 말하고 queue는 말하지 않는다).
- Codex, Gemini CLI, OpenCode, pi가 앱 source 폴더 안 project 설정으로 hook을 받는지. 지금 catalog는 이들의 hook을 사용자 전역 위치에 두고 `unverified`로 남겨 두었다. 조사 문서(`coding-agent-harness-integration` 9절)를 이 일에서 읽지 않았다.
- Hermes와 OpenClaw의 project 폴더 skill 위치. catalog는 Hermes `.hermes/skills`를 `[미확인]`으로, OpenClaw를 사용자 전역(`~/.openclaw/skills`)만 둔다. skill 설치가 앱 source 폴더 밖이어도 되는지는 S6에 없다.
- skill 발견·trust gate 관측(`loading.ts`의 `trust_gates`, `skill_trust_note`)을 Settings에서 계속 보일지. req-1054는 설치 실패만 말한다. 지금은 덜어낼 것으로 분류했다.
- `app list`·`app path`·`app validate`를 새 CLI에 남길지.
- 터미널 탭이 project 화면에 열리는지 앱 공간에 열리는지, 열릴 때 focus를 자동으로 옮기는지. req-0069는 project 화면의 탭을 말하고 앱 source 폴더는 project 밖일 수 있다.
- 사람이 TUI에 직접 입력하는 중에 lophn이 PTY로 메시지를 넣을 때 섞이는 것.
- `ticket.create`를 사람(user)이 부를 수 있는지. 지금 actors는 `user`·`agent`이고, Tasks 탭이 없어지면 사람 경로는 없다.
- 주변 코드: `core/main/daemon/core.ts`(2.7k줄 이상)의 coding 조립 전체와 `core/apps/runtime/connect.ts`, `core/apps/connections/operations.ts`, `core/apps/preview/service.ts`의 `coding_agent` 사용은 목록에 올릴 만큼 읽지 못했다. `core/apps/tickets/reads.ts`의 세부(667줄)와 `checks.ts` 세부도 항목 단위로만 봤다.
- 줄 수는 `wc -l`로 센 값이고 test와 fixture를 빼지 못한 곳이 있다(`harnesses` 전체 약 7.4k줄, `connection/` 약 5.2k줄, `cli/` 약 5.9k줄).
