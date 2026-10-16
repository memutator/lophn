# 사람에게 묻는 tool 조사: Claude Code, Codex, Gemini CLI, OpenCode, Hermes, Cline (2026-10-15)

조사 항목 R6(`../research-items.md`). 모든 role의 agent가 쓰는 공통 tool "사람에게 묻기"의 모양, 답을 기다리는 동안의 turn, 사람이 없는 실행, 권한 물음(approval)과의 관계를 본다.

## 대상과 근거

| harness | 대상 | 근거 |
|---|---|---|
| Claude Code | `AskUserQuestion`. source는 공개되지 않았다 | (1) 공식 문서(2026-10-15에 읽음): `code.claude.com/docs/en/agent-sdk/user-input`, `.../tools-reference`(AskUserQuestion tool behavior), `.../permission-modes`, `.../headless`, `.../agent-view`. (2) 이 컴퓨터에 설치된 Claude Code 2.1.300의 binary(`@anthropic-ai/claude-code/bin/claude.exe`)를 읽기만 해서 뽑은 문자열: tool description, input/output schema 설명, tool 정의(`checkPermissions`, `isEnabled`), tool result 문구. 실행하지 않았다. (3) 캡처 `claude-code-prompt-assembly copy.md`(v2.1.299, 7장이 print `-p` wire capture라고 적음): tools[] 24개 안에 `AskUserQuestion`이 없다 |
| Codex | `request_user_input`(와 `request_user_input_async`) | `openai/codex` main `bb64b894fd67`(2026-10-15). 경로는 `codex-rs/` 기준 |
| Gemini CLI | `ask_user` | `google-gemini/gemini-cli` main `06d329873703`(2026-10-14). 경로는 `packages/` 기준. 문서 `docs/tools/ask-user.md` |
| OpenCode | `question` | `sst/opencode` dev `bdf4793286f7`(2026-10-15). 경로는 `packages/` 기준. 이 commit에서 tool은 `core/src/tool/plugin/question.ts`, 대기는 `core/src/form.ts` |
| Hermes | `clarify` | 설치본 `/home/pyosechang/.hermes/hermes-agent` `decf192176`(2026-10-11). 읽기만 함 |
| Cline | `ask_question` | `cline/cline` main `789f79e46d3b`(2026-10-14). `sdk/packages/core/src/extensions/tools/`, `apps/cli/`, `apps/vscode/src/sdk/` |

- 받은 repo는 읽기만 했고 실행하지 않았다. 확인하지 못한 것은 "확인 못함"으로 적었다.
- 기존 조사와 겹치는 것은 줄였다: `agent-def-*.md`는 이 tool이 어느 role, mode에 주어지는지를 이미 적었다(Claude Code subagent에서 빠짐, Codex는 Plan mode에서만, OpenCode `general` deny, Hermes delegate child 금지). 여기서는 schema, 기다림, 사람이 없는 실행, approval과의 관계를 채운다.
- 캡처의 식별자(device, account, session, email, UUID 꼴 값)는 옮기지 않았다.

---

## 1. Claude Code: `AskUserQuestion`

### 1.1 schema와 description

input (문서 `agent-sdk/user-input` "Question format", binary의 schema 설명):

| 칸 | 뜻 |
|---|---|
| `questions[]` | 1~4개. "each `AskUserQuestion` call supports 1-4 questions with 2-4 options each" |
| `questions[].question` | 질문 전문. 답의 key로도 쓰인다 |
| `questions[].header` | 짧은 label. 문서는 최대 12자 |
| `questions[].options[]` | 2~4개. `label`, `description`. 옵션이 2개 미만이면 사람에게 보이기 전에 거절하고 "필러 옵션을 만들지 말고 그 길을 택한다고 말하고 계속하라"는 오류를 돌려준다(binary `validationErrorSteer`) |
| `questions[].options[].preview` | 선택. SDK에서 `toolConfig.askUserQuestion.previewFormat`(`markdown` 또는 `html`)을 켜야 생긴다. 켜면 옵션 옆에 ASCII mockup, code, HTML 조각을 나란히 보인다. single-select에서만 |
| `questions[].multiSelect` | 여러 개 고르기 |
| 자유 답 | schema 칸이 아니다. UI가 "Other" 줄을 자동으로 붙인다. description은 `Users will always be able to select "Other"`라고 알려 준다 |
| 확장 칸 | host가 그릴 수 있을 때만 쓰는 변형이 binary에 있다: `kind`(`choice`, `text`, `number`), `min`, `max`, `step`, `defaultValue`, `unit`, `title`, 질문별 `description`, `placeholder`. 어느 surface에서 켜지는지 확인 못함 |

description의 핵심 문구 (binary 2.1.300. 조각이 feature flag로 갈아 끼워지는 변형이 여럿이라 실제 요청에 어떤 조합이 가는지는 확인 못함):

- 첫 줄: "Asks the user multiple choice questions to gather information, clarify ambiguity, understand preferences, make decisions or offer them choices."
- 쓸 때: "Use this tool only when you are blocked on a decision that is genuinely the user's to make: one you cannot resolve from the request, the code, or sensible defaults."
- 쓰지 말 때: "Reserve this for decisions where the user's answer changes what you do next, not for choices with a conventional default or facts you can verify in the codebase" (원문 중간이 줄표로 이어진 변형이고 끝이 잘려 보임).
- 사용 노트: Other는 늘 선택할 수 있다. 여러 개 고르려면 `multiSelect: true`. 추천 옵션은 첫째에 두고 label 끝에 "(Recommended)"를 붙인다.
- plan mode 노트: "To switch into plan mode, use EnterPlanMode (not this tool). Once in plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask 'Is my plan ready?', 'Should I proceed?' ... the user cannot see the plan until you call ExitPlanMode for approval."

### 1.2 기다림과 답

- tool call이 열린 채로 turn이 멈춰 기다린다. SDK 문서: "The callback can stay pending indefinitely. Execution remains paused until your callback returns."
- 구현이 approval과 같다. binary의 tool 정의에서 `checkPermissions`가 `{behavior: "ask", message: "Answer questions?", updatedInput}`을 돌려준다. 사람이 답하면 `updatedInput`에 `answers`가 실려서 돌아오고 tool이 그것을 result로 만든다. `requiresUserInteraction()`은 true라서 어떤 permission mode(`bypassPermissions` 포함)도 자동 승인하지 못하고, `dontAsk`는 allow rule이 맞아도 이 tool을 거절한다(`permission-modes`, "Actions no mode auto-approves").
- SDK에서는 같은 `canUseTool` callback에 `toolName == "AskUserQuestion"`으로 들어온다. 답은 `{questions, answers: {<질문 전문>: <label>}}`로 돌려준다. 여러 개 고르면 label 배열 또는 `", "`로 이은 문자열, 자유 답은 사람이 쓴 글 그대로. 선택 칸 `response`는 질문 카드를 닫고 일반 답을 쓴 경우다.
- 기한: 기본은 없다("Questions stay open until you answer them"). 설정 `askUserQuestionTimeout`을 `60s`, `5m`, `10m` 중 하나로 켜면 아무 입력이 없을 때 카드가 닫히고, 이미 고른 옵션을 내면서 Claude에게 사람이 away일 수 있다고 알린다(마지막 20초 countdown, 키를 누르면 reset). 이 timer는 background session, screen reader mode, Remote Control 연결 중에는 시작하지 않는다. permission prompt는 이 timer로 자동 해결되지 않는다(`tools-reference`).
- tool result 문구 (binary, 모델에게 가는 문자열):

| 경우 | 문구 |
|---|---|
| 정상 | `Your questions have been answered: "<질문>"="<답>", .... You can now continue with these answers in mind.` |
| 답에 notes나 자유 답이 섞임 | `The user answered: ... Read the answers carefully - they may request clarification, changes, or that you not proceed - and follow what they actually say.` |
| `response`만 있음 | `The user responded: <글>` |
| 답 없음 | `The user did not answer the questions.` |
| 사람이 "질문을 더 해 달라"고 함 | `... before you proceed. So far they answered: ... Call AskUserQuestion again with follow-up questions ...; do not start the task yet.` |
| idle timeout | `No response after <N>s - the user may be away from keyboard. Proceed using your best judgment based on the context so far; you can re-ask this question later if it's still relevant.` (+ 이미 고른 것) |

### 1.3 기다리는 중 다른 입력, 취소

- Agent view(background session 목록, `agent-view` 문서)에서 질문에 걸린 session은 "Needs input" 상태다("an answer to a question, a permission decision, or another prompt only you can answer"). 질문에 답하는 글은 목록의 peek 패널에서 보내면 그 session의 답이 된다. 반면 permission prompt와 dialog는 "replying doesn't answer it. Your message waits in the queue."라서 attach해서 답해야 한다.
- 승인 요청을 아무도 답하지 못하고 끝난 경우 모델에게 "Permission request withdrawn unanswered: the person pressed Stop, or the session is ending. Do not ask again."를 준다(binary). 질문이 같은 문구를 쓰는지는 확인 못함.
- SDK에서 닫은 session은 pending 요청을 취소한다(`headless` 문서: SIGTERM 때 "Claude Code leaves the prompt unanswered. If your program closes the session through the Agent SDK ... cancels the prompt as soon as the input ends").
- 사람이 아주 오래 걸릴 때: SDK 문서는 `PreToolUse` hook이 `defer`를 돌려 process를 끝내고 persisted session에서 나중에 이어 가게 하라고 한다. `defer`의 세부는 확인 못함.

### 1.4 사람이 없는 실행

- 안 준다. 캡처(`-p`)의 tools[]에 없다. binary의 `isEnabled`: 비대화형(`!isInteractive`)이면 permission prompt를 받을 host(`--permission-prompt-tool` 또는 SDK `canUseTool`)가 있어야만 켜진다. `--permission-prompts none`을 주면 "removes the tools that need an answer from a person, such as AskUserQuestion, so Claude can't call them"이고 답하는 쪽 없는 MCP elicitation은 취소한다(`headless` 문서).
- subagent: "AskUserQuestion is not currently available in subagents spawned via the Agent tool"(`user-input` 문서 Limitations). `agent-def-claude-codex.md`가 적은 "항상 빠지는 tool"과 같다.
- 사람이 지켜보지 않는 background session에서는 tool이 있고 질문은 기한 없이 기다린다("those questions wait until you answer them"). Needs input 상태로 목록 위에 뜨고 `agent_needs_input` 알림이 간다. `claude agents --json`의 `waitingFor`가 `permission prompt`(승인)와 `input needed`(Claude 또는 MCP server의 질문)를 구별한다. 이 문서는 "AskUserQuestion"이라는 이름을 쓰지 않아 질문이 이 tool이라는 대응은 추론이다.

### 1.5 approval과의 관계

한 길로 지나가고 이름과 표시로 구별한다. 같은 `canUseTool`/permission 흐름이고 같은 Needs input 상태지만 `waitingFor`, 알림 type, 목록에서 답할 수 있는지가 다르다. `tools-reference` 표에서 `Permission required`는 No인데 "자동 승인 불가" 목록에는 든다.

### 1.6 mode

- plan mode에서 특히 많이 쓰인다(SDK 문서 Tip, description의 plan mode 노트). 계획 승인은 `ExitPlanMode`가 따로 맡고, 질문 tool로 "계획 괜찮나"를 묻지 말라고 막는다.
- auto mode는 "keep working without stopping for clarifying questions"로 질문을 줄이도록 유도한다(`permission-modes`).

---

## 2. Codex: `request_user_input`

### 2.1 schema와 description

`codex-rs/core/src/tools/handlers/request_user_input_spec.rs`:

- 입력: `questions[]`(1~3개 권장, "Prefer 1 and do not exceed 3"), 각 칸은 `id`(snake_case, 답을 잇는 key), `header`(12자 이하), `question`(한 문장), `options[]`(필수, `label` 1~5 단어, `description` 한 문장). 옵션은 "Provide 2-3 mutually exclusive choices. Put the recommended option first and suffix its label with "(Recommended)". Do not include an "Other" option ...; the client will add a free-form "Other" option automatically."
- 내부 필드(protocol `RequestUserInputQuestion`): `isOther`(handler가 늘 true로 고침), `isSecret`, `isBlocking`. model schema에는 `isOther`, `isSecret`, `isBlocking`이 없다. multi-select 칸은 없다(여러 개 고르기 불가). 옵션이 비면 "requires non-empty options for every question"으로 거절(`normalize_request_user_input_tool_args`, 같은 파일 105줄~).
- description은 한 줄이다: "Request user input for one to three short questions and wait for the response. This tool is only available in {Plan mode}." 언제 쓰고 말지는 tool description이 아니라 mode 지침(collaboration mode template)이 말한다:
  - Default mode(`collaboration-mode-templates/templates/default.md:7-19`): "strongly prefer making reasonable assumptions"; "only for optional questions where the answer would materially improve the quality of the work"; "If `request_user_input` returns no answers, continue with best judgment instead of asking again"; "Never use the `request_user_input` tool for permission requests or permission-related escalations"; 꼭 필요한 입력이면 이 tool 대신 짧은 평문 질문 하나로 물으라.
  - Plan mode(`plan.md:62-75`): "Strongly prefer using the `request_user_input` tool to ask any questions"; 계획을 바꾸는 결정, 가정 확인, 탐색으로 알 수 없는 정보에만; 탐색해서 알 수 있는 사실은 묻지 말라. 답이 없으면 추천안으로 진행하고 계획에 가정으로 적는다.

### 2.2 기다림과 답

- 멈춰 기다린다. `Session::request_user_input`(`core/src/session/mod.rs:3236-3271`)이 turn state에 oneshot sender를 넣고 `EventMsg::RequestUserInput`을 보낸 뒤 `rx_response.await`. app-server에서는 server request(`item/tool/requestUserInput`)로 client에 가고 응답으로 돌아온다.
- 기한: tool 쪽 기한은 없다. 이 요청에는 `isBlocking`이 있다. handler는 `is_blocking: mode == Plan`(`request_user_input.rs:83`)이라 Plan mode에서만 blocking이다. non-blocking(Default mode에서 켠 경우)이면 TUI가 60초 숨은 유예 + 60초 countdown("auto-resolves in ...") 뒤에 빈 답을 자동 제출한다(`tui/src/bottom_pane/request_user_input/mod.rs:73-74, 265-300, 922-944`). 입력하면 snooze. 옛 `autoResolutionMs`는 deprecated.
- 답의 꼴: tool result는 `serde_json`으로 만든 문자열 `{"answers":{"<id>":{"answers":["<label>", ...]}}}`. 자유 답과 notes는 같은 배열에 `"user_note: <글>"` 항목으로 들어간다(`tui/src/bottom_pane/request_user_input/mod.rs:892`, `history_cell/request_user_input.rs:199`). secret 질문은 `isSecret`.
- pending은 turn(sub_id) 하나에 하나만 둔다. 같은 turn에 두 번째가 오면 앞의 것을 덮어쓰고 경고만 한다(`mod.rs:3252`).

### 2.3 기다리는 중 다른 입력, 취소

- 취소(turn abort `core/src/tasks/mod.rs:580-587, 639`, turn 중단 뒤 handoff `session/turn_suspension.rs:96-98`): `clear_pending_waiters`(`core/src/state/turn.rs:139-146`, `input_queue.rs:316-320`)가 sender를 버리고 handler는 `"request_user_input was cancelled before receiving a response"`를 tool 오류로 돌려준다(`request_user_input.rs:86-95`). 승인 대기도 같은 함수로 같이 지운다. turn_suspension의 주석: "Pending accepted input and interactive waiters live only in this process." 즉 process가 끝나면 질문은 되살리지 않는다.
- TUI에서 질문은 bottom pane을 차지하는 modal view라 같은 창에서 다른 메시지를 보내는 길은 코드에서 못 찾았다(확인 못함). 사용자 메시지가 진행 중 turn에 쌓이는 경로(`watch_user_input`)는 sampling 요청을 끊는 용도이고 pending 질문과의 관계는 확인 못함.
- app-server client가 오류를 돌려주거나 연결이 깨지면 빈 답으로 이어 간다(`app-server/src/bespoke_event_handling.rs:1642-1680`). turn이 바뀌는 중의 오류는 조용히 무시한다.

### 2.4 사람이 없는 실행

- subagent(non-root agent): 쓰지 못한다. "request_user_input can only be used by the root thread"(`request_user_input.rs:67-71`). 같은 UI로 가는 MCP tool 승인도 non-root면 "Ask the parent agent to handle this request. Do not retry ..."로 거절한다(`mcp_tool_call.rs:1704-1710`). 즉 자식은 부모에게 넘긴다.
- `codex exec`: tool은 목록에 남고 server request가 오면 `reject_server_request`로 "request_user_input is not supported in exec mode"를 돌려준다(`exec/src/lib.rs:2121-2129`). app-server는 이 오류를 빈 답으로 바꿔 core에 넣으므로 모델은 `{"answers":{}}`를 받는다. 모델은 Default mode 지침("no answers면 best judgment로 계속")을 따른다.
- 기본 mode(Default)에서는 `DefaultModeRequestUserInput`이 UnderDevelopment, 기본 꺼짐이라(`features/src/lib.rs:1813-1818`) 질문 tool을 불러도 "request_user_input is unavailable in Default mode"(`request_user_input_spec.rs:91-105`)로 거절된다. 즉 대부분의 실행에서 Plan이 아니면 못 쓴다.

### 2.5 비동기 변형 `request_user_input_async`

`core/src/tools/handlers/request_user_input_async.rs`, 등록은 model catalog가 `experimental_supported_tools`에 광고할 때만(`spec_plan.rs:1316-1342`), root thread만.

- 입력: `questions[]`, 각 `title`(맥락 포함 질문 전문), `options[]`(문자열 배열, 선택, 첫 옵션 preselect). 자유 답은 UI가 늘 준다.
- 기다리지 않는다. 질문을 `AgentMessage`(delivery async, `questions` 첨부)로 내고 즉시 `{"accepted":true}`를 돌려준다. description: "The tool returns immediately without ending the turn or waiting for a reply; any reply arrives asynchronously as a new user message ... A preselected option is not submitted automatically."(`prompts/src/model_messages.rs:53`)
- 이것이 TUI 알림 type `async-question`(`events-codex-gemini.md`)에 해당한다.

### 2.6 approval과의 관계

- model이 쓰는 tool은 따로다: 권한은 `request_permissions`, 승인은 sandbox 승인 흐름. description이 "Never use ... for permission requests"라고 막는다.
- wire와 알림도 따로다: app-server는 `ToolRequestUserInput`, `CommandExecutionRequestApproval`, `FileChangeRequestApproval`이 각각 다른 server request이고, TUI 알림 type은 `approval-requested`와 `async-question`으로 나뉜다.
- 단 하나 겹친다: MCP tool 승인과 MCP 의존성 설치 확인은 내부에서 같은 `request_user_input` UI를 재사용한다(`mcp_tool_call.rs:1700-1722`, `mcp_skill_dependencies.rs:275-290`, 둘 다 `is_blocking: true`). 사람에게는 같은 질문 카드로 보이지만 agent가 부른 tool은 아니다.

### 2.7 mode

Plan mode에서만 켜진다(`tools/src/tool_config.rs:6-16`, `protocol/src/config_types.rs:700-702`). Plan mode만 blocking. Default mode는 flag를 켜야 하고 질문을 줄이라고 지시한다.

---

## 3. Gemini CLI: `ask_user`

### 3.1 schema와 description

`core/src/tools/definitions/model-family-sets/gemini-3.ts:618-700`(legacy 세트 `default-legacy.ts:635-`는 같은 모양), `core/src/tools/ask-user.ts`, `docs/tools/ask-user.md`:

- 입력 `questions[]`(1~4개, 필수). 각 칸: `question`(필수, "end with a question mark"), `header`(필수, "Very short label displayed as a chip/tag", 문서는 16자), `type`(필수, `choice` 기본 / `text` / `yesno`), `options[]`(`choice`에 필수, 2~4개, `label` 1~5 단어 + `description` 필수), `multiSelect`(`choice`에만), `placeholder`.
- "An 'Other' option is automatically added for 'choice' and 'yesno' types." multi-select에 옵션이 둘 이상이면 "All the above"를 자동으로 더한다(문서). `yesno`는 Other 칸으로 피드백을 받는다.
- description: "Ask the user one or more questions to gather preferences, clarify requirements, or make decisions. When using this tool, prefer providing multiple-choice options with detailed descriptions and enable multi-select where appropriate to provide maximum flexibility." 언제 쓰지 말라는 문구는 tool description에 없다. 쓰는 조건은 prompt가 맡는다: YOLO(autonomous) 지침 "Only use the `ask_user` tool if: a wrong decision would cause significant re-work; the request is fundamentally ambiguous with no reasonable default; the user explicitly asks you to confirm"(`prompts/snippets.ts:489-`), 모호하면 `ask_user`로 풀라(`snippets.ts:633`), 표준 작업은 둘 이상의 접근을 pros/cons와 함께 `ask_user`로 보이고 결정을 기다리라(`snippets.ts:606-607`).

### 3.2 기다림과 답

- 구현이 tool 승인(confirmation)과 같다. `ask-user.ts`의 `shouldConfirmExecute`가 `{type: "ask_user", questions, onConfirm}` confirmation details를 돌려주고, scheduler(`core/src/scheduler/scheduler.ts:720-746`)가 승인과 같은 "User Confirmation Loop"에서 기다린다. 정책 decision 이름도 `ask_user`(= 사람에게 묻기)이고 tool 이름도 `ask_user`라서 이름이 겹친다.
- 문서: "Pauses execution until the user provides answers or dismisses the dialog." 기한 없음.
- 답의 꼴: `{"answers":{"0":"Option A","1":"Some text"}}`(질문 index가 key; `ask-user.ts` `execute`). 닫았거나 비운 경우의 문구는 `User dismissed ask_user dialog without answering.`, 화면 표시는 `User submitted without answering questions.`

### 3.3 기다리는 중 다른 입력, 취소

- dialog는 modal이다(`cli/src/ui/components/AskUserDialog.tsx`, Esc가 `onCancel`). 취소(`ToolConfirmationOutcome.Cancel`)하면 scheduler는 execute를 부르지 않고 tool call을 `Cancelled`("User denied execution.")로 끝내고 큐에 남은 call도 취소한다(`scheduler.ts:756-766`). 위의 `User dismissed ...` 문구가 모델에 가는 길은 확인 못함.
- 알림: 대기 중이면 attention 알림 제목이 "Answer requested by agent"이고 승인은 "Approval required"로 다르다(`cli/src/ui/utils/pendingAttentionNotification.ts:42-60`).

### 3.4 사람이 없는 실행

- 뺀다. 대화형이 아니거나(`-p` 등) ACP 모드면 tool을 제외 목록에 넣는다: "we explicitly block ask_user here to guarantee it can never be allowed via a high-priority policy rule when no human is present. We also exclude it in ACP mode as IDEs intercept tool calls and ask for permission, breaking conversational flows."(`cli/src/config/config.ts:795-803`). 정책에서도 `non-interactive.toml`이 `ask_user`를 priority 999로 deny한다("ASK_USER is strictly forbidden here"). 일반 ASK_USER 판정은 headless에서 DENY로 바뀐다.
- subagent에 이 tool을 주는지는 확인 못함(`agents/`에서 `ask_user`를 따로 처리하는 코드를 못 찾음). 원격 subagent 호출 자체는 ASK_USER 규칙(`agents/registry.ts:422-430`).

### 3.5 approval과의 관계

한 길을 쓰고 이름으로 구별한다. 같은 scheduler confirmation loop, 같은 message bus, 같은 dialog 영역이다. 차이는 confirmation details의 `type`(`ask_user`, `exec`, `edit`, `mcp` ...)이고 ACP 변환에서는 `ask_user`, `exit_plan_mode`에는 "항상 허용" 선택지를 만들지 않는다(`cli/src/acp/acpUtils.ts:171-173`).

### 3.6 mode

- plan mode: 읽기 tool과 함께 `ask_user`를 허용(`policies/plan.toml:104-109`, priority 50, `interactive = true`). plan 중 모든 접근을 ask_user로 보이고 승인받으라고 prompt가 지시.
- YOLO: allow-all 모드에서도 `ask_user`만은 사람에게 묻는다("Ask-user tool always requires user interaction, even in YOLO mode", `policies/yolo.toml:28-36`). prompt는 YOLO에서 질문을 아끼라고 한다.

---

## 4. OpenCode: `question`

### 4.1 schema와 description

`core/src/tool/plugin/question.ts`, `schema/src/question.ts`:

- 입력 `questions[]`(비어 있으면 안 됨, 개수 상한은 schema에 없음). 각 칸: `question`("Complete question"), `header`("Very short label (max 30 chars)"), `options[]`(`label` 1~5 단어 + `description`, 개수 제한 없음), `multiple`(선택, 여러 개 고르기).
- 자유 답은 `custom: true` 필드로 UI가 붙인다: description이 `A "Type your own answer" option is added automatically; don't include a separate option for free form answers`.
- description 전문 핵심: "Use this tool when you need to ask the user questions during execution. This allows you to: 1. Gather user preferences or requirements 2. Clarify ambiguous instructions 3. Get decisions on implementation choices as you work 4. Offer choices to the user about what direction to take." + 사용 노트(자유 답 자동 추가, `multiple: true`, 추천은 첫째에 "(Recommended)"). 쓰지 말라는 문구는 없다.

### 4.2 기다림과 답

- 멈춰 기다린다. tool이 `Form.ask`로 Form(범용 사람 입력 요청)을 만들고 `Deferred.await`한다. Form은 pending인 동안 TTL이 무한(`core/src/form.ts:114`), 끝난 뒤 10분만 남는다(`:8`). 기한 없음.
- 먼저 `Permission.assert({action: "question"})`를 거친다(`question.ts:65`). `question`이 agent별 권한 action이다.
- 답의 꼴: 구조 `answers: string[][]`(질문 순서, 질문마다 고른 label 배열 또는 자유 답), 모델에게 가는 문구는 `User has answered your questions: "<질문>"="<답, ...>", .... You can now continue with the user's answers in mind.` 답이 없으면 `Unanswered`(`toModelContent`, `question.ts:27-36`).
- 상태는 `pending`/`answered`/`cancelled`. event `form.created`, `form.replied`, `form.cancelled`(`events-opencode-pi.md`). V1의 `question.*` event를 대체.

### 4.3 기다리는 중 다른 입력, 취소

- 사람이 닫으면(`Form.cancel`) 메시지 없는 취소는 `QuestionTool.CancelledError`("The user dismissed this question")로 tool이 aborted가 되고 step이 interrupted로 끝난다. 권한 거절(`Permission.DeclinedError`)과 같은 길이라 turn이 끝난다(`session/runner/step.ts:205-220`, `session/model-request.ts:391-410`). 메시지를 붙인 취소는 모델에게 가는 평범한 실패 문구가 되어 모델이 이어 간다(`question.ts:95-96`).
- turn 중단(interrupt)이면 `Form.ask`의 `onInterrupt`가 Form을 cancel한다(`form.ts` `ask`). 서버를 닫을 때도 pending Form을 모두 cancel(`close`). Form은 메모리뿐이라 꺼졌다 켜지면 사라진다.
- TUI에서 Form은 입력 영역을 차지한다(`tui/src/routes/session/form.tsx`). 대화 입력창에 보낸 글이 답이 되는지는 확인 못함.

### 4.4 사람이 없는 실행

- subagent: `general`은 `question` deny, `explore`는 `*` deny, `title`/`summary`도 `*` deny(`core/src/plugin/agent.ts:84-130`). 한 action이 전부 deny이면 tool을 목록에서 뺀다(`core/src/tool.ts:231`, `whollyDisabled`).
- `opencode run`(비대화형): tool은 남아 있고 질문이 오면 CLI가 자동으로 cancel하면서 메시지를 붙인다: "This non-interactive run cannot ask the user questions, so the question was cancelled. Continue without an answer; make reasonable assumptions and state them."(`cli/src/run/noninteractive.ts:70-72, 188-205`). 그래서 모델이 가정을 적고 이어 간다. 같은 run이 연 subagent session의 질문도 같은 방식으로 자동 취소(`:141-155`). V1 호환 모드에서는 메시지 없이 cancel해서 run이 중단된다.
- 권한 요청도 같은 방식(`PERMISSION_REJECTED_FEEDBACK`, `--auto`면 허락)인데 둘이 별개 event, 별개 handler다.

### 4.5 approval과의 관계

별개 service와 event다: Form(`form.*`)과 Permission(`permission.asked`/`replied`). 알림은 "Input needs response"와 "Permission needs input"으로 따로 뜬다(`tui/src/feature-plugins/system/notifications.ts:44-60`). 둘의 접점은 `question`이 권한 action의 하나라는 점 하나다(agent 권한이 이 tool의 노출을 정한다). Form은 질문만이 아니라 범용 입력 요청이고(`metadata.kind`가 "question"), field type이 `string`, `multiselect`, `boolean`, `number`, `integer`, `external`로 질문보다 넓다.

### 4.6 mode

- `build`(기본): `question` allow. `plan`: allow(`plugin/plan.ts:38`). plan mode 전용 prompt는 질문을 특별히 말하지 않는다.

---

## 5. Hermes: `clarify`

### 5.1 schema와 description

`tools/clarify_tool.py:1-200`:

- 입력 `questions[]`(1~5개, "several INDEPENDENT questions belong in ONE call ... if one answer would change another question, ask separately"). 각 칸: `question`(필수), `choices[]`(최대 4개, 글자 수 제한 8000, 비우면 open-ended), `multi_select`.
- 첫 선택지에 UI가 "(Recommended)"를 붙인다("put your recommended option FIRST"). "Other" 줄은 UI가 자동으로 붙인다. 옵션은 `choices`에만 쓰고 질문 글에 나열하지 말라("dead prose the user can't click").
- 쓸 때/말 때: "Ask the user one or more questions when you need a decision, clarification, or feedback before proceeding." "Prefer deciding low-stakes questions yourself; don't use this for dangerous-command confirmation (the terminal tool handles that)."

### 5.2 기다림과 답

- agent thread가 막혀 기다린다. gateway는 module-level 대기 목록 `_entries`에 넣고 `Event`로 기다린다(`tools/clarify_gateway.py:61-95`). CLI/TUI는 각자 callback.
- 기한: 기본 3600초(`agent.clarify_timeout`, 0 이하는 무제한; `resolve_clarify_timeout`, `:263-273`). 옛 600초가 도중에 만료되는 사고(#32762) 뒤에 올렸다.
- 답의 꼴: JSON 문자열 `{"responses":[{"question","choices_offered","status","user_response"}...],"outcome":...,"notice"?}`. `status`는 `answered`/`skipped`/`unanswered`, `outcome`은 `submitted`/`cancelled`/`timed_out`/`undelivered`(`_result`, `clarify_tool.py:96-111`). 답은 질문 순서로, 질문 글을 되풀이해서 돌려준다. 사람이 `skip`이라 쓰면 skipped. "(Recommended)" 표시는 답에서 지운다.
- 여러 질문은 gateway에서 카드를 하나씩 보내고 첫 무응답에서 멈춘다(`gateway/run_turn_runner.py:1348-1372`).

### 5.3 기다리는 중 다른 입력, 취소

- gateway(메신저)에서 사람의 글은 먼저 대기 중 clarify에 가로채인다(`gateway/run_inbound.py:375-455`): 번호나 label이면 답, 자유 답 모드(Other 또는 open-ended)면 글이 그대로 답, 슬래시 명령은 건드리지 않고 clarify를 유지, 번호 모양인데 틀리면 유지하고 재시도. 선택지 카드에 선택과 무관한 글(prose)이 오면 그 clarify를 `CANCELLED`로 풀고 그 글을 보통 입력으로 보낸다. 주석: steer가 clarify tool이 끝나기 전엔 처리되지 않으므로 deadlock을 끊는다.
- 취소: `/new`, 종료, cached agent 제거 때 `clear_session`이 모두 `CANCELLED`로 푼다(`clarify_gateway.py:246-260`). 결과의 `outcome: cancelled`.
- 이 tool의 observer hook `on_human_input_request`/`on_human_input_resolved`는 sudo 비밀번호, clarify, 위험 명령 승인 셋을 같은 이름 아래 `kind`로 구별해서 보낸다(`tools/human_input_hooks.py`). 답은 payload에 싣지 않는다.

### 5.4 사람이 없는 실행

- 뺀다. `hermes-api-server`와 `hermes-acp` toolset은 `clarify`를 뺀다(`toolsets.py:190-201`). cron agent는 `messaging`, `clarify` toolset을 늘 disabled(`cron/scheduler.py:413-430`). delegate subagent는 `DELEGATE_BLOCKED_TOOLS`에 `clarify`("no user interaction")가 있고 `clarify_callback=None`(`tools/delegate_tool_toolsets.py:14-22`, `delegate_tool.py:279`).
- tool이 있는데 사람이 없는 경우는 즉시 답을 돌려준다. 한 번 실행(`hermes oneshot`)과 `chat -q`는 callback이 `{"answers":{}, "outcome":"undelivered", "notice":"... no user available. Pick the best choices using your own judgment, or make the most reasonable assumption you can, and continue."}`를 돌려준다(`hermes_cli/oneshot.py:661-668`, `hermes_cli/cli_agent_setup_mixin.py:15-30`). callback이 아예 없으면 `Clarify tool is not available in this execution context.` 오류.
- webhook toolset(`_HERMES_WEBHOOK_SAFE_TOOLS`)의 목록에는 `clarify`가 있다(`toolsets.py:42`). 그 실행에 callback이 있는지는 확인 못함.

### 5.5 approval과의 관계

별개다. clarify는 `tools/clarify_gateway.py`(자체 pending 표, FIFO)이고 approval은 `tools.approval`이다. CLI도 modal이 따로 있다(`hermes_cli/cli_modal_mixin.py`의 `_clarify_state`와 approval state). description이 위험 명령 확인에 clarify를 쓰지 말라고 막는다. 관찰 hook만 `kind`를 가진 한 계열로 묶는다.

### 5.6 mode

plan mode가 없다. posture/platform에 따라 tool 묶음이 달라진다(`coding` posture는 포함, `hermes-acp`/`hermes-api-server`는 제외).

---

## 6. Cline: `ask_question`

### 6.1 schema와 description

`sdk/packages/core/src/extensions/tools/schemas.ts:266-281`, `definitions.ts:818-838`:

- 입력: `question`(질문 하나, 필수), `options[]`(필수, 2~5개 문자열). 여러 질문 한 번에, multi-select, 자유 답 칸, 옵션 설명이 없다.
- description 전문: "Ask user a question for clarifying or gathering information needed to complete the task. For example, ask the user clarifying questions about a key implementation decision. You should only ask one question. Provide an array of 2-5 options for the user to choose from. Never include an option to toggle to Act mode."
- 자유 답은 UI가 받는다. CLI 터미널은 "Choose 1-N or type a custom answer"(`apps/cli/src/utils/approval.ts:120-170`). 답은 string 하나, VS Code는 이미지와 파일 첨부가 붙은 `Array<TextContent | ImageContent>`도 가능(`AskQuestionExecutor` 반환형, `types.ts:151`).

### 6.2 기다림과 답

- tool은 `executor(question, options, context)`를 부르고 그 Promise가 풀릴 때까지 기다린다. 기한 없음. 답은 tool result로 사람이 고른 글 그대로 돌아온다(문구 틀 없음).
- executor가 없으면 tool 자체가 목록에 없다: `enableAskQuestion && executors.askQuestion && !submitExecutor`일 때만 추가(`definitions.ts:970-973`). executor는 호스트가 준다(VS Code `SdkController.ts:425`, CLI `run-agent.ts:167`).
- VS Code: 질문을 `ask: "followup"` chat 메시지로 올리고 turn phase를 `awaiting_followup`으로 둔다(`apps/vscode/src/sdk/sdk-interaction-coordinator.ts:177-200`).

### 6.3 기다리는 중 다른 입력, 취소

- VS Code에서 사람이 채팅창에 보낸 글은 먼저 pending 도구 승인을 보고, 다음 pending 질문을 본다(`sdk-followup-coordinator.ts:70-80`). 질문이 pending이면 글이 그대로 답이 된다(`resolvePendingAskQuestion`, `sdk-interaction-coordinator.ts:262-300`, 사용자 메시지로도 기록). 도구 승인이 pending이면 일반 글(`messageResponse`)은 승인을 닫지 않고 다음 입력으로 쌓인다(`:215-221`). 같은 입력창이지만 질문은 글=답, 승인은 글≠답으로 다르게 다룬다.
- 취소/세션 정리: `clearPending`이 pending 질문을 빈 문자열 `""`로 풀어 run이 풀리게 한다("use an empty answer so the lifecycle reason is not presented as user input", `:312-322`). 승인은 거절 이유와 함께 거절로 푼다.

### 6.4 사람이 없는 실행

- CLI에서 stdin/stdout이 TTY가 아니면 기다리지 않고 첫 옵션을 답으로 돌려준다: `if (!process.stdin.isTTY || !process.stdout.isTTY) return options[0] ?? ""`(`apps/cli/src/utils/approval.ts:120-127`). 대화형 TUI에서 입력 창구가 없어도 첫 옵션(`session-runtime.ts:171-176`). 즉 말없이 결정을 대신한다.
- `yolo` preset은 `enableAskQuestion: false`, `enableSubmitAndExit: true`이고 submit이 켜져 있으면 ask_question을 추가하지 않는다(`presets.ts`, `definitions.ts:970`). `search`와 `minimal` preset도 끈다.
- subagent(`spawn_agent`)는 부모와 같은 `toolExecutors`를 받아 같은 호스트 executor로 질문한다(`runtime/host/local/spawn-tool.ts:128-137`). 막지 않는다(실제 UI에서 어떻게 보이는지 확인 못함).

### 6.5 approval과의 관계

별개 pending 상태다(`pendingAskResolve`와 `pendingToolApprovalResolve`가 따로, 한 coordinator 안). 둘 다 chat 메시지 목록에 `type: "ask"`로 올라가고(`ask: "followup"`과 tool 승인 ask), 입력 처리 규칙만 다르다(6.3). CLI 터미널에서는 질문(`askQuestionInTerminal`)과 승인(`requestToolApproval`)이 같은 파일의 다른 함수다.

### 6.6 mode

`plan`과 `act` preset 둘 다 켜져 있다(`presets.ts` 33, 53줄). description에 "Never include an option to toggle to Act mode"가 들어 있어 plan mode에서 질문 옵션으로 mode 전환을 묻지 말라고 한다.

---

## 7. 비교 표

| | Claude Code | Codex | Gemini CLI | OpenCode | Hermes | Cline |
|---|---|---|---|---|---|---|
| 질문 수 | 1~4 | 1~3 권장 | 1~4 | 제한 없음 | 1~5 | 1 |
| 옵션 수 | 2~4 | 2~3 권장, 필수 | 2~4(choice) | 제한 없음 | 최대 4 | 2~5 |
| 옵션 설명 | label + description | label + description | label + description | label + description | label만(문자열) | 문자열 |
| 여러 개 고르기 | `multiSelect` | 없음 | `multiSelect` | `multiple` | `multi_select` | 없음 |
| 자유 답 | UI가 "Other" 자동 | UI가 "Other" 자동 | UI가 "Other" 자동 | UI가 자동(`custom`) | UI가 "Other" 자동 | UI가 받음 |
| 자유 질문(옵션 없음) | 옵션 2개 미만은 거절. `kind: text`는 확장 변형 | 옵션 필수 | `type: text`, `yesno` | 옵션 필드는 있으나 빈 배열 가능, 확인 못함 | 옵션 생략 | 옵션 필수 |
| 부가 칸 | `header`, `preview`(SDK 켬) | `id`, `header`, `isSecret` | `header`, `type`, `placeholder` | `header` | 없음 | 없음 |
| 기다림 | tool call이 열린 채 turn 멈춤 | 같음 | 같음(confirmation) | 같음(Form) | agent thread 막힘 | Promise 대기 |
| 기한 | 기본 없음, `askUserQuestionTimeout` 선택 | tool 없음. non-blocking은 TUI가 60+60초 뒤 빈 답 | 없음 | 없음(pending TTL 무한) | 기본 3600초 | 없음 |
| 답의 꼴 | 문장 + `"질문"="답"` 목록 | JSON `{answers:{id:{answers:[]}}}` | JSON `{answers:{"0":"..."}}` | 문장 + `"질문"="답"` 목록 | JSON `responses[]` + `status` + `outcome` | 고른 글 문자열 |
| 취소/닫기 | 문구로 답 없음을 알림 | 오류 "cancelled before receiving a response" | scheduler가 Cancelled | 질문 취소는 turn 끝, 메시지 붙은 취소는 모델이 이어 감 | `outcome: cancelled` | `""` |
| 기다리는 중 다른 글 | 목록에서 보낸 글은 질문의 답. 승인은 큐 | modal. 확인 못함 | modal | 확인 못함 | 번호/label=답, 자유 답 모드=글이 답, 그 밖의 글=취소하고 보통 입력 | 글=답. 승인은 글이 답이 아님 |
| 사람 없는 실행 | tool 뺌(`-p`, `--permission-prompts none`) | subagent 금지. exec는 reject, 빈 답 | tool 뺌(비대화형, ACP) + 정책 deny | subagent는 deny로 뺌. `run`은 자동 cancel + 안내 문구 | 뺌(cron, api-server, acp, subagent). oneshot은 즉시 "판단해서 계속하라" | TTY 아니면 첫 옵션 자동 선택. yolo는 뺌 |
| 지켜보지 않는 session | background session은 질문이 기한 없이 대기, Needs input | 비동기 변형은 즉시 반환, 답은 새 메시지 | 해당 없음 | 해당 없음 | 해당 없음 | 해당 없음 |
| approval과 | 한 길(`ask` 판정), `waitingFor`로 구별 | 별개 tool, wire, 알림. MCP 승인만 UI 재사용 | 한 길(confirmation), `type`과 알림 문구로 구별 | 별개 service, event, 알림 | 별개 pending 표, modal. observer만 `kind`로 묶음 | 별개 pending 상태, 같은 chat에 `ask`로 |
| mode | plan에서 장려. 계획 승인은 `ExitPlanMode`가 따로 | Plan에서만 켜짐, Plan만 blocking | plan 허용. YOLO도 질문은 유지 | plan, build 허용 | plan mode 없음 | plan, act 둘 다 켜짐 |

---

## 8. lophn에 비춰 본 점

추천은 제안이다. 결정은 lead와 사람이 한다.

| lophn이 정할 것 | 추천 | 근거 harness |
|---|---|---|
| tool 모양 | 한 call에 질문 1~4개. 질문마다 `question`, 짧은 `header`, `options`(2~4, 각 `label` + 짧은 `description`), `multiSelect`. 추천 옵션은 첫째에 두고 UI가 "(Recommended)"를 붙인다. 자유 답("Other")은 schema에 없고 UI가 늘 붙인다 | 여섯 중 다섯(Claude Code, Codex, Gemini, OpenCode, Hermes)이 같은 모양이다. Cline만 단일 질문이라 한 번에 여러 물음을 못 한다 |
| 옵션 없는 열린 질문 | `options`를 생략하면 자유 답만 받는 질문으로 허용 | Hermes(`choices` 생략), Gemini(`type: text`). Codex와 Cline은 옵션을 강제해 억지 옵션이 나오고, Claude Code는 옵션 1개를 거절하면서 필러를 만들지 말라고 가르쳐야 했다 |
| 부가 칸(preview, 비밀 입력, 숫자, yes/no 종류) | 두지 않는다. 필요가 생길 때 더한다 | Claude Code의 `preview`는 SDK에서 켜야만 생기고 single-select 한정, 확장 `kind`는 host별 변형이다. 공통 필수 칸은 아니다 |
| 답의 꼴 | 질문 순서대로 `{question, status(answered/skipped/unanswered), answer}` 배열과 전체 `outcome`(submitted, cancelled, timed_out, undelivered). 답이 없는 경우마다 모델이 할 일을 문구로 알린다("판단해서 계속하라", "다시 묻지 마라") | Hermes가 가장 갖췄다. Claude Code는 같은 뜻을 문장 여섯 가지로 나눠 돌려준다. OpenCode의 "Unanswered", "state.message" 취소 문구도 같은 역할 |
| description에 넣을 규칙 | "사람이 정할 결정이고 요청, code, 기본값으로 풀 수 없을 때만. 코드에서 확인할 수 있는 사실이나 관례적 기본값이 있는 선택은 묻지 마라. 권한 확인에 쓰지 마라. 답이 없으면 판단해서 계속하라" | Claude Code(binary description), Codex(mode 지침), Hermes(description) |
| 기다리는 동안 | turn이 tool call을 연 채 멈춰 기다린다(session 상태는 "입력 기다림"). 기한은 두지 않는다. 사람이 오래 안 오는 일은 6행의 "지켜보지 않는 session" 규칙으로 푼다 | 모두가 멈춰 기다린다. 기한은 Claude Code(선택)와 Hermes(3600초)만 두고, OpenCode(pending TTL 무한), Gemini, Cline은 두지 않는다. S2의 "기한 없음"(req-0305)과 같은 방향이다. Codex의 60+60초 auto-resolve는 non-blocking 변형이라 가져오지 않는다 |
| 꺼졌다 켜지면, turn이 끊기면 | 질문은 tool result `cancelled`로 끝낸다. S2의 turn 안 request와 같은 규칙 | Codex(`clear_pending_waiters`), OpenCode(`Form.close`), Hermes(`clear_session`), Claude Code(SDK가 닫히면 pending 취소). 모두 메모리 대기라 다시 열지 않는다 |
| 대기 중 사람이 대화 입력창에 다른 글을 보내면 | 질문 카드로만 답하게 하고, 입력창의 글은 pending 질문을 `cancelled`(이유: 사람이 새 글을 보냄)로 풀면서 새 입력으로 전달한다. 글을 질문의 답으로 삼는 안은 질문이 여럿이거나 옵션 답이면 모호하다. 결정 필요 | Hermes(옵션 카드에 prose가 오면 clarify를 풀고 글을 보통 입력으로 보냄, deadlock 방지). 반대로 글=답은 Cline(VS Code), Claude Code agent view(peek 패널에서 보낸 글). 승인은 글이 답이 되지 않는다(Cline, Claude Code) |
| 사람이 없는 session (reaction으로 연 session, call을 받은 session) | tool을 주지 않는다. 구별은 program이 session의 시작 원인(사람 메시지인가, domain event인가, 다른 agent의 call인가)으로 결정적으로 정한다. 그래도 불렸을 때를 위해 "지금 사람이 없다. 판단해서 계속하라"는 결과를 즉시 돌려주는 안전망을 둔다. 받은 session이 사람에게 물을 일이 생기면 질문 대신 call의 답으로 "무엇이 필요한지"를 돌려준다(S3) | tool 빼기: Claude Code(`-p`, `--permission-prompts none`), Gemini(비대화형), Hermes(cron, api-server, subagent), OpenCode(subagent). 즉시 안내 결과: OpenCode(`run`의 자동 cancel + 안내), Hermes(oneshot `undelivered`). 자식이 부모에게 넘김: Codex(non-root 금지, "Ask the parent agent") |
| 첫 옵션을 자동으로 고르는 것 | 하지 않는다. 사람 대신 결정하는 것이라 S2 철학("결정은 사람")과 맞지 않는다 | Cline만 TTY가 아닐 때 `options[0]`을 말없이 답으로 돌려준다. 다른 다섯은 "답 없음"을 알리고 모델이 판단하게 한다 |
| 지켜보지 않는 session이지만 사람이 나중에 오는 경우 | 둘 중 하나를 사람이 고른다. (가) 위처럼 tool을 뺀다(추천). (나) tool을 주고 질문을 기한 없이 대기 목록에 둔다: 사람이 올 때까지 turn이 멈춘다. (다) 질문을 메시지로 내고 turn을 끝낸 뒤 답이 새 입력으로 session을 다시 깨운다 | (나) Claude Code background session(timer 없이 Needs input). (다) Codex `request_user_input_async`(즉시 `{"accepted":true}`, 답은 새 사용자 메시지로). (다)는 S3의 끝난 session 되살리기와 닿는다. (나)와 (다)는 조사한 harness 가운데 각각 하나만 갖고 있다. (가)로 시작하고 필요가 보이면 (다)를 검토 |
| approval과 같은 대기 목록? | 목록은 하나(req-1498), 항목 종류는 구별한다(권한 물음, 질문). event도 따로 둔다: 권한은 `PermissionRequested`/`Resolved`를 쓰고 질문은 새 agent event 한 쌍(예: `InputRequested`/`InputResolved`)을 둔다. 카드의 모양과 toast 문구, 답하는 길(결정 vs 답 입력)이 다르다 | 한 목록 안에서 종류를 구별: Claude Code(`waitingFor`: permission prompt와 input needed, 같은 Needs input 상태), Gemini(같은 loop, 알림 문구 구별). event까지 따로: OpenCode(`form.*`와 `permission.*`), Codex(wire와 알림 type), Hermes(observer hook `kind`) |
| 질문 카드와 권한 카드를 구별해야 하는 이유 | 질문 카드의 글은 agent가 쓴 것이고, 권한 카드는 program이 intent에서 만든다(S2 req-0300). 한 카드 꼴로 섞으면 agent가 질문 글로 권한 물음처럼 보이게 쓸 수 있다. 그래서 질문 tool에 권한 확인을 쓰지 말라는 규칙과 화면 구별을 같이 둔다. 이 위험 자체는 이 조사의 근거가 아니라 lophn 쪽 추론이다 | Codex(description이 "Never use ... for permission requests", wire 분리), Hermes(description이 위험 명령 확인에 쓰지 말라) |
| 답에 "항상/이 session 동안" 같은 선택지 | 두지 않는다. 질문의 답은 grant가 아니다 | Gemini ACP 변환은 `ask_user`와 `exit_plan_mode`에 "항상 허용" 선택지를 만들지 않는다(`acpUtils.ts:171-173` 주석). 나머지 harness는 질문에 그런 선택지가 없다 |
| mode | 질문 tool에 mode별 차이를 두지 않는다. 노출은 agent 정의의 tool 칸(S4)과 위 session 시작 원인 규칙이 정한다. "계획이 괜찮나"를 질문으로 묻지 말라는 규칙은 계획 승인에 쓰는 쪽(사람의 결정 command)이 따로 있을 때만 필요 | Claude Code는 plan 승인을 `ExitPlanMode`로 분리해 질문 tool로 묻지 말라고 한다. Codex는 Plan mode에서만 켜는 방식이라 lophn에 mode가 없으면 맞지 않는다 |

## 9. 확인 못한 것

- Claude Code: source 비공개. 실제 요청에 가는 description 조합(feature flag 변형), `defer`의 세부, 질문이 pending일 때 interactive TUI 입력창에 보낸 글의 처리. 문서의 "question"이 `AskUserQuestion`을 뜻하는 대응은 추론.
- Codex: TUI에서 질문 modal이 열린 동안 다른 메시지를 보내는 길. `codex exec`가 아닌 app-server client에서 Plan mode 밖의 사용.
- Gemini CLI: subagent가 `ask_user`를 받는지. 취소할 때 모델에 가는 문구 두 개 중 어느 쪽인지.
- OpenCode: TUI 입력창에 보낸 글이 Form 답이 되는지. `question` 옵션 개수 제한(schema에는 없음).
- Hermes: webhook 실행에 clarify callback이 있는지. CLI modal의 timeout 동작은 `_clarify_deadline`만 확인.
- Cline: subagent의 질문이 화면에서 어떻게 보이는지. 질문 tool 결과에 시스템 문구가 붙는지(문자열 그대로 돌아온다고만 확인).
