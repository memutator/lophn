# 조사: desktop·IDE agent 앱과 platform의 E2E·integration flow case 고르기

조사 방법: 각 repo를 `--depth 1`로 clone해 test file 이름, 개수, 줄 수, README·AGENTS·CONTRIBUTING를 읽었다. 코드는 실행하지 않았고 복사도 하지 않았다. shallow clone이라 git history가 없어서 "bug 회귀로 생긴 비율"은 주석에 적힌 "regression"/"bug" 표시 개수로만 추정했다 (추정이라고 표시함). 개수는 grep 기반이라 +-10% 오차가 있다. 기준 시점은 repo 최신(2026-10 중순).

대상 요약

| 대상 | 가장 가까운 "E2E" | 가장 가까운 "harness test" | model |
|---|---|---|---|
| Mastra (mastracode TUI/web + core loop) | TUI scenario 약 229 file, web scenario 39 file | core loop AIMock scenario 104 file / 226 test | AIMock HTTP fake (json fixture) |
| OpenHands (agent-canvas UI + agent-server) | Playwright mock-LLM 약 83 test + live 2 test | software-agent-sdk `tests/sdk` 등 649 file | Python mock LLM server (scripted trajectory) |
| Cline | VS Code Playwright 약 10 test, CLI e2e 약 60 test | `agent-runtime.test.ts` 107 test (ScriptedModel) | HTTP mock server(keyword 분기), ScriptedModel |
| Continue | VS Code(selenium) 약 25 test, CLI e2e 약 60 test | (CLI service 단위) | mock LLM server, config의 mock provider |
| Zed | 없음(전체 app process E2E 없음) | `agent/src/tests/mod.rs` 119 test + gpui UI test 수백 개 | FakeLanguageModel (이벤트 직접 주입) |
| Roo Code | VS Code E2E 약 40 test | - | 실제 model(OpenRouter) |

---

## 1. Mastra

### 1-A. mastracode TUI E2E (제품 process 전체에 가장 가까움)
- 위치: `mastracode/tui/e2e/tui/` (scenario .ts 약 229개, 총 약 24k줄), fixture `mastracode/tui/e2e/fixtures/*.json` 111개 (AIMock script).
- 실행: 같은 process 안에서 Mastra Code app을 만들고 `@xterm/headless` terminal을 꽂는다 (subprocess를 안 띄움). shard 4개로 나눠 CI 한 job. smoke 3개(`startup`, `automated-chat`, `modal-and-shell`)는 따로 있다.
- 지침(AGENTS.md): "TUI에 보이는 동작은 checked-in TUI E2E가 있어야 한다". 실제 사용자 local data는 읽어서 deterministic fixture로 sanitize.

묶음 (file 이름 prefix 기준, 대략)

| 묶음 | 개수 | 예 |
|---|---|---|
| browser (설정·wizard·상태) | 12 | browser-toggle-attach, browser-tool-unavailable |
| custom provider/pack 설정 | 약 13 | custom-provider-management, custom-pack-import-rename |
| om (observational memory) 설정·복원 | 9 | om-threshold-persistence |
| mcp (연결·oauth·재연결·도구 호출) | 9 | mcp-http-tool-call, mcp-long-running-tool |
| goal (judge, max runs, 새 thread 생존) | 9 | goal-max-runs-ends-goal, goal-judge-esc-pause |
| github signals / notification | 약 13 | github-signals-polling-inbox |
| shell (grouped, passthrough) | 7 | shell-passthrough-during-run |
| plan approval | 4 | plan-approval-request-changes |
| 중단·후속 (abort, steer, queue) | 약 6 | abort-followup (+escape off/durable/evented 변형), steer-drain-failure-recovery |
| subagent / background | 7 | subagent-delegation, background-adoption |
| task / tool 표시 | 8 | task-patch-tools, tool-history-parity |
| 허락·hook (permission, lifecycle) | 약 5 | permission-request-hook, request-access-modal |
| login/api-key/model 선택 | 약 15 | api-key-prompt, model-search |
| 복원·legacy (startup restore, legacy settings) | 약 8 | legacy-settings-upgrade, initial-prompt-resume |
| streaming/render 안정성 | 약 5 | streaming-render-stability, terminal-resize-reflow |
| 기타 (slash command, skills, plugins 등) | 나머지 | custom-slash-command, plugins-local-hot-reload |

- 숫자로 보면 "agent loop 핵심 flow"(대화·tool·허락·중단)는 20~30개이고, 나머지 200개는 설정·화면·연동이다.

### 1-B. mastracode web E2E
- `mastracode/web/e2e/web/*.scenario.test.ts` 39 file, 합 2,492줄, file당 평균 64줄, 대부분 `it` 1~2개. 같은 flow(tool-approval, steer-abort, thread-*, sse-reconnect, stream-error-retry…)를 web driver로 다시 잡았다.
- 대표: tool-approval은 36줄, `it` 1개, fake 대답 2번(write tool 호출 → 마무리 text). driver 메서드(submit, waitForApproval, approve, waitForText)로 진행하고, 마지막에 disk의 file 내용 하나만 단정.

### 1-C. core loop AIMock scenario (harness test)
- `packages/core/src/loop/test-utils/aimock/scenarios/` 104 file, 226 test, 합 14.5k줄 (file당 평균 139줄, test당 약 64줄). 기반 코드 `aimock-scenario.ts` 623줄 + `types.ts` 413줄.
- README가 만든 이유를 적었다: loop 단계별 unit은 통과하는데 단계들의 composition(tool result 연결, turn 간 message 순서, 긴 loop의 stop 조건)이 깨지는 회귀가 mastracode에서야 발견됐다. 그래서 loop 전체를 실제 provider(OpenAI SDK)로 돌리고 baseURL만 AIMock으로 돌렸다.
- 단정은 항상 둘: (1) loop 출력(text, toolResults, chunk), (2) model로 보낸 turn별 HTTP request body (`requests[n].body.messages`, `.tools`).
- 57/104 file 상단에 "Regression class: ..." 주석이 있다 (회귀 종류를 한 줄로 적는 관례). 

묶음 (file 이름 기준)

| 묶음 | file 수 | 예 |
|---|---|---|
| structured output | 7 | structured-output-repair, ...-with-tools |
| 허락·suspend/resume | 약 10 | tool-approval, concurrent-approval, resume-after-decline, suspended-snapshot-integrity |
| 중단·signal | 약 12 | abort-signal, abort-during-tool-execution, signal-* |
| 오류·재시도·processor | 약 14 | provider-error, stream-error-retry, error-processor-retry-exhaustion, model-retry-after |
| 최대 단계·종료 조건 | 약 9 | max-steps-edge-cases, stop-condition-long-loop, is-task-complete-* |
| goal | 5 | goal-satisfied, goal-budget-exhausted |
| subagent·delegation·background | 약 16 | agents-as-tools, delegation-*, background-task-* |
| memory | 약 8 | memory-multi-turn-persistence, memory-thread-switch, working-memory |
| tool 종류·lifecycle | 약 10 | multi-tool-parallel, client-tools, tool-lifecycle-hooks, tool-streaming |
| 동적 설정 (instructions, model, request context, skills) | 약 10 | dynamic-model, request-context-isolation, skills-* |
| 기타 (fs-routed, workspace, observability) | 나머지 | |

- 같은 scenario를 engine 변형(normal / durable / fs)으로 `describeForAllEngines`가 자동 반복. 표현 못 하는 변형은 `skip` 목록으로 뺀다. 즉 "flow 1개 x 변형 N"을 case 수를 늘리지 않고 얻는다.

한 scenario의 모양 (approval-tool-level 75줄)
- 도구 2개(허락 필요 / 불필요) 정의 → 대본 2줄(1턴: tool 호출 2개, 2턴: 최종 text) → 허락 결정 callback → 단정 3개(허락 요청 정확히 1건, model 호출 2번 이상, 최종 text). 파일 머리에 "무슨 회귀 class인지" 설명.
- abort-followup (TUI, 88줄): 대본 2개(느린 stream, 후속 대답), terminal에서 입력·Esc/Ctrl+C·후속 입력, 화면 text 대기 6번, 마지막에 model request 정확히 2개 + 각 request에 해당 prompt 포함 단정. 헤더에 원인 코드(어느 함수의 어떤 검사가 빠졌었나)를 적음.

### 1-D. 무거워진 것, 줄인 것
- `mastracode/tui/e2e/TODO.md`: 19개 TUI scenario가 `skipReason`으로 멈춰 있다 ("current main 동작이 scenario 기대와 어긋남"). 원인 대부분은 fixture가 내부 request 모양(task-state가 request에 들어가는 방식, subagent 진행 표시, goal judge의 structured output)에 묶여 있어서, 제품 동작이 바뀌면 fixture가 안 맞는 것. goal 관련 3개는 같은 원인 하나로 한꺼번에 멈춤. 교훈: model request의 정확한 모양에 묶인 fixture는 설계가 바뀔 때 무더기로 깨진다.
- shard 4개로 분할, subprocess 없는 in-process runner로 이동: 속도 때문.

---

## 2. OpenHands

- 현재 `OpenHands/OpenHands` repo는 agent-canvas(UI + 번들 binary). Python agent는 `OpenHands/software-agent-sdk`.
- 규칙: AGENTS.md "Testing Baseline", `.agents/skills/e2e-testing/references/guide.md`.
  - "가장 싼 suite 중 변경된 실제 경계를 실행하는 것을 고른다."
  - 행동에 집중, test 수는 최소, 같은 조건 두 번 단정 금지, hook이 아니라 그 밑의 service를 mock, 기존 test file에 추가 우선.
  - AGENTS.md: "Cartesian product를 다 테스트하지 말고, 제어/데이터 흐름이 다른 경로만 각각 하나".
  - 소스 상수·문구·class 문자열을 test에 그대로 복사해 단정하지 말 것.
  - 버그 고칠 때 먼저 TDD test (행동 변경에 한함).
- E2E 세 층 (분리 원칙이 분명함)
  1. 일반 Playwright(`tests/e2e/*.spec.ts` 6 file, MSW mock). 
  2. mock-LLM E2E: 실제 `agent-canvas` binary(npm 배포본과 동일) + 실제 agent-server + 실제 automation backend + Python mock LLM server. 약 83 test / 30 file, `workers:1`, describe는 serial. Docker image용 config가 같은 spec을 재사용.
  3. live E2E: 실제 LLM, 2 test만 (bash tool 한 번 + critic 표시). main push 뒤에만 CI에서 돌고 PR에서는 안 돌림. 비용·secret 때문.
- mock LLM server: 대본(trajectory)을 admin API로 등록/활성/초기화. 각 turn은 `{tool_call}` 또는 `{text}`. 보낸 request 기록을 `GET /admin/requests`로 가져와 단정(예: image가 base64로 model에 갔는가). prompt는 무시하고 대본을 순서대로 꺼냄(deque).

묶음 (mock-LLM, 디렉터리별 test 수 추정)

| 묶음 | 개수 | 내용 |
|---|---|---|
| backends (auth mode, cross-connect, partial stack) | 18 | backend 연결·인증 조합 |
| settings (profile, ACP agent, model switch, provider) | 13 | LLM profile 관리 |
| regressions (CSS 격리, pagination, workspace 유지) | 12 | UI 회귀, 이름 그대로 회귀 모음 |
| mcp (GitHub, Slack credential) | 11 | marketplace·credential |
| conversations (대화, image 업로드, message confirm) | 7 | 핵심 flow 4 step + image 1 + confirm 2 |
| files/git | 6 | |
| automations | 5 | |
| canvas extensions | 4 | install → enable → render → uninstall |
| onboarding | 3 | |
| skills | 3 | project/user skill 활성, 삭제 |
| home/workspace | 1 | |

- 핵심 대화 flow(`mock-llm-conversation`) 재료: step1 profile 생성(UI) → step2 활성(API 검증) → step3 대화 실행 → step4 sidebar로 재진입. 서로 앞 step 결과(conversationId)를 공유하는 serial 구조라 앞이 깨지면 뒤가 `skip`된다.
- step3(약 100줄 본문)의 단정은 서로 다른 source of truth 넷: 대화 생성 request payload(`worktree: true`), bash event API의 성공 observation, conversation events API의 agent 답, 화면의 답 token.
- software-agent-sdk `tests/integration/tests` (real LLM, 매일 밤 nightly, PR에는 안 돌림): a01~a08 = tool use/result 짝이 어긋난 history (API 호환성) 8, b01~b05 = 행동 규범 5(선택, 릴리스 막지 않음), c01~c05 = condenser(context 줄이기) 5, t01~t10 = 필수 task 10 (typo 수정, bash, file 쓰기, git, browsing, skill 호출…).
  - BEHAVIOR_TESTS.md 규칙: behavior test는 "실제 repo의 과거 commit 상태" 같은 현실적이고 복잡한 것만. 단순한 합성 scenario는 넣지 말 것.
- 같은 repo의 `tests/sdk/*` 등 unit은 649 file. TestLLM(scripted)을 쓰는 file 42개. AGENTS.md: "TOO MUCH test 쓰지 마라, edge case만"; packaging·설치 변경은 mock unit으로 검증 안 됨 → 실제 artifact(Docker, binary)로 확인.
- 줄인 것/무거워진 것: Docker image test를 mock-LLM spec 재사용으로 만들고 PR이 아닌 main 이후/수동에만 돌림(느려서). 변경 파일 → 영향 받는 test 디렉터리를 `test-mapping.json`으로 고르는 selective runner가 있는데 post-merge는 전체 실행. cross-connect spec 하나가 849줄/15 test로 가장 큼.

---

## 3. Cline

- VS Code Playwright E2E (`apps/vscode/src/test/e2e/`): 8 file, 합 약 650줄, test 약 10개(workspace 종류 x2 반복 포함). 
  - auth/API key 1, chat(보내기·모드 전환·slash·@mention 1 + checkpoint 설정 1 = 2), file edit auto-approval 1(x single/multi-root), editor/code action 1, history 비용 표시 1, hooks 2, codex oauth 2(port 점유), powershell background 1.
  - 가장 긴 test는 checkpoint 설정(약 100줄, timeout 180초): "turn 도중 설정을 바꿨을 때 queue된 message 뒤에 적용" 한 가지를 위해 mock server에 '체크포인트 probe를 잡고 있는 gate'를 따로 만들었다. 이런 timing 회귀 하나가 test 하나 + mock server 기능 하나가 된 예.
  - mock server는 keyword 분기: prompt에 특정 문자열이 있으면 tool 호출을 내려주고, 그 tool 결과가 history에 있으면 마무리 text. 고정된 응답 몇 종(기본, edit, powershell, checkpoint probe 2, hook 확인 2).
  - hook E2E 패턴: "hook이 넣은 context가 model request에 실제로 들어갔는가"를 단정하려고, mock server가 request에 그 token이 있으면 한 문장, 없으면 다른 문장으로 답하게 하고 UI에서 그 문장을 본다. (request 단정을 화면 단정으로 바꿈)
  - file-edit test: 승인 없이 자동 승인 → ask row 보임, Reject/Save 단추 없음, 마지막 대사 보임, disk에 실제 변경 있음. 끝에 git으로 추적되는 fixture file을 복원.
- CLI E2E (`apps/cli/src/*.e2e.test.ts`): 3 file. cli.e2e 약 40 test(1,066줄)는 거의 model 없이 subcommand 출력(help, version, history, workflows/rules/skills/agents/plugins/mcp 목록, hook payload 검증, 인자 오류). interactive/tuistory 합 12 test = 화면 전환(Tab 모드, Shift+Tab auto-approve, /settings, history resume + Ctrl+C로 crash 안 남).
  - history resume test 주석: 과거 native crash 회귀 방지용이라고 명시(회귀로 생긴 test).
- SDK core (`sdk/packages/core`) "e2e"는 사실 process 몇 개만 진짜인 integration: hub daemon singleton lock(실제 process 2개), shutdown(open WebSocket 있어도 종료) 각 2 test, LocalRuntimeHost 3 test(interactive lifecycle with real artifact files / 재생 가능한 content block 저장 / abort + host restart + 복구 후 transcript 유지).
- harness test: `sdk/packages/agents/src/agent-runtime.test.ts` 4,920줄, 107 test(평균 46줄), `ScriptedModel`(단계별 callback 목록, 호출 기록, 대본이 모자라면 throw). 묶음: 단순 turn/tool 실행 약 20, 출력 token 한도·context overflow 복구·compaction 재시도 약 25, provider 오류·재시도·"재시도 안 해야 하는 경우" 약 12, hook(beforeModel/Tool, 추가 context) 약 15, telemetry·오류 귀속 약 20, 병렬 tool·승인·정책 약 10. 제목의 절반 이상이 "~하지 않는다/~로 귀속하지 않는다" 형태의 경계 case.
- evals: `evals/smoke-tests/scenarios` 8개(파일 생성, 편집, 읽고 요약, multi-file, TS 함수, apply patch, 두 provider 편집) = 실제 model. 별도 `cline-bench` real-world task를 Docker + pytest로 검증(수동/별도).
- 규칙(CONTRIBUTING/AGENTS): "새 기능에 test 추가, unit과 integration 둘 다 적절히". E2E 선택 기준 문서는 없음. 변경 감지 CI(paths-filter)로 vscode 관련 변경 때만 E2E, main push는 항상.
- AGENTS.md 자체가 "e2e 단정 일부는 이미 어긋남(drift)이니 기존 문제로 취급"이라고 적음 → 유지 부담의 신호.

---

## 4. Continue

- VS Code E2E(`extensions/vscode/e2e/tests`, selenium형): GUI.test 14(onboarding, chat 4: Enter/단추 전송·삭제·편집, agent+tool 4: rules peek, tool call 표시, 승인 후 호출, 취소; context provider 1; system message 반복 1; chat path 4: 자동 스크롤·history·방향키 이력·새 session), Keyboard shortcuts 5, Edit 3(GUI에서 거절/CodeLens 수락/거절), Autocomplete 2, PromptFile 1. skip 파일: Apply(CI에서만 항상 실패 — 주석에 사유와 run 링크), NextEdit, SSH. `TODO.md`에 "열기 전에 Cmd+L 눌렀을 때" 같은 case를 적어 두기만 함.
  - README에 "flake가 나면 race condition 의심 → waitForTimeout을 넣어 보되 나중에 flake가 될 수 있다"고 경고.
  - mock model은 config 파일의 provider = mock/test. tool 호출은 "TOOL MOCK LLM" model의 고정 대본(chatStream)으로 한 가지(view_diff).
- CLI E2E(`extensions/cli/src/e2e/*.test.ts`) 17 file, 약 60 test: 실제 CLI binary를 임시 dir에서 실행, 외부는 mock LLM HTTP server만. 대부분이 flag·모드 조합(`-p` headless 5+5, `--silent` 7, `--format json` 5, `--org` 3, pipe 입력 9, 인자 처리, branch 표시 6). tool call 있는 대화는 1 test(tool call만 올 때 stdout이 비어 있는가), dynamic response 4, resume 3, permission(`--auto`/`--allow`) 2.
- `TESTING.md`는 test 문서가 아니라 PR 수동 확인 checklist(Critical → High → Medium → Low 우선순위, 체크박스). CONTRIBUTING: "unit, functional, e2e를 섞되 functional test 중심. PR마다 CI에서 돈다".
- integration (CLI): permission checker, tool permission service, headless permissions, model persistence 4 file(통합 → user-flow → unauthenticated → e2e로 층층이), rule 중복 등. 허락 규칙은 UI가 아니라 service 단 integration으로 따로 잡음.
- 관찰: flag 조합 test가 많아 "한 기능 = 5~9 test"가 흔함. 이름만 달라지는 비슷한 test(headless-simple/minimal/missing-prompt)가 중복.

---

## 5. Zed

Zed는 전체 app을 띄우는 E2E가 없다. 대신 gpui의 test app(제품 코드 + 가짜 filesystem + 가짜 terminal/language model)을 한 process 안에서 돌린다. 이것이 사실상 "harness test"이자 "UI 포함 integration"이다.

- `crates/agent/src/tests/mod.rs` (agent 핵심, UI 없음): `#[gpui::test]` 119개, 9,740줄, 중앙값 65줄. 가짜 model(FakeLanguageModel)에 `send_text`, `send_event(ToolUse…)`, `end_stream`을 직접 호출해 한 turn씩 이벤트를 주입하고, 호출 사이에 `run_until_parked`로 scheduler를 비운다. 실제 model enum(TestModel::Sonnet4)도 같은 harness에 있어 같은 test를 실 model로 돌릴 수 있게 설계돼 있다(기본은 Fake).
  - 묶음 (이름 기준 분류)

| 묶음 | 개수 | 예 |
|---|---|---|
| 도구 권한·허락 (deny/allow 규칙, always allow, fetch host, 외부 설정 변경 시 대기 중 허락 해소) | 31 | test_tool_authorization, test_always_allow_resolves_pending_authorizations |
| subagent (end-to-end, 취소, 깊이 제한, compaction, context 한도, 오류 전파, resume) | 20 | test_subagent_tool_call_end_to_end, test_parent_cancel_stops_subagent |
| terminal·취소 (timeout, 여러 terminal 동시 취소, 카드 버튼) | 12 | |
| 재시도·오류·refusal | 10 | test_send_retry_on_error, test_send_max_retries_exceeded |
| MCP (이름 sanitize, multi-content, 자름, 연결 끊김) | 5 | |
| token·context 한도 | 7 | test_prompt_too_large_marks_token_usage_exceeded |
| prompt/system/thinking/profile/cache | 7 | |
| queue·전송 겹침 (다음 send가 이전 send 취소) | 3 | |
| streaming tool 입력 | 2 | |
| title 생성 | 3 | |
| truncate(rewind) | 4 | test_truncate_first_message, test_truncate_while_terminal_tool_running |
| 기타 (echo, 기본 tool call, hallucinated tool, thread 직렬화=markdown 동등) | 17 | test_echo |

  - 가장 단순: test_echo 43줄 (사용자 1번 전송 → fake 대답 text + Stop → 마지막 message가 assistant, 내용, StopReason 단정).
  - 큰 것: subagent end-to-end(약 100줄 이상, 부모 model이 spawn tool을 호출 → 자식 thread가 따로 생겨 자기 대본 진행 → 부모에 결과 반환), replay된 tool call id 범위 test 192줄.
  - test 이름이 곧 불변식 문장: "tool call id는 completion request 단위로 scope된다", "예전에 해소된 elicitation이 새 session 생성 때 지워진다" 등 구체적. 이는 회귀 발생 뒤 붙인 test의 흔적(이름 안의 "does not", "preserves", "survives"). `test_tool_call_id_scoped...`, `test_replayed_tool_call_ids_scoped...`는 같은 버그의 서로 다른 면.
- `acp_thread.rs`(protocol 계층 상태) 200 test, `agent_ui/conversation_view.rs` 168, `agent_panel.rs` 102, `message_editor.rs` 46, `thread_metadata_store.rs` 44. agent_ui 쪽은 gpui test window에서 stub agent 연결을 만들어 화면 상태를 본다. 분포: 알림(notification) 약 20, queue/전송 재개/오류 후 draft 보존 약 20, session 복구·resume·인증 필요 약 15, scroll·검색·복사 약 25, elicitation 약 10, panel/terminal 탭 약 60. 즉 "화면" test는 상태 전이와 보존 규칙(draft 안 잃기, queue 일시정지)이 중심.
- 실 model eval: `crates/agent/src/tools/evals/`(edit_file 14, terminal_tool, write_file) + `crates/eval_cli`(Harbor/Pier에서 도는 headless binary). 이것은 test와 분리된 품질 측정.
- 규칙: CONTRIBUTING은 "중요 변경에 test 없는 PR은 거절 사유", "시각 변경은 screenshot 필요". AGENTS.md의 test 항목은 timer 사용법 등 기술 규칙뿐, 어떤 case를 고를지는 없음.

---

## 6. Roo Code

- `apps/vscode-e2e`: 실제 model(OpenRouter key 필요)로 VS Code extension API를 호출하는 test. 약 40 test: tool별 file (read-file 7, search-files 8, use-mcp-tool 6, apply-diff 5, execute-command 4, list-files 4, write-to-file 2), markdown-lists 4, task/modes/extension 각 1.
- 한 test는 100~130줄(file당 500~900줄). 실제 model 응답에 의존해 단정이 느슨("My name is Roo"가 text에 포함).
- skip 비율 높음: subtasks 전체 `suite.skip`, use-mcp-tool 전체 suite skip + 개별 skip (사유: 비-whitelist MCP 서버는 대화형 승인이 필요해 자동화 불가). 
- 교훈: 실제 model E2E는 유지 비용 때문에 skip이 쌓이고, 승인이 필요한 flow는 자동화가 어려워 막힘. (fake model + 승인 hook을 테스트 쪽에서 제어할 수 있어야 한다는 반증.)

---

## 7. 공개 글 (agent 제품 test 층)

1. Block, "Testing pyramid for AI agents" (engineering.block.xyz). 층을 불확실성 허용도로 나눔. 맨 아래 deterministic: LLM을 mock해 retry, max-turn, tool schema 검증, extension 관리, subagent 위임 test (실 model로 만들기 어려운 실패 모드를 우선, flaky면 소프트웨어 버그). 두 번째: 외부 tool/MCP session과 LLM 응답을 녹화해 재생(입력 message hash로 key)하며, 좋은 session을 녹화→fixture commit→회귀 test. 단정은 정확한 출력이 아니라 tool 호출 순서·flow. 그 위는 반복 실행해 통계로 보는 benchmark, 맨 위는 LLM judge(3회 다수결). live LLM test는 CI에 안 넣음(비용·느림·flaky). CI는 deterministic 층만, benchmark는 수동/on-demand. "agent가 자기 기능을 처음부터 끝까지 스스로 확인하는 smoke test" 별도.
2. Anthropic Engineering, "Demystifying evals for AI agents". 처음 20~50 task면 충분(초기 변화는 효과가 커서 작은 표본으로 감지). 출처 = 출시 전 수동 확인 목록, 사용자가 흔히 하는 workflow, 이후 bug tracker·지원 큐 실패(사용자 영향 순). 좋은 task = 전문가 둘이 같은 pass/fail 판정. 기준 해답으로 풀 수 있음을 확인. capability eval(낮은 pass로 시작)과 regression eval(100% 근처)을 구분하고 통과 안정화된 것은 regression으로 이동. 해야 할 것과 하지 말아야 할 것 양쪽 case 포함. 결과 상태(outcome)를 채점하고 경로(tool 순서)를 강제하지 않는다. trial마다 깨끗한 환경.
3. LangWatch/기타 "agent testing pyramid" 글들(검색 요약만 읽음, 본문 미확인): 넓고 싼 deterministic 바닥, 대본 있는 mock 중간, 실제 LLM eval 위, 소수의 핵심 journey simulation 맨 위. 같은 모양으로 합의되어 있지만 층 이름·개수는 제각각이고 vendor 글 위주라 근거로 약함.

---

## flow case 잡는 법

### 관찰한 공통점 (근거 포함)

1. 제품 전체 E2E는 "핵심 flow 소수 + 나머지는 한 층 아래"로 나눈다. Cline VS Code E2E 약 10, Continue VS Code 약 25, Zed는 0(전체 process E2E 없이 in-process harness), OpenHands는 live 2 + mock-LLM 83(대부분 UI·설정). 반면 agent loop를 직접 흔드는 test는 Zed 119, Mastra core 226, Cline 107로 훨씬 많다. → E2E는 "배선(process 사이 연결)이 맞는가"에만 쓰고, 경우의 수는 harness에서 늘린다.

2. 한 scenario = 한 불변식(또는 한 회귀). Mastra는 57/104 file에 "Regression class: ..." 헤더를 달고, TUI abort-followup 헤더는 원인 함수와 빠진 검사를 적는다. Zed의 test 이름이 불변식 문장(예: tool call id는 request 단위 scope). Cline harness는 "~하지 않는다" 경계 case가 절반 이상. → case 이름과 헤더에 "무엇이 깨지면 안 되는가" 한 문장을 적는 것이 선택의 기준이 된다.

3. 단정은 한 곳이 아니라 "서로 다른 source of truth" 2~4곳에서 하되, 문구가 아니라 상태에서 한다. Mastra: loop 출력 + model로 간 request body. OpenHands: 생성 request payload + bash event API + conversation event API + 화면. Cline: disk file 내용 + 화면 + (hook은) request에 token이 들어갔는지. Zed: thread의 message markdown + StopReason. 반대로 문구·DOM 단정은 UI 문구가 바뀔 때 깨짐(Mastra TUI 19개 skip의 원인에 "렌더링 변경"이 다수).

4. fake model은 "대본 + 보낸 request 기록" 두 기능이 핵심이다. Mastra AIMock(fixture 대본 + request journal), OpenHands(trajectory 등록 + `/admin/requests`), Cline ScriptedModel(단계 callback + requests 배열), Zed(이벤트 직접 주입 + pending completion 조회). 대본이 모자라면 즉시 throw(Cline)해야 숨은 추가 호출을 잡는다. 대본의 match는 "turn 번호"보다 "tool result 존재 여부/tool call id"로 하는 쪽이 덜 깨진다(Mastra README).

5. 변형은 case를 복제하지 말고 같은 scenario에 변수로 주입한다. Mastra: `describeForAllEngines`(normal/durable/fs), abort-followup은 key(Ctrl+C/Esc) x engine 4개를 한 factory로. Cline: workspace 종류(single/multi-root)를 fixture 반복으로. OpenHands AGENTS.md: "제어/데이터 흐름이 다른 경로마다 하나, Cartesian product 금지".

6. 승인 필요/시간 의존 flow는 fake 쪽에 gate를 둔다. Cline은 mock server에 checkpoint probe를 붙잡는 gate를 둬서 "turn 도중 설정 변경" timing을 결정론으로 만들었고, Mastra는 stream 속도(ttft, tps)를 fixture에 지정해 "느린 run 중간에 중단"을 재현. Roo는 실 model이라 승인이 필요한 MCP flow가 자동화 불가가 되어 skip. → timing case는 sleep이 아니라 fake의 제어 지점(gate, 속도)으로 만든다. Continue README의 "waitForTimeout을 넣으면 나중에 flake"가 반대 증거.

7. 설정·화면·flag 조합은 가장 빨리 늘고 가장 가치가 낮다. Mastra TUI 229개 중 agent 핵심 flow는 20~30개, OpenHands mock-LLM 83개 중 대화·skill은 약 10개, Continue CLI는 `--silent` 7개처럼 flag 조합 위주, Cline CLI 40개는 목록 출력. → 이런 것은 unit/contract(출력 schema)로 내리고 E2E에 넣지 않는다.

8. 유지 비용 증거: Mastra TUI 19 skip(fixture가 내부 request 모양에 묶임, 원인 하나가 3 scenario를 동시에 막음), Continue Apply E2E `.skip`(CI에서만 실패), Roo subtasks/MCP suite skip, Cline AGENTS가 "e2e 단정 어긋남을 기존 문제로 취급". 공통 원인: (a) UI 문구·layout에 단정, (b) 외부 환경(VS Code, 실 model, CI 화면)에 의존, (c) 모델 request 내부 모양에 정확히 일치 요구. 반대로 오래 안 깨지는 것: 한 flow를 36~90줄로 짧게 두고 disk/상태만 단정하는 Mastra web scenario.

9. 실제 model은 별도 층(nightly/수동)이고 CI 필수 판정에 쓰지 않는다. OpenHands live 2개는 main push 후만, integration 28개는 nightly, behavior(b)는 릴리스 막지 않음. Block: live LLM은 CI에 안 넣음. Zed eval은 test와 분리된 binary. Anthropic: 통과 안정화된 capability는 regression으로 이동.

10. 새 case의 출처는 (1) 출시 전 수동 확인 목록, (2) 사용자가 흔히 하는 flow, (3) 실제 발생한 bug (Anthropic 글; Mastra의 Regression class 관례; Cline history resume test의 crash 사유 주석). 선택 후 같은 불변식을 이미 보는 test가 있으면 추가하지 않는다(OpenHands "같은 조건 두 번 단정 금지, 기존 file 확장 우선").

### lophn에 추천하는 case 고르기 규칙

전제(AGENTS.md): 프로토타입, test는 "깨지면 곤란한 것"에만, 사용자 데이터 손실·권한/sandbox 경계·두 번 이상 고친 bug가 우선. subprocess·server를 띄우는 E2E는 새로 만들기 전에 사람에게 묻는다 (아래 E2E 개수 제안은 승인용 추천안).

층 나누기
- Core E2E (제품 process 전체, HTTP fake model): 5~8개로 시작, 상한 10~12. "process 사이 배선이 맞는가"만 본다. 한 case = 한 사용자 여정이고 여러 agent가 부르는 경우를 포함.
- Harness test (process 없음, scripted fake model): 20~40개 정도로 시작해 bug가 나올 때마다 한두 개씩 늘림. 모든 경계 case와 경우의 수는 여기.

E2E 후보 (이 기준으로 고르면 약 6~8개)
1. 대화 한 번 + file/shell tool 실행 + 결과 file이 disk에 있고 session 저장됨 (기본 배선).
2. 허락(approval): 허락 대기 → 사람 승인 → 실행. 같은 case에서 거절 한 번(거절하면 file 안 바뀜). 권한 경계라서 필수.
3. file 수정 → rewind → file 내용과 session이 되돌아가고 사용자 데이터가 안 사라짐 (데이터 손실 규칙).
4. PM → App Engineer 같은 agent 간 호출 한 번 + 하위가 허락을 받는 경우 상위가 어떻게 되는지.
5. 중단(abort) 후 후속 입력이 새 run으로 시작 (Mastra abort-followup과 같은 종류의 경합 회귀).
6. process 재시작 후 session 복원 (core daemon 재시작, agent child 비정상 종료, Zed/Cline의 복구 test 대응).
7. 사용자 앱 process가 sandbox 밖을 못 쓰는 것 한 개 (경계).
8. (선택) Electron shell 연결 smoke 하나. 화면 단정은 상태 중심으로 하나만.
- 설정·문구·화면 배치·flag 조합은 E2E에 넣지 않는다.

Harness로 내릴 것 (각각 case 하나 이상)
- 오류·재시도: provider 오류, 재시도 안 해야 하는 경우(이미 visible output이나 tool 실행이 있었을 때), 최대 재시도 초과.
- context 한도·compact: overflow 후 compact 한 번 재시도, compact할 것이 없을 때, 연속 overflow.
- 승인 경계: tool별 정책(허용/거부/물어봄), 동시에 여러 승인 대기, 설정이 바뀌면 대기 중 승인이 어떻게 되는지, 거절 후 재개.
- 병렬 tool, 잘못된 tool 이름(hallucination), 잘못된 tool 입력 JSON, tool call id 범위.
- 중단: tool 실행 중 중단, 여러 terminal 동시 취소, 부모 취소 시 자식 중단.
- rewind: 첫/둘째 message로 truncate, tool 실행 중 truncate.
- 여러 agent: 깊이 제한, 하위 오류 전파, 하위 context 한도, 취소 전파, 모델 상속.
- 보낸 request 검증: system prompt, tool 목록, 추가 context가 request에 들어갔는지 (request journal 단정).

고르는 규칙 (체크 순서)
1. 이 case가 깨지면 사용자 데이터 손실·권한 경계 위반·두 번 고친 bug 중 하나인가? 아니면 넣지 않는다.
2. 이미 있는 test가 같은 불변식을 보나? 있으면 확장하거나 안 만든다. (case 이름 = 불변식 한 문장 "X가 Y여도 Z는 일어나지 않는다", 헤더에 회귀 원인 한 줄.)
3. process 사이 배선 때문에만 보이는가(IPC, 재시작, 권한 위임)? 그렇지 않으면 harness로.
4. 변형(engine, workspace 종류, 키)은 case를 복제하지 말고 factory 인자로.
5. fake model은 "대본 + 받은 request 기록". 대본이 남거나 모자라면 실패. match는 turn 번호가 아니라 "tool result 존재/tool call id"로.
6. 단정은 상태 2~3곳: disk 결과, session/event 저장소, 보낸 request. 화면 문구 단정은 최소.
7. 시간·경합 case는 fake에 gate나 속도 제어를 만들어 sleep 없이 결정론으로.
8. E2E 한 case는 90줄 안팎, 대본 2~4번 이하를 목표로. 길어지면 쪼갠다 (OpenHands serial step처럼 앞 step에 의존하는 구조는 피함).
9. 한 번 정한 뒤에는 "bug가 났을 때만 한 개 추가"하고, 6개월 단위로 안 깨지고 안 잡는 case는 지운다. 일정 이상 skip/flaky가 되면 고치지 말고 지우고 재작성 (AGENTS.md의 호환성 원칙과 같다).
10. 실제 model 호출은 test에 넣지 않는다(사람 승인 규칙). 품질 측정은 별도 eval로 분리.

한계
- 개수는 grep 기반 추정. Mastra TUI는 `index` 목록과 file 수를 섞어 약 229(변형 포함)로 보고했고, 별도로 TODO.md의 skip 19개는 확인했다.
- git history가 없어 "bug 회귀 비율"은 직접 측정 못함. Mastra core 57/104(주석 기준)와 Zed 12 hit(키워드)가 유일한 수치.
- LangWatch 글은 404였고 검색 요약만 읽음.

## 읽은 경로 (clone: 각 repo의 GitHub 기본 branch(`--depth 1` clone, 지금은 지움)의 ``)
- `mastra/packages/core/src/loop/test-utils/aimock/{README.md,scenarios/}`, `mastra/mastracode/{tui/e2e,web/e2e/web}`, `mastra/mastracode/tui/e2e/TODO.md`
- `OpenHands/.agents/skills/e2e-testing/references/guide.md`, `OpenHands/tests/e2e/`, `software-agent-sdk/{AGENTS.md,tests/integration/BEHAVIOR_TESTS.md}`
- `cline/apps/vscode/src/test/e2e/`, `cline/apps/cli/src/*.e2e.test.ts`, `cline/sdk/packages/{agents,core}`, `cline/evals/`
- `continue/extensions/{vscode/e2e,cli/src/e2e,cli/src/test-helpers}`, `continue/{TESTING.md,CONTRIBUTING.md}`
- `zed/crates/{agent/src/tests,agent_ui/src,acp_thread/src}`, `zed/crates/eval_cli`
- `Roo-Code/apps/vscode-e2e`
- https://engineering.block.xyz/blog/testing-pyramid-for-ai-agents, https://anthropic.com/engineering/demystifying-evals-for-ai-agents, https://langwatch.ai/blog/the-agent-testing-pyramid-a-mental-model-for-trustworthy-agents (검색 요약만)
