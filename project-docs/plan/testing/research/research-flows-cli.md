# coding agent harness들의 E2E·integration flow case 고르기 조사

조사 시점: 2026-10-17 기준 각 clone(shallow, 읽기만 함, 실행 안 함). 앞선 `research-cli.md`(fake provider 쪽)는 되풀이하지 않는다.
clean room: 코드는 옮기지 않았고 이름, path, 개수, 구조, 설계만 적었다. 개수는 grep으로 센 대략치(`#[test]`, `it(`, `test(` 줄 수). loop·table 안의 case는 실제보다 적게 잡힌다.
clone: 각 repo의 GitHub 기본 branch(`--depth 1` clone, 지금은 지움)의 `{codex,opencode,gemini-cli,goose}`

## 0. 한눈에

| harness | integration/E2E 규모 | 모양 | fake | 고르는 기준 문서 |
|---|---|---|---|---|
| Codex | core/tests 250 모듈 2,861 test + app-server 1,692 + exec 105 + cli 195 (unit은 core/src에만 2,896) | 같은 process 안 core + HTTP mock(wiremock), exec/app-server/cli는 binary spawn | 손으로 쓴 SSE JSON | 없음 (CONTRIBUTING은 외부 PR을 받지 않음. nextest.toml 주석뿐) |
| OpenCode | app e2e 42 keeper 357 test(+user-story 2) + core/test 148 file + cli 31 + server 30 + tui 41 | Playwright는 backend 없이 in-page mock, 나머지는 Effect layer와 bun test | in-memory mock, cassette | 명시적. packages/app/AGENTS.md Tests, e2e/AGENTS.md, `.opencode/skills/{unit-tests,app-e2e-tests,tui-tests,component-tests}` |
| Gemini CLI | integration-tests 48 file ~136 it (29개 skip), evals 38 file 101 case | 번들한 binary를 spawn해서 stdout·telemetry·tool log 단정 | 19 file만 `.responses` golden 재생, 29 file은 실제 model | docs/integration-tests.md, evals/README.md, docs/behavioral-evals.md |
| Goose | crates/goose/tests ~244 test (inline unit 4,107) | ACP 공통 시나리오 36개를 transport 2종에 돌림 + agent loop는 scripted Provider | OpenAI wire 흉내 fixture + canned SSE 19개 | AGENTS.md "tests/ 폴더 선호", CONTRIBUTING "LLM이 쓴 trivial test 조심" |

공통 인상: "시나리오 1개 = 한 contract 하나"인 곳(Goose 공통 시나리오, OpenCode keeper)은 개수가 통제되고, "기능 하나에 파일 하나"인 곳(Codex)은 기능당 수십 개로 부푼다. 기준 문서가 있는 쪽(OpenCode, Gemini evals)만 개수를 줄이는 압력이 보인다.

---

## 1. OpenAI Codex CLI (`codex-rs`)

### 1.1 구조
- `core/tests/all.rs` 하나가 `suite/` 전체를 한 test binary로 묶는다(mod.rs 첫 주석: 옛 독립 integration test들을 모듈로 합쳤다. 링크 시간 때문). 250 file, 2,861 test, 20.6만 줄, 평균 72줄/test.
- 같은 mock server 도구(`core/tests/common`)를 core(in-process), exec(binary spawn), app-server(stdio JSON-RPC child), cli(binary)가 공유.
- unit(`core/src`)과 integration이 거의 1:1(2,896 : 2,861). integration이 부수적이 아니다.
- PR은 Bazel 중심의 작은 검사, 전체 cargo nextest는 main push 뒤(`rust-ci-full`, postmerge). OS는 macOS 2 / Linux gnu·musl x64·arm64 / Windows x64·arm64 matrix.

### 1.2 시나리오 묶음 (core/tests/suite, 파일 이름으로 분류. 경계는 근사)

| 묶음 | file | test | 대표 file |
|---|---|---|---|
| shell·exec·apply_patch·tool 실행 | 39 | ~388 | apply_patch_cli 53, unified_exec 46, unified_exec_process_events 27, tools 13, tool_lifecycle 13, truncation 17, view_image 20 |
| MCP·plugin·skill·connector | 30 | ~300 | rmcp_client 69, plugins 44, skills_extension 38, mcp_turn_metadata 29, mcp_tool_exposure 16 |
| model·provider·인증·설정 | 33 | ~266 | client 64, reasoning_effort_override 47, step_settings 37, remote_models 28, model_switching 27 |
| multi agent·subagent·mailbox | 24 | ~244 | subagent_notifications 55, scenarios_agent_message_board 18, multi_agent_tool_descriptions 25 |
| guardian(자동 승인 심사 subagent) | 30 | ~232 | guardian_review 44, guardian_mcp_elicitation 30, guardian_retained_context 29, guardian_subagent_authorization 24 |
| compact·context·token budget | 15 | ~190 | compact 61, token_budget 40, compact_remote 19, compact_program_tests 22 |
| approval·권한·sandbox·exec policy | 17 | ~190 | approvals 48 (matrix 57 spec), network_approval 32, request_permissions 24, exec_policy 13 |
| code mode | 5 | ~176 | code_mode 164 (9,451줄, 한 file) |
| 중단·재개·fork·rollout·session 저장 | 18 | ~149 | pending_input 46, pending_input_persistence 15, sqlite_state 11, abort_tasks 6, resume 8, interrupt_hooks 5 |
| 오류·재시도·quota·stream | 8 | ~125 | retry_after 40, quota_exceeded 5, stream_no_completed 2, stream_error_allows_next_turn 1, websocket_fallback 4 |
| realtime·voice | 5 | ~86 | realtime_conversation 73 |
| remote env·exec-server | 4 | ~62 | remote_env 40 |
| hooks | 1(+hooks_*) | 62+ | hooks 62 |
| scenarios_* (여러 기능 섞은 multi-turn) | 31 | 136 | scenarios 47, snapshot 102개와 짝 |
| 기타(review, otel, items 등) | 16 | ~258 | |

app-server(`app-server/tests/suite/v2`) 1,692 test / 189 file: plugin·skill·mcp·hooks·app 계열 ~409, thread 생명주기(start/resume/fork/list/read/archive/revert/queue) ~316, account·auth·config·model ~296, realtime·code mode·remote·daemon ~165, turn·review·compaction ~118, guardian ~129, command·fs·sandbox·permission ~116, 기타 ~136. 대표 turn_start.rs 68 test(5,700줄 이상).
exec(`exec/tests`) 105: event_processor_with_json_output 31(unit 성격), resume 13 + fork, seatbelt 15, apply_patch 6, prompt_stdin 6, sandbox 5, approval_policy 3, server_error_exit 1, mcp_required_exit 1. cli(`cli/tests`) 195: plugin_cli 39, daemon_startup 16, features 14, app_server_daemon 13, mcp_* 28, login 8, exec_server 10.

### 1.3 시나리오 하나의 크기와 모양 (대표 셋)
1. **`stream_no_completed` retries_on_early_close**: ~55줄. fake 응답 2번(첫째는 `response.completed` 없이 끊김, 둘째 정상). 단계: 서버 기동 → turn 시작 → TurnComplete event 대기 → 서버가 받은 요청 수 == 2. 단정은 요청 수 하나.
2. **`exec/server_error_exit` exits_non_zero_when_server_reports_error**: ~25줄. fake 1번(`response.failed`). binary spawn 1회, 단정은 exit code == 1 하나.
3. **`compact` manual_compact_uses_custom_prompt**: ~90줄. fake 2번(첫 turn, compact turn). 단계: turn → `Op::Compact` → Warning event → TurnComplete → 요청 2개 → 둘째 요청 body에 custom prompt가 들어가고 기본 prompt는 빠졌는지. 단정은 보낸 요청 body + event.
4. 큰 쪽 `scenarios` astra_asks_an_async_question: ~175줄. gate 걸린 streaming server, fake 4번, turn 2개, event 대기 여러 번, 마지막에 insta snapshot(모델이 본 request 이력)과 tool schema 단정. 한 번에 여러 가지를 snapshot 하나로 고정.
- 요약: 보통 fake 1~3번, 단정은 (a) 서버가 받은 요청의 구조 (b) event 열 (c) exit code (d) rollout file. 화면 문자열은 거의 단정하지 않는다. snapshot 102개가 "모델에게 보인 context"를 대신 단정한다.

### 1.4 고르는 기준
- 명시적 기준 문서 없음. 대신 code에 남은 규칙: `skip_if_no_network!`(1,452 곳), `skip_if_sandbox!`, 8개 `#[ignore]`(live_cli: 진짜 provider, CI는 안 돔 — "CI는 deterministic하고 공짜")..
- 기능 하나당 시나리오가 매우 많다. compact 61(6,250줄), code_mode 164, hooks 62, rmcp_client 69, approvals 48. "기능당 몇 개"의 상한 개념이 없다.
- 이름에 issue 번호 거의 없음. issue/PR URL은 test data로 쓴 가짜 URL뿐. "regression"이라는 단어는 test 5천 개 중 ~19 줄(주석·doc). 이름은 동작을 서술한다(예: `approving_execpolicy_amendment_persists_policy_and_skips_future_prompts`). 즉 bug 회귀 비율은 이름으로는 측정 불가, 추정 1% 미만.
- 제품 전체를 새 기능마다 같은 builder(`test_codex()`)로 다룬다. 새 시나리오의 비용이 작아서 부푼다.

### 1.5 같은 시나리오를 여러 조건으로
- `#[test_case]` 1,660 곳 / 205 file. table-driven이 기본 습관.
- **approval matrix**(approvals.rs): ScenarioSpec struct(approval policy × sandbox policy × action × feature × 기대) 57개를 하나의 runner가 돈다. 이름으로 5 그룹(danger_full_access, read_only, workspace_write, apply_patch, unified_exec)으로 나뉘어 test 5개로 실행. 각 spec은 mock server 1개 + 응답 2번. nextest.toml에 옛 이름(`approval_matrix_covers_all_modes`)의 slow-timeout override가 남아 있다 = 하나였던 matrix를 쪼갠 흔적.
- transport: websocket vs SSE test 따로(`client_websockets` 53, `agent_websocket`, `websocket_fallback`). 같은 body를 두 transport에 돌리는 장치는 약하고 file이 따로다.
- OS: 13개 모듈이 `cfg(not(windows))`, 3개는 linux/macos/unix 전용. Windows만 worker 수를 올리거나 test group을 직렬화(`windows_process_heavy`, `windows_sandbox_accounts`).
- sandbox: linux-sandbox crate 자체 `tests/suite`(bwrap, seccomp, denied_files 등 11 file)가 따로 있고 core는 sandbox를 "정책이 올바르게 전달되나" 까지만 본다.

### 1.6 무거워진 것과 줄인 것
- 무거워짐: code_mode.rs 9,451줄, compact.rs 6,250줄, approvals.rs 4,687줄, realtime_conversation.rs 6,147줄. 한 file이 한 기능의 모든 변형을 안는다.
- 쪼갬/묶음: 독립 integration binary 여럿 → `all.rs` 한 binary(링크 시간). approval matrix 하나 → 5 group. `scenarios.rs`가 길어지자 `scenarios_*.rs` 31 file로 분리(guardian, mailbox, mcp, mxc 등).
- 느려서 옮김/격리: nextest `slow-timeout 30s` + `retries 1`(재시도 한 번 허용), 무거운 file별 `test-group`(max-threads 1~4), `rmcp_client`에 "Do not add new tests here" 주석(slow-timeout 4배). 주석에서 flaky 우려를 직접 말하는 곳: tool_parallelism(timing 기반이라 flaky 되지 않게 구조 조정), unified_exec_process_events(race 방지 gate).
- flaky로 지운 흔적은 안 보임(`#[ignore]` 8개는 모두 live_cli 계열). 대신 결정적으로 만드는 도구(chunk gate가 있는 streaming server, 시계 주입, retry 설정을 provider config로 명시해 process 전역 env를 안 건드림)에 투자.

---

## 2. OpenCode (`anomalyco/opencode`, bun monorepo)

### 2.1 구조
- 층이 명시적으로 나뉜다: unit/service(`bun test` + Effect `TestClock`), cli subprocess, TUI renderer test(OpenTUI), Storybook component test(Playwright), app e2e(Playwright, 실제 build + 정적 server + 페이지당 in-memory mock API), `e2e/performance`(CI에서 안 돎).
- **app e2e에 opencode backend가 없다.** 페이지마다 mock API를 test worker 안에서 돌리고, `/api/**`는 route로 가로채고 SSE는 `fetch` override로 흉내. mock에 없는 route를 부르면 501로 test 실패.
- 숫자: app/e2e/regression 42 spec / 357 test / 1.77만 줄(평균 49줄), user-story 1 spec 2 test, service-worker 1 spec 2 test, performance 32 spec(CI 제외). core/test 148 file(unit·service 성격 + provider plugin 49), cli/test 31(acp subprocess 3 포함), server/test 30, tui/test ~170, 전체 `*.test.ts(x)/*.spec.ts` ~1,182 file.
- CI: unit은 Linux·Windows(4 vCPU, `--concurrency=3`), e2e는 app에 영향이 있는 PR만, OS당 shard 2 + component 2. e2e는 dev(main)에서는 안 돈다.

### 2.2 시나리오 묶음 (app e2e regression, keeper 단위)

| 묶음 | spec | test | 대표 |
|---|---|---|---|
| settings·tabs·palette·home·whats-new | 7 | 100 | settings 34, tabs 22, settings-search 12 |
| timeline·stream·history·geometry | 9 | 65 | timeline-stream 37, timeline-cache 11, timeline-history 7 |
| session header·nav·server·subagent | 7 | 56 | session-summary 14, subagent-child-navigation 14, session-header 12 |
| composer·queue·model·new-session | 4 | 53 | session-queue 23, composer 14, new-session 11 |
| review·diff·panel·terminal | 8 | 43 | review 21, terminal-input 9 |
| mobile (viewport 전용) | 7 | 40 | mobile-session 12, mobile-timeline-scroll 12 |
| user-story (핵심 흐름) | 1 | 2 | model-selection-flow |
- core/test(service 층)는 tool(edit/patch/read/write/shell/webfetch/search/question/subagent) ~290, session(runner·prompt·compaction·execution·projector·create 등) ~330, provider plugin ~210, config ~150, shell-scan 안전성 ~150, mcp ~65, permission 16 등. agent loop 자체는 Effect layer + 녹화(cassette)/scripted model 위에서 돈다.
- cli: acp 15 file(prompt 10, permission 4, subprocess 3), service·service-lifecycle(실제 service process 선출·port·registration), run/noninteractive 11, updater 17, config 18.

### 2.3 시나리오 하나의 크기와 모양 (대표 셋)
1. **cli/acp `lifecycle.subprocess`**: ~38줄, test 2개. fake model 필요 없음. 단계: spawn → initialize → stdin 닫기 → exit code 0. 둘째는 private server를 SIGKILL → 10초 안에 exit 1 + stderr 문구. 단정: exit code, stderr. 이름에 issue URL(#51716) 붙은 드문 예.
2. **e2e `session-queue` "dragging reorders queued prompts"류**: 평균 ~48줄. `mockWorkspace/openSession` helper로 page를 만들고 event를 push, UI 한 번 조작, 사용자에게 보이는 상태(role/label locator)를 web-first assertion. fake 응답 개념이 없고 mock server state를 직접 구성.
3. **e2e user-story `model-selection-flow`**: ~85줄. mock server 구성에만 절반(provider 목록, localStorage seed). 새 project에서 session을 만들고 model을 고른다. "핵심 사용자 흐름"은 이 한 file 2 test뿐.
4. **core `session-execution` it.effect 30개**(1,260줄, 평균 ~40줄): TestClock으로 시간을 직접 넘기며 claim/resume/interrupt 상태기계를 단정. process 없음.
- 단정 대상: UI에서 보이는 것, exit code·stderr, 상태 전이, 요청 라우팅. 정확한 pixel·CSS는 "그 측정이 contract일 때 owner keeper에서 한 번만".

### 2.4 고르는 기준 (이 조사에서 가장 명시적)
- `packages/app/AGENTS.md` Tests 절: test 하나 추가 전에 세 질문. (1) 어떤 관찰 가능한 contract를 지키나 (2) 어떤 현실적 회귀에서 깨지나 (3) 왜 기존 test가 그걸 못 잡나. 답이 하나라도 없으면 쓰지 않는다.
  - **한 contract, 한 owner**: 가장 강한 boundary 한 곳에서만(area의 e2e keeper 또는 module unit). 기존 table/keeper case를 늘리고 새 file을 만들지 않는다. component test가 증명한 contract는 e2e에서 또 증명하지 않는다.
  - 하지 말 것: dependency가 하는 일, 값을 통과시키기만 하는 config, source text grep(그 text가 contract일 때만), test 전용 production seam(export, 파라미터, flag, data-* attribute 금지), 테마·방향·viewport·채널마다 같은 case 반복(동작이 다를 때만 table 하나).
  - test는 실패할 수 있어야 한다: code가 만든 값을 단정하지 않고, 단정하는 동작을 mock하지 않고, regression test는 fix 이전 code에서 반드시 실패. 지우거나 옮길 때는 그 contract를 여전히 증명하는 test를 이름으로 댄다.
- `e2e/AGENTS.md`: "area마다 keeper suite 하나(tabs, settings, review, terminal, timeline history). **새 회귀는 새 file이 아니라 keeper의 새 case**." 공유 harness(`utils/`)로만 page를 만든다(spec 안에 routing·fixture 손수 쓰기 금지). `performance/`는 정확성의 증거가 아니다.
- `.opencode/skills/unit-tests`: "느리고 flaky한 이유 목록" 겸 규칙. cli process boot 1회 ~1.3초 CPU이므로 parsing·validation은 in-process로, subprocess test는 file당 1~2개만. "벽시계로 기다리지 말고 시간을 통제". 시간 단정(`performance.now()` < 500ms) 금지. 타이머를 큰 timeout·retry·`skipIf(win32)`로 덮지 않는다. Windows skip은 "그 platform에 능력이 없을 때만, 주석과 함께".
- `.opencode/skills/app-e2e-tests`: 페이지 load가 비용(`goto` 1번 = 요청 ~150개)이므로 "navigate once". 시나리오 하나 안에서 UI 조작으로 상태를 이동. `--repeat-each=10 --workers=5 --retries=0`로 새 test를 반복해서 통과시켜야 push. CI retry는 2번이지만 "retry는 공짜가 아니다".
- PR 템플릿: "Closes #" 칸이 있고 CONTRIBUTING은 "bug fix, chore, **test** PR은 기존 issue를 링크". 이름에는 거의 안 옮겨진다.
- issue 번호: 테스트 file ~1,182개 중 issue/PR URL이 이름·주석에 붙은 곳 3. "regression" 단어는 29 file. 비율로는 회귀 시나리오가 별도로 드러나지 않고 keeper 안에 섞인다. 회귀는 `e2e/regression/`이라는 폴더 이름 자체가 "keeper = 회귀 방지 집합"이라는 뜻.
- 기능당 case 수: 상한 없음. 많은 곳은 settings 34, timeline-stream 37, session-queue 23. 대신 case가 "table"로 접히는 곳이 많다(loop/each 162곳).

### 2.5 같은 시나리오를 여러 조건으로
- Playwright: project 2개(`chromium`, `chromium-touch-scroll`). 터치 스크롤은 별도 project로 빼서 file 하나가 직렬 3~5분을 만들던 것을 전 worker로 분산. 테마·방향 반복은 금지에 가깝다.
- service/cli: `test.each` table. cli의 AppProcess는 `isolatedEnv`(HOME, XDG, DB 격리)로 같은 시나리오를 환경만 바꿔 돌림.
- OS: unit·e2e를 Linux + Windows 둘 다. Windows 전용 실패는 대부분 race라고 분류하고 "asset 응답을 0.6~1.5초 지연시켜 Windows를 흉내"하는 방법을 문서화.
- provider matrix: core `plugin/provider-*.test.ts` 33 file이 provider별로 따로(공통 시나리오 harness 없이 provider마다 복제).

### 2.6 무거워진 것과 줄인 것 (skill 문서가 사례 기록)
- 줄임: service worker 차단을 file마다 두던 11곳이 중복이라 suite 전체 설정 한 줄로 이동. 모든 spec에 `serviceWorkers: block`이 있으면 중복 제거 요구.
- 쪼갬: touch-scroll 37 test를 project로 분리(위). 긴 file은 worker 하나에 묶이므로 "file이 스케줄 단위, 긴 file은 idle tail을 만든다"고 명시.
- 무거워진 예: stress timeline fixture를 쓰는 14 regression file이 "e2e flake의 절반"을 차지 → "scale이 contract일 때만 stress fixture, 아니면 메시지 몇 개". 10-step loop 안 assertion이 backoff 때문에 8초.
- 느려서 옮김: `e2e/performance`는 CI 제외. cli service test가 production 상수(15초 bind-retry, 5초 registration)를 기다려 suite의 절반(60초/2분)을 차지 → timing 논리는 in-process TestClock으로, 실제 process는 exit code·signal·port binding만 "경로당 test 하나".
- flaky 처리: 8건 조사 중 3건이 product bug였다고 기록 → "사용자가 만날 interleaving이면 product를 고치고 assertion은 유지". timeout·retry로 가리는 것을 금지. 대신 `until`/`eventually`를 시간 deadline으로(시도 횟수 loop 금지).

---

## 3. Gemini CLI (`integration-tests/`, `evals/`)

### 3.1 구조
- `integration-tests/`: 번들한 binary(`npm run bundle`)를 실제로 spawn하는 vitest. 기본 `npm test`에 안 들어가고 `npm run test:e2e`. 48 `*.test.ts` + `.responses` 60개(golden), 총 114 entry. retry 2, timeout 5분, 8~16 thread, file 병렬.
- 중요: **48 file 중 fake 응답(`fakeResponsesPath`)을 쓰는 건 19개뿐.** 29 file(file-system, run_shell_command, write_file, replace, list_directory, plan-mode, checkpointing, context-fidelity, ...)은 실제 model을 부른다(CI는 `GEMINI_API_KEY` secret). 이건 lophn에 적용할 수 없는 방식(실제 provider 금지)이라 "무엇을 단정하나"만 참고.
- `evals/`: 별도. 실제 model로 "model이 올바른 tool을 고르나"를 보는 행동 평가. 38 file, 101 case(ALWAYS_PASSES 11 / USUALLY_PASSES 87 / USUALLY_FAILS 1). nightly에서 model별로 3번씩 돌려 0/33/66/100%로 채점.
- unit은 `packages/*`에 914 file. memory-tests, perf-tests는 nightly.

### 3.2 시나리오 묶음 (integration-tests, ~136 it, 29 skip)

| 묶음 | file | it | 비고 |
|---|---|---|---|
| hooks | 2 | 34 | hooks-system 30(2,484줄), hooks-agent-flow 4 |
| file·shell·search tool | 12 | ~39 | run_shell_command 13(6 skip), file-system 6, utf-bom 5, replace 4(3 skip), ripgrep-real 4 |
| MCP·extension·skill | 8 | ~13 | mcp-resources 2, extensions-*, symlink-install, skill-creator-* 5 |
| 출력·오류·종료 | 8 | ~13 | json-output 4, stdout-stderr 2, api-resilience 1, mixed-input-crash 2, ctrl-c-exit, concurrency-limit |
| context·compress·resume·checkpoint | 6 | ~10 | context-compress-interactive 3, checkpointing 2, resume_repro, resume-gc |
| browser agent | 3 | 15 | browser-agent 8, localhost 5, browser-policy 2 (Chrome 없으면 skip) |
| 정책·approval·plan mode | 3 | ~9 | plan-mode 6, user-policy 2, policy-headless 1(table) |
| telemetry·ACP·clipboard·voice | 5 | ~4 | 대부분 skip |
- 기능 하나에 시나리오 1~2개가 기본(list_directory 1, write_file 1, google_web_search 1, parallel-tools 1). 예외 hooks 30은 hook event 종류(BeforeTool, AfterTool, BeforeModel, AfterModel, SessionStart/End, PreCompress, disabled, ask 결정…)마다 1개씩.

### 3.3 시나리오 하나의 크기와 모양 (대표 셋)
1. **api-resilience**: 50줄, test 1개. fake 응답 1번(chunk 3개 중 가운데가 metadata-only). 단계: rig.setup(golden 지정) → CLI 한 번 실행 → 단정: stdout에 두 text 조각이 있고, telemetry event `user_prompt` 가 나옴.
2. **resume_repro**: 42줄. fake 응답 1 file. CLI를 2번 실행(첫 run으로 session 생성, 둘째 `--resume latest`). 단정: stdout에 문구 하나. 이름이 repro = 버그 재현에서 나온 시나리오(`resume_repro`).
3. **hooks-system "should block tool execution when hook returns block decision"**: ~65줄. fake 응답 1 file(model이 write_file을 호출). 임시 script file(hook)을 만들어 settings로 연결 → CLI 실행. 단정 3개: tool log에서 write_file 성공이 0건, stdout에 차단 사유, telemetry `hook_call` 존재. 즉 (tool 호출 기록 + 화면 출력 + telemetry) 세 관점.
- hooks 30 test는 22개 `.responses`를 공유(여러 test가 같은 녹화 재사용). 1 test = fake 1~3번.
- 단정 수단: stdout 문자열, `rig.readToolLogs()`(tool 호출 기록), `waitForTelemetryEvent`, file 내용, exit code. 요청 body 단정은 거의 없다.

### 3.4 고르는 기준
- `docs/integration-tests.md`: integration은 기본 test에서 빼고 bundle 이후 수동·CI. **새 integration test를 추가하기 전에 deflake script(또는 `deflake.yml` workflow)로 최소 5번 연속 통과**. golden 갱신은 `REGENERATE_MODEL_GOLDENS=true`(개인 정보가 녹화에 섞였는지 검토 경고).
- `evals/README.md`(가장 선명한 선택 기준):
  - integration test는 "시스템이 올바르게 동작하나", eval은 "model이 올바른 행동을 *고르나*". 둘을 구분.
  - **Less is more**: unit test 같은 작은 case를 많이 말고, 실제 workspace(2~3 file)가 있는 현실적 시나리오를 적게. 너무 단순한 것(잡학 질문)도, 수십 file 짜리도 나쁨.
  - **Fail first**: fix 전에 실패하는 시나리오만 가치가 있다. "공짜로 통과하는 test를 만들지 말 것".
  - 모호하지 않은 단정(정확한 string/AST, tool 인자), prose 단정 금지. tool 호출만 단정하면 다른 이유로도 호출될 수 있어 나쁨.
  - 승격 규칙: 새 eval은 반드시 USUALLY_PASSES로 시작, nightly 7회 이상 통과 후에야 ALWAYS_PASSES(PR 차단). `eval:validate` lint가 구조 규칙(정적 이름, 최소 한 개 tool 단정, files 설정 등)을 강제.
- PR 템플릿: "Added/updated tests (if needed)" 체크박스, 검증한 platform(macOS/Windows/Linux × npm run/npx/docker/podman/seatbelt) 체크. 시나리오 선택 기준은 없음.
- issue 번호 비율: integration 136 it 중 번호가 붙은 건 ~7(5%). 거의 다 skip·TODO 주석(`TODO(#14527) 고쳐지면 다시 켠다`, `TODO(#11062)`, `TODO(#11966) race`) 아니면 회귀 설명(browser-agent의 `#24210` 회귀, browser-policy의 `#24382`, compress의 `#25753` 게이트). "issue가 이름에 붙은 시나리오 = 대개 지금 꺼져 있거나 한 번 깨졌던 것".

### 3.5 같은 시나리오를 여러 조건으로
- **sandbox matrix**: `sandbox:none | docker | podman`(npm script와 CI matrix). 시나리오는 그대로, 환경 변수로 sandbox를 바꿔 같은 test 전체를 3번. 일부 test는 `isDockerSandbox`면 skip(browser-policy).
- OS: 개별 `skipIf(darwin)`, `runIfLinux`, Chrome 유무 skipIf. PR 템플릿이 사람이 platform별로 확인하게 맡김.
- table-driven: `policy-headless`는 (command, tool, 성공·실패 기대) 목록을 PromptCommand 객체로 정의하고 정책 조합에 돌림. provider matrix는 없음(model 하나, eval에서만 model별 3회).

### 3.6 무거워진 것과 줄인 것
- **꺼진 시나리오가 많다**: 29/136 = 21%가 `it.skip`(replace 3/4, run_shell_command 6/13, 일부 file 전체). `skipFlaky` 환경 변수(`RUN_FLAKY_INTEGRATION`)로 flaky 4 file(file-system-interactive, ctrl-c-exit 등)을 기본 off. 즉 "flaky하면 지우지 않고 끄고, issue 번호로 TODO". 실제 model 의존이 flaky의 주 원인.
- 무거워진 예: hooks-system.test.ts 2,484줄 30 test(평균 83줄), run_shell_command 645줄.
- 느려서 분리: integration을 기본 `npm test`에서 뺌, memory/perf는 nightly, eval은 nightly 3회×model, 필요 시 `deflake.yml` workflow.
- retry 2번을 config에 넣어 flaky를 흡수(사용자가 "retry는 공짜가 아니다"라 쓴 OpenCode와 대조).

---

## 4. Goose (`block/goose`)

### 4.1 구조
- 두 층: (a) `crates/goose/tests`(245 test, 약 30 file) integration, (b) src 안 inline unit 4,107. AGENTS.md: "Test: tests/ 폴더를 선호".
- **ACP 공통 시나리오 36개**(`acp_common_tests/mod.rs`, 1,594줄, `pub async fn run_*<C: Connection>()`): 같은 시나리오 본문을 `Connection` trait 구현 두 개(`AcpServerConnection`: in-process ACP server에 직접, `AcpProviderConnection`: goose가 ACP client provider로 붙는 쪽)에 돌린다. 서버 쪽 file `acp_server_test.rs` 54 test(공통 33개 + 서버 전용 ~21), provider 쪽 `acp_provider_test.rs` 22 test(공통 22개 중 9개는 `#[ignore = "이유"]`).
- fake: OpenAI wire를 흉내 내는 `OpenAiFixture`(요청 body에 포함될 문자열 → canned SSE `.txt` 파일 쌍의 목록; 19개 canned file `acp_test_data/`), `McpFixture`(진짜 MCP server를 fixture로). 요청에서 session id header 강제 검사(`EnforceSessionId`).
- agent loop(`agent.rs` 22 test, `compaction.rs`)는 process 없이 scripted `Provider` trait 구현체(MockToolProvider, MultiStepProvider, GoalTextProvider 등)를 주입.
- 실제 provider 계약 test(`providers.rs` 18 test: openai, azure, bedrock, databricks, ollama, anthropic, openrouter, google, snowflake, sagemaker, litellm...)는 자격이 없으면 건너뛰고 별도 workflow `pr-smoke-test`(Live Provider Tests)에서만 돈다. 같은 12여 가지 capability 검사(basic, tool usage, context 초과 오류, image, model switch, thinking effort, model listing, permission allow/deny, smart approve, mode update)를 provider마다 flag로 켜고 끈다.
- MCP: `mcp_integration_test`(replay file 3종 녹화), `goose-cli/tests/mcp-conformance`(버전별 expected-failures yaml).
- 또 `goose-self-test.yaml`: goose 자신이 자기 도구로 자기를 시험하는 recipe(사람이 돌림, 자동 CI 아님).

### 4.2 시나리오 묶음 (ACP 공통 36 + 그 밖)

| 묶음 | 개수 | 예 |
|---|---|---|
| session list·close·delete·rename·load | 9 | run_list_sessions, run_close_session, run_delete_session, run_session_name_update_notification, run_load_mode/model/session_mcp/session_error/replays_image |
| 설정·mode·model | 12 | run_config_mcp, run_config_option_mode_set/model_set/set_error, run_mode_set(+error), run_model_set(+error), run_model_list, run_new_session_returns_initial_config/uses_current_config_mode |
| prompt(model 호출) | 8 | run_prompt_basic, _codemode, _error, _image, _image_attachment, _mcp, _model_mismatch, _skill |
| 승인(permission) | 1 | run_permission_persistence (5 결정을 한 시나리오 안 table) |
| fs·shell(client capability) | 5 | run_fs_read_text_file_true, run_fs_write_text_file_true/false, run_shell_terminal_true/false |
| 기타 | 1 | run_initialize_doesnt_hit_provider (provider를 안 부르는 것을 증명) |
- 그 밖 integration: agent loop 22(schedule tool, retry·validation, max_turns, 요약 배치, thinking 보존 4, goal 4, token 합산, streaming 영속), custom request(`acp_custom_requests_test` 44), transport auth 35, session id 전파 7, tetrate streaming 12, schedule 보안 8, subprocess 정리 2.

### 4.3 시나리오 하나의 크기와 모양 (대표 셋)
1. **run_prompt_basic**: ~48줄. fake 1번. 단계: fixture → connection 열기 → session 만들기 → prompt "what is 1+1" → 단정: 응답 text "2", agent message chunk의 id 두 종류가 일치, notification 종류 열, 요청에 session id가 맞게 실림.
2. **run_permission_persistence**: ~62줄. fake 2번(tool call, tool result)을 5개 결정(AllowAlways, AllowOnce, RejectAlways, RejectOnce, Cancel)에 반복. 단정: tool 상태(Completed/Failed)와 디스크의 `permission.yaml` 내용. "승인 → 영속"을 한 시나리오 안에서 table로 닫음.
3. **agent.rs test_goal_nudges_agent_before_exit**: ~87줄, scripted provider가 call_count를 셈. 단정: provider 호출 횟수 범위(1 초과 3 이하), 내부 nudge message가 사용자에게 안 보임, session의 goal 상태가 비워짐.
- 단정 대상: 응답 text, protocol notification 열, 디스크 file(permission.yaml), 보낸 요청의 header, 호출 횟수. 화면 없음(ACP).

### 4.4 고르는 기준
- 문서: AGENTS.md "tests/ 폴더 선호, 기능 추가 시 goose-self-test.yaml 갱신". CONTRIBUTING에 AI가 쓰는 test의 나쁜 버릇 목록: "trivial test", "의도가 아니라 구현을 test", "아무것도 안 보는 test를 잔뜩". 즉 **개수 억제 규칙은 없지만 질의 규칙은 있다**(lophn AGENTS.md와 같은 문제의식).
- 기능(ACP method) 하나에 공통 시나리오 1개, 필요할 때만 서버 전용 test가 옆에 붙는다. session list는 pagination, query filter, types override, invalid params 등 case가 6개로 늘어난 예외.
- issue 번호: test 파일 안 ~9곳, "Regression test for #10401" 명시는 한 곳(custom model이 provider 목록에 없어도 default로 저장됨). 245 중 ~1개(<0.5%). 나머지 회귀는 일반 이름.
- ignore 이유는 항상 문자열로 남긴다(예: "delete는 server 전용 method라 provider를 안 거친다", "ACP provider에서 load_session 미구현 TODO", "provider는 buffered file change를 안 다룬다"). 즉 matrix에서 안 맞는 칸은 이유와 함께 명시적으로 비워 둔다.

### 4.5 같은 시나리오를 여러 조건으로
- **transport matrix**: 공통 시나리오 본문 1벌 × Connection 구현 2개. 시나리오를 한 번만 쓰고, 두 층에서 같은 contract를 검증.
- provider × capability matrix(live, 별도 workflow). TLS backend(rustls/native) feature matrix. OS는 build workflow(mac/win/linux)에서.
- permission 시나리오 안의 5 결정 table, `serial` + env lock으로 환경 변수를 쓰는 test 직렬화.

### 4.6 무거워진 것과 줄인 것
- 한 file `acp_common_tests/mod.rs` 1,594줄, `acp_server_test.rs` 1,287줄, `agent.rs` 2,772줄: 커졌지만 "공통 본문 + 얇은 호출 두 줄"로 중복은 억제.
- 빠짐: provider 쪽에서 9/22를 이유와 함께 `#[ignore]`로 꺼 둠(미구현·구조상 불가). live provider test는 PR 기본 CI에서 분리(자격 필요).
- flaky 대응: 환경 lock(`ACP_TEST_LOCK`), 시계·id는 fixture에서 주입, MCP는 녹화 replay.

---

## 5. flow case 잡는 법: 공통 원칙

1. **contract 하나에 owner 하나, 층은 가장 싼 곳**. OpenCode "한 contract, 한 owner, 가장 강한 boundary 한 곳"; Goose는 시나리오 본문 1벌을 두 transport에 재사용; Codex는 unit : integration이 1:1이지만 이름·중복 규칙이 없어 같은 것을 core·app-server·exec에서 거듭 확인하는 모습(예: approval이 core approvals, app-server turn_start approval, exec approval_policy에 따로)이 보인다. 그 반면교사로 삼는다.
2. **process를 띄우는 시나리오는 "process 경계에서만 보이는 것"으로 한정**. OpenCode unit-tests skill: subprocess는 file당 1~2개, exit code·signal·stdio·port binding만, 시간 논리는 in-process 시계 주입. Codex exec의 `server_error_exit`(25줄, exit code 하나), Gemini `resume_repro`(CLI 2회 호출로 resume 경계 확인)도 그 모양. Codex app-server는 JSON-RPC child를 띄우는 비용 때문에 test group `max-threads 1`로 직렬화해야 했다 = 비싸다.
3. **한 시나리오는 작게: 단계 ≤ ~6, fake 응답 1~3번, 단정 1~3개**. 근거: Codex 평균 72줄/test(fake 1~3), OpenCode e2e 49줄, Gemini hooks 65~83줄(fake 1~3), Goose 48~62줄(fake 1~2). 175줄짜리 `astra_*` multi-turn은 snapshot 하나로 여러 가지를 한 번에 고정하는 용도로 의도적으로만.
4. **단정은 사람이 볼 문구가 아니라 관찰 가능한 사실**: (a) fake가 받은 요청의 구조·횟수(Codex, Goose의 header·호출 수), (b) event/notification 열, (c) 디스크 file 내용(Goose permission.yaml, Codex rollout), (d) exit code, (e) tool 호출 기록·telemetry(Gemini). Gemini evals: "prose 단정 금지, tool 호출 하나만 보는 것도 나쁨(다른 이유로 통과)". 요청 body 전체는 snapshot으로(Codex insta 102개) 두되 volatile 값을 normalizer로 치환.
5. **table-driven으로 matrix를 한 시나리오 본문에 접는다**: Codex approvals ScenarioSpec 57개(정책 × 동작) → runner 하나·test 5개, Goose permission 5 결정, Gemini sandbox none/docker/podman은 env로 전체 반복, OpenCode "같은 case를 테마·viewport마다 반복하지 말고 table 하나, 동작이 다를 때만". 그리고 **matrix에서 안 맞는 칸은 이유와 함께 명시적으로 비운다**(Goose `ignore = "이유"`).
6. **회귀는 "새 file"이 아니라 "그 area의 owner suite에 case 하나"**. OpenCode keeper 규칙, "fix 전 code에서 실패하는 것만"(OpenCode + Gemini evals Fail First). 세 harness 모두 issue 번호를 이름에 안 붙인다(Codex ~0, OpenCode 3/1,182 file, Goose 1/245, Gemini ~5%이며 대부분 꺼진 test). 회귀 비율은 이름으로 측정할 수 없고, 쓰이는 곳은 "skip 이유"와 "한 번 깨졌던 조건 설명 주석".
7. **flaky는 만든 뒤 끄지 말고 만들기 전에 반복 실행으로 거른다 + 시간은 주입**. Gemini: 새 integration test는 5회 연속 통과 후에만, 그래도 29/136(21%)이 skip으로 남아 썩음(꺼진 test는 지우지 않으면 부채). OpenCode: `--repeat-each=10 --workers=N --retries=0`, 벽시계 대기·attempt count loop 금지, deadline 방식. Codex: chunk gate가 있는 streaming server, retry 횟수를 provider config로 명시, 시계·env 전역 안 건드림. retry로 흡수(Gemini retry 2, Codex retries 1)는 가시성을 떨어뜨린다.
8. **무거운 시나리오는 층을 바꿔 다른 칸에서 한 번만**. OpenCode: timing 논리는 TestClock, 실제 process는 경로당 하나; component test가 증명한 것은 e2e에서 또 증명하지 않음. Gemini: eval(모델 선택)과 integration(시스템 동작) 분리, 기본 CI 밖(nightly)으로 이동. Codex: 느린 module에 test-group·slow-timeout, "새 test 추가 금지" 딱지.
9. **새 시나리오는 비차단으로 시작해 승격**: Gemini evals의 USUALLY_PASSES → nightly 7회 → ALWAYS_PASSES(PR 차단). 우리는 model이 fake라 flaky 원인은 timing·process뿐이지만, 새 E2E는 "내보내는 날부터 차단"보다 반복 통과 확인 후 차단이 안전.

### 반면교사 (피할 것)
- "기능 하나에 file 하나, 변형마다 test"(Codex compact 61, code_mode 164, rmcp_client 69): 한 file 6,000~9,000줄, 느려져서 timeout override와 group을 계속 추가하는 상태.
- provider마다 복제(OpenCode plugin/provider-*.test 33 file): 공통 본문 없이 복제 → Goose식 공통 `run_*<C>`가 낫다.
- skip 누적(Gemini 21%), 실제 model 의존, retry 흡수.
- 이름에 issue 번호를 붙여 "회귀" 목록처럼 쓰기(실제로 어느 harness도 안 함).

---

## 6. lophn에 맞는 시나리오 고르기 규칙 (추천)

lophn AGENTS.md의 원칙(데이터 잃기·권한·sandbox·secret 경계·두 번 고친 bug만 테스트, 작업당 몇 개, subprocess·server·E2E는 새로 만들기 전에 사람에게 묻기)과 위 원칙을 합친 추천안이다. 정할 수 없는 부분은 "추천"으로 표시.

### 6.1 두 층의 역할 나누기
| | harness test (agent loop, process 없음, scripted fake) | core E2E (제품 process 전체, 임시 data root, HTTP fake) |
|---|---|---|
| 보는 것 | loop 의미: tool call → 결과 → 다음 요청, approval 정책, compact·한도, retry, 중단, rewind 계산, tool 인자 오류 | process 경계에서만 보이는 것: 기동·종료, 프로토콜 왕복, data root 영속(재시작 뒤 복구), child crash 복구, 실제 file 쓰기·되돌리기, 경계 밖 쓰기 거부, secret이 event·log로 새는가 |
| 단정 | fake가 받은 요청 구조·횟수, event 열, 디스크 file | HTTP로 받은 요청, event stream, 디스크 file, exit code, data root 안 파일 |
| 개수 (추천) | 기능(contract)당 1~3, 정책 matrix는 table 하나 | 전체 10~15개 안팎. 아래 후보 목록을 상한으로 |
| 반복 | table-driven, 새 case는 table에 한 줄 | 시나리오 본문은 harness와 공유, 실제 process는 대표만 |

### 6.2 고르는 규칙
1. **세 질문(OpenCode)을 통과해야 쓴다**: 어떤 계약(boundary-catalog ID)을 지키나 / 어떤 현실적 회귀에서 깨지나 / 왜 기존 test가 못 잡나. 답이 없으면 쓰지 않는다. 시나리오 이름·주석에 boundary ID를 한 번 단다(issue 번호 대신).
2. **AGENTS.md의 위험 목록에 닿을 때만**: 사용자 data 손실·훼손, 권한·secret·sandbox 경계, 두 번 이상 고친 bug. 화면·문구·내부 구현은 제외. "기능이 있으니까 case 하나"는 금지.
3. **owner는 한 층**: harness로 증명된 loop 의미를 E2E에서 또 증명하지 않는다. E2E에서는 "process를 넘어서야만 깨지는 것"만. 어떤 contract를 E2E에서 증명하면 harness에서는 지운다(둘 다 두려면 이유를 적는다).
4. **시나리오 본문 1벌, 실행 2곳(추천)**: Goose의 `Connection` 방식처럼 "scripted fake 대본 + 사용자 단계 + 기대 사실"을 data로 두고 harness는 전부, E2E는 `e2e` 표시가 붙은 대표만 돌린다. 이렇게 하면 두 층이 같은 contract를 다른 방식으로 말하지 않는다. 필요한 만큼만 만든다(공통 장치는 첫 두 시나리오가 생긴 뒤 뽑는다).
5. **크기 상한**: 단계 ≤ 6, fake 응답 ≤ 3, 단정 ≤ 3, 한 시나리오 ≤ ~60줄(harness) / ~80줄(E2E). 넘으면 쪼개거나 층을 바꾼다. snapshot은 "모델이 본 request"에만 쓰고 volatile 값(id·시각·경로)은 normalizer로 치환.
6. **matrix는 table 한 줄**: approval 정책 × 동작, sandbox 경계 × 경로 종류, 오류 종류(429·5xx·끊긴 stream) 등은 table 하나로 접고 case는 한 줄 추가로. 안 맞는 칸은 이유와 함께 비움. OS·transport matrix는 만들지 않는다(필요해질 때).
7. **회귀는 owner suite에 case 하나**: 새 file 금지. fix 전 code에서 실패함을 확인(변경 기록에 한 줄). 이름은 동작으로, issue 번호는 skip 이유·주석에만.
8. **시간은 주입, 대기는 신호**: 벽시계 대기·시도 횟수 loop 금지(deadline은 시간 단위로). 중단·streaming 시나리오는 chunk gate(fake가 test 신호를 받아야 다음 chunk를 보냄)로 결정적으로. 새 E2E는 `--repeat 10` 같은 반복 통과를 확인 후 넣는다. 대기가 필요한 production 상수는 option으로 짧게 하되 test 전용 seam을 늘리지 않는다(OpenCode app/desktop은 금지, core는 허용이라는 구분 참고).
9. **꺼 두지 말고 지운다**: skip 누적은 부채(Gemini 21%). flaky하면 원인(process race·gate 부재)을 고치거나 시나리오를 harness로 내린다. 설계와 안 맞게 된 시나리오는 고치지 말고 지우고 새 설계로 다시 쓴다(AGENTS.md 호환성 절과 일치).
10. **E2E는 새로 만들기 전에 사람에게 묻는다**(AGENTS.md). 아래 후보 목록은 "물어볼 안"이다.

### 6.3 core E2E 후보 (상한 안, 위험 목록 기준 — 추천)
1. 기동 → turn 1번(tool 없는 응답) → 종료 → 재시작 → session이 data root에서 복구됨. (사용자 data 영속)
2. tool 호출로 workspace file 쓰기 → approval 요청 → 허락 → file 내용 확인. (approval 왕복)
3. 같은 흐름에서 거부 → file이 없음, 거부 결과가 다음 모델 요청에 실림. (권한 경계)
4. 두 번 수정 → rewind → file이 첫 상태로 복원, 이후 대화도 일관. (되돌리기. 데이터 훼손 위험이 가장 큼)
5. workspace 밖 경로 쓰기·읽기 시도 → 거부(sandbox 경계).
6. runtime child를 죽임(crash) → core가 복구하고 session·미완 approval 상태가 안전.
7. fake가 429 / 끊긴 stream → retry 후 성공 또는 오류 event(공통 오류 코드)로 보고, 부분 응답이 저장 데이터를 오염시키지 않음.
8. secret(API key 등)이 event stream·로그·data root에 평문으로 나타나지 않음.
9. 앱 process 연결 끊김/재연결 시 진행 중 turn과 approval 동기화(해당 기능이 있다면).
10. 임시 data root 밖(`~/.lophn`)을 건드리지 않는다는 확인(harness 층에서도 가능하니 E2E에는 1줄 단정만).

### 6.4 harness test 후보 (table 우선)
- approval 정책 × 동작(read/write/shell/network) × sandbox 모드 table 하나. 기대는 "물어봄 / 자동 허락 / 거부".
- loop: 다중 tool call 한 응답에서 병렬 호출 순서, 잘못된 tool 인자(재요청), max turn, 빈 응답, tool 결과 truncation.
- compact·한도: 임계값 직전/직후, compact 요청 실패 시 history 보존, resume 후 임계 초과.
- 중단: streaming 도중 interrupt(gate) → 부분 출력 처리, 이어서 새 입력.
- rewind 계산: 여러 edit·삭제·rename 뒤 되돌리기, 다른 파일 영향 없음.
- retry: 횟수·간격 범위(시계 주입), 지속 실패 시 종료 상태.
- 여러 agent가 있다면 mailbox 순서·종료 전파는 한 시나리오씩.

### 6.5 한 줄 요약
"위험 목록에 닿는 계약마다 시나리오 하나를 가장 싼 층에 두고, matrix는 table 한 줄로 접고, process를 띄우는 것은 process 경계에서만 보이는 열 가지 안팎으로 묶고, 회귀는 owner suite에 case로 넣고, 꺼 두지 말고 지운다."
