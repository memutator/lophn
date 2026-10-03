---
type: research
concerns: [lophn-agent/questions]
---
# 질문과 human-in-the-loop

## 질문
사람 답의 입력 모양·대기·재개·secret 경계는 어디서 보장하는가.
질문 답과 approval, 고정 option action 적용을 어떻게 구별하고 재시작·늦은 답·전제 변경에 안전하게 잇는가.

조사일: 2026-10-04. 아래 경로 접두사는 `/tmp/claude-1000/lophn-research/` 아래 clone 이름이다. `[확인]`은 실제 소스·테스트를 읽은 사실, `[추측]`은 설계 해석, `[미확인]`은 조사한 경로에서 확인하지 못한 것이다. 찾아보지 않은 저장소 전체에 대해 기능이 없다고 단정하지 않는다. lophn의 기준은 requirements·domain model의 `lophn-agent/questions`, 재개는 `lophn-agent/harness/waiting-and-recovery#R1`–`R5` 및 architecture §7.3이다. 일반 run loop·approval 구현 전체는 별도 조사 범위다.

## 프로젝트별

### LangChain (57236d55d9ff)

- **[확인] 입력과 approval 혼합.** `langchain:libs/langchain_v1/langchain/agents/middleware/human_in_the_loop.py`의 `ActionRequest`, `ReviewConfig`, `HITLRequest`, `HITLResponse`, `DecisionType`은 tool `name/args/description`과 허용 decision을 표시하고 여러 tool action을 한 interrupt에 묶는다. decision은 `approve / edit / reject / respond`; `respond`는 ask-user 스타일 tool을 실제 실행하지 않고 사람의 `message`를 success `ToolMessage`로 만드는 가지다. 선택지 설명·추천·multi-select의 독립 Question 타입은 이 middleware에 없다. 이것은 기호 선택 UI보다 **tool review protocol**이다.
- **[확인] gate와 개수.** 같은 파일 `HumanInTheLoopMiddleware.__init__`, `after_model`(427–525)은 `interrupt_on`에 없는 tool을 검토하지 않는다. 설정 `True`는 네 decision을 허용하고, 허용 decision이 없거나 빈 설정은 `ValueError`다. 검토 대상 action 수와 resume의 decisions 수가 다르면 `ValueError`; 대응은 순서 기반이고 tool call 순서를 보존한다. 한 interrupt에 독립 action 여러 개가 들어갈 수 있다.
- **[확인] 같은 checkpoint 재개.** `after_model`은 `interrupt(hitl_request)["decisions"]`를 기다린다. `langchain:libs/langchain_v1/tests/integration_tests/agents/middleware/test_human_in_the_loop_integration.py`의 `test_hitl_reject_does_not_retry`는 `InMemorySaver`, 같은 `thread_id`, `Command(resume={"decisions": [{"type": "reject"}]})`로 재개하고 rejection result·weather call이 각각 1개인지 검사한다. `langchain:libs/langchain_v1/langchain/agents/factory.py`(1900–1921)는 caller의 `checkpointer/store`를 graph compile에 전달한다. **InMemorySaver 테스트는 process restart durability 근거가 아니다.** 이 middleware 자체의 pending ledger·기한·defer·재시작 복구는 `[미확인]`; 실제 persistence는 caller가 고른 graph 저장 구현까지 봐야 한다.
- **[확인] edit는 실제 tool 변경.** `human_in_the_loop.py`의 `_process_decision`, `wrap_tool_call`, `awrap_tool_call`은 원래 model tool call을 메시지에 유지하고 `hitl_edited_tool_calls`에 replacement를 저장한다. 실행 때 name/args를 교체하고 실제 실행된 입력을 result notice로 덧붙인다. 다른 tool로 redirect 가능하며 등록되지 않은 이름은 `ValueError`; 매 turn edit map을 reset한다. `respond.message`의 nonblank 검사, secret 분류, owner CAS binding은 이 파일에서 `[미확인]`이다.
- **[확인] 옛 review의 존중.** `langchain:libs/langchain_v1/tests/unit_tests/agents/middleware/implementations/test_human_in_the_loop.py`의 `test_recorded_edit_survives_a_later_tightening_of_allowed_decisions`(1688–1740)는 저장된 edit 후 허용 decision을 approve/reject로 좁혀도 replacement `draft_email`을 실행한다. 이것은 **review 옵션 정책 재검사**에 관한 사실이지 모든 runtime 권한 검사를 건너뛴다는 근거는 아니다. lophn의 현재 범위·고정 input·CAS 재검사와는 별개로 설계해야 한다.
- **[확인/미확인] reject 이후.** 기본 rejection 문구는 사람의 새 명시 요청 없이 같은 call을 재시도하지 말라고 model에 안내한다. 위 integration test가 특정 모델의 재시도 없음을 확인한다. 사람이 거절한 exact operation/input을 lineage 전체에서 machine이 차단하는 저장 계약은 해당 경로에서 `[미확인]`이다. 문구만으로 lophn의 거절 억제 보장을 대체하면 안 된다.

### OpenCode (907b3bc518fa)

- **[확인] 여러 질문·multi-select·자유 입력.** `opencode:packages/schema/src/v1/question.ts`의 `Option`, `Info`, `Prompt`, `Answer`, `Reply`는 `question/header/options`, option `label/description`, optional `multiple`을 둔다. 답은 `answers: string[][]`로 질문 순서에 대응한다. `Info.custom`의 설명은 default true이나 model-facing `Prompt`에는 custom 필드가 없다. label 1–5 words·header 최대 30자는 schema annotation이고 실제 길이 constraint가 아니다. questions/options 배열의 고정 min/max, nonblank string 제약은 이 schema에 없다. 구조화 recommendation도 없다.
- **[확인] pending은 live Deferred.** `opencode:packages/opencode/src/question/index.ts`의 `PendingEntry`, `State`, `ask`는 `InstanceState`의 `Map<QuestionID, {info, deferred}>`에 매번 새 ID를 넣고 `Event.Asked` 후 `Deferred.await`한다. `ensuring`에서 제거하고 instance finalizer는 pending 전부를 fail·clear한다. `list`는 현재 map만 반환한다. 이 service는 run/session당 pending 하나를 검사하지 않는다. 이 경로의 pending map은 process-local이며 저장 후 restart 재구성은 `[미확인]`이다.
- **[확인] 명시 reply와 dismissal.** 같은 파일 `reply({requestID, answers})`는 pending을 찾고 없으면 `Question.NotFoundError`, 있으면 delete→`Event.Replied`→`Deferred.succeed` 순서다. `reject`는 `QuestionRejectedError("The user dismissed this question")`로 fail한다. 질문 수·선택 label·빈 string/array의 추가 answer 검증은 이 service에 없다. 일반 message를 이 service가 답으로 읽지는 않지만, 모든 UI/transport의 routing은 `[미확인]`이다. expiry·별도 defer는 이 파일에 확인되지 않는다.
- **[확인] result 뒤 parent 계속.** `opencode:packages/opencode/src/tool/question.ts`의 `QuestionTool`은 `questions[]`와 session/message/tool-call ID를 전달하고 답을 tool result로 만든다. 빈 answer는 `Unanswered`로 표시하며 `You can now continue with the user's answers in mind.`를 덧붙인다. 자유 답·선택 답 모두 model 입력이다. 이것은 lophn의 empty-answer 거절·답 없음 stopped와 다르다. 고정 owner action dispatch나 CAS는 이 tool에서 `[미확인]`이다.
- **[확인] 테스트.** `opencode:packages/opencode/test/question/question.test.ts`(120–229)는 reply가 waiter를 resolve하고 pending에서 제거되는지, unknown request가 실패하는지, reject가 typed error인지 검사한다. lophn은 이에 durable restart·마감 경계·공백 답·same-run pending unique 테스트를 추가해야 한다.

### Codex (3a69ec3ef8fb)

- **[확인] protocol과 model schema는 다르다.** `codex:codex-rs/protocol/src/request_user_input.rs`의 `RequestUserInputQuestion`은 `id/header/question/is_other/is_secret/options`; args는 `questions/is_blocking/auto_resolution_ms`, 답은 `HashMap<question_id, {answers: Vec<String>}>`다. `auto_resolution_ms`는 deprecated이며 omitted event `isBlocking`은 backward-compatible true다. 배열로 여러 답을 표현할 수 있다는 사실을 model-facing multi-select 지원으로 곧바로 읽으면 안 된다.
- **[확인] 권장 개수는 설명.** `codex:codex-rs/core/src/tools/handlers/request_user_input_spec.rs`의 schema 작성·normalization은 model에게 질문 1–3개, 가급적 1개, 선택지 2–3개·상호 배타·추천은 첫 label `(Recommended)`를 안내한다. 해당 array schema에는 이 숫자의 min/max 제약을 넣지 않는다. normalization은 각 질문의 options 누락/빈 배열을 거절하고 `is_other=true`로 설정한다. model schema에는 `isSecret/isOther` 필드가 없다. 질문 ID unique·모든 string nonblank·선택지 상한의 강제는 이 코드에서 `[미확인]`이다.
- **[확인] root 제한과 blocking 표시.** `codex:codex-rs/core/src/tools/handlers/request_user_input.rs`의 `RequestUserInputHandler`는 subagent thread에서 거절하고 available mode를 검사한다. Plan이면 `is_blocking=true`, 아니면 false를 붙이지만 **handler는 두 경우 모두 response future를 await**한다. `auto_resolution_ms=None`이다. cancellation은 model에 오류로 반환한다. `request_user_input_tests.rs`의 `multi_agent_v2_request_user_input_rejects_subagent_threads`, `request_user_input_sets_non_blocking_outside_plan_mode`(27–184)는 root 제한 및 nonblocking event 뒤 명시 response로 handler가 끝나는 것을 검사한다.
- **[확인] active-turn oneshot.** `codex:codex-rs/core/src/session/mod.rs`의 `request_user_input`, `notify_user_input_response`(3060–3169)는 active turn의 pending map에 oneshot sender를 등록하고 `call_id/turn_id` event를 보낸다. 이미 같은 sub-ID의 sender가 있으면 overwrite warning이다. response는 pending을 remove하고 acceptance order를 확보해 sender로 전달한다. unknown/늦은 response는 warning이며 새 판단을 여기서 만들지 않는다. process restart로 pending sender를 복구하는 경로는 `[미확인]`; overwrite는 lophn의 두 번째 pending 생성 conflict와 다르다.
- **[확인] 빈 답은 evidence 필터와 구별.** handler는 response를 JSON tool output으로 반환한다. Guardian evidence에 보관할 `VerifiedAnswer`에서는 blank 답을 빼고 선택 설명·acceptance order를 보존한다. `request_user_input_tests.rs`의 blank/unrequested/oversized multiline 사례(85–184)는 handler success와 evidence 필터를 별도로 다룬다. **evidence에서 빼는 것을 answer command의 거절로 주장할 수 없다.**
- **[확인/미확인] secret.** protocol에 `is_secret`가 있고 `codex:codex-rs/tui/src/bottom_pane/request_user_input/render.rs`(410–414)는 composer를 `'*'`로 mask한다. mask는 화면 표시 보장일 뿐 일반 history/model 입력/서버 로그 exclusion 보장은 `[미확인]`이다. lophn의 safe-input routing을 이것만으로 구현하면 안 된다.
- **[확인] async 이름은 다른 계약.** `codex:codex-rs/core/src/tools/handlers/request_user_input_async.rs`의 handler는 title·optional string options를 가진 questions를 async `AgentMessage`로 보내고 `{"accepted":true}`를 즉시 반환한다. 최소 1개·nonempty title/options를 검사하고 추천 첫 option을 UI default preselected라고 안내한다. 이것은 답을 기다리는 같은 run 재개 구현이 아니다. 두 tool을 같은 HITL 동작으로 합쳐 비교하지 않는다.

### Gemini CLI (fb972b2f87fe)

- **[확인] choice/text/yesno.** `gemini-cli:packages/core/src/confirmation-bus/types.ts`의 `Question`, `QuestionType`, `AskUserRequest`(177–208)은 choice/text/yesno, option label+description, choice의 `multiSelect`, Other, placeholder와 `correlationId`를 정의한다. `gemini-cli:packages/core/src/tools/definitions/model-family-sets/default-legacy.ts`의 AskUser definition(635–701)은 questions `minItems=1/maxItems=4`다. Gemini-3 definition도 questions 최대 4다.
- **[확인] 실제 validation.** `gemini-cli:packages/core/src/tools/ask-user.ts`의 `AskUserTool`은 질문 최소 1개, choice options 2–4개, trimmed nonempty label, description string을 검사한다. 빈 description string은 허용된다. schema max 4와 tool validation의 최소/choice bound는 각각 다른 층이다. structured recommendation field는 해당 타입에 없으며 `(Recommended)` 같은 label 문구가 쓰인다.
- **[확인] approval infrastructure와 질문 의미 분리.** 같은 파일 invocation은 private `confirmationOutcome/userAnswers`를 두고 confirmation details의 `type:'ask_user'`, questions, `onConfirm`으로 답을 받는다. `execute`는 Cancel을 dismissal로, 빈 submission을 `empty_submission=true` metric과 no-answer output으로 반환하며 오류로 거절하지 않는다. 성공 답은 question **index** 기준 JSON `{"answers": ...}`로 model에 들어간다. option action dispatch는 이 경로에 없다. 같은 bus를 쓰는 것이 question 답을 approval grant로 바꾼다는 뜻은 아니다.
- **[확인/미확인] 복구.** `ask-user.ts`의 상태는 live invocation 필드다. 이 tool에는 고정 expires_at·defer·durable Question entity가 확인되지 않는다. scheduler/bus를 포함한 process restart 복원·보관 기간은 `[미확인]`이다. 이 한 파일로 저장소 전체의 persistence 부재를 단정하지 않는다.
- **[확인] 테스트.** `gemini-cli:packages/core/src/tools/ask-user.test.ts`는 `onConfirm` 답→`execute` 결과, `ProceedOnce`에 빈 answers `{}`가 들어오는 사례, choice 범위·label/description validation을 검사한다. 빈 submission 수용은 lophn과 의도적으로 다르다.

### Hermes Agent (343500b3547e)

- **[확인] batch·추천·상한.** `hermes-agent:tools/clarify_tool.py`의 `_normalize_questions`, `mark_recommended`, `_result`, `clarify_tool`은 최대 질문 **5개**, 선택지 **4개**, 선택지 글자 **8,000자**다. 질문 5개 초과는 오류, option 초과는 `[:4]`로 자른다. blank option을 제거하고 최소 2개일 때 첫 option에 `(Recommended)`를 붙인다. qid는 `q0/q1/...`; multi-select는 choices가 있어야 한다. schema는 독립 질문 여러 개를 한 call에 묶으라고 안내한다. lophn `questions#R1`과 반대다.
- **[확인] 결과와 approval 구별.** 같은 파일 result는 `responses[] {question, choices_offered, status, user_response}` 및 `outcome=submitted/cancelled/timed_out/undelivered`다. 개별 status는 answered/skipped/unanswered. callback이 없으면 unavailable tool error다. schema는 dangerous command confirmation에 clarify를 쓰지 말고 terminal tool이 처리한다고 명시한다. 선택 결과를 owner command에 직접 binding하는 구현은 이 tool에 없다.
- **[확인] FIFO·일반 메시지 답.** `hermes-agent:tools/clarify_gateway.py`의 module `_entries/_session_index`, `register`, `get_pending_for_session`, `resolve_text_response_for_session`, `resolve_gateway_clarify`는 RLock·threading.Event와 세션별 FIFO를 쓴다. open-ended `awaiting_text=true` 및 Other 전환 뒤에는 **다음 일반 text 메시지**가 답이다. 선택 질문은 숫자/label, multi는 `1,3`·`1 3`·label을 변환하고 중복 선택을 제거한다. 잘못된 pick은 재입력을 유지한다. prose rejection 이후 gateway caller의 steering 분기는 이번 조사에서 `[미확인]`이다.
- **[확인] 기한·취소·first wins.** 같은 파일 `get_clarify_timeout_seconds`, `wait_for_response`, `clear_session`의 timeout default는 **3,600초**, legacy `clarify.timeout`→`agent.clarify_timeout`→default 순서다. nonnumeric은 default, `<=0`은 unlimited다. monotonic deadline과 최대 1초 Event wait slice를 사용한다. first resolution wins; unknown/already-resolved ID는 false. `/new`·shutdown·eviction의 clear는 미결 질문을 cancel하고 이미 resolved된 답은 보존한다. registry는 process-local이다. 재시작 복원은 `[미확인]`이다.
- **[확인] 테스트.** `hermes-agent:tests/tools/test_clarify_gateway.py`의 `test_zero_timeout_waits_until_resolved`는 timeout 0에서 waiter가 살아 있다가 실제 답 뒤 끝나는지 검사한다. `test_resolve_text_response_end_to_end`는 일반 `1,2` text가 JSON `["A","B"]`로 waiter에 전달되는지 검사한다. lophn에서는 후자가 성공하면 오히려 요구 위반이다. secret detector·안전 입력 routing은 위 tool/gateway에서 `[미확인]`이다.

### OpenClaw (37efa0b4a644)

- **[확인] ask_user schema와 default.** `openclaw:src/agents/tools/ask-user-tool-normalization.ts`의 normalization/schema는 질문 **1–3개**, option **2–4개**, option label 최대 **64자**, header 최대 **12 UTF-16 code units**로 안전하게 자르며 multiSelect·Other=true를 둔다. 추천은 첫 option 안내다. timeout 기본 **900초**, clamp **30–3,600초**, RPC grace **10,000ms**다. lophn의 상한 없음·기본 기한 없음에 복사하면 안 된다.
- **[확인] pending 단위와 ID.** `openclaw:src/agents/tools/ask-user-tool.ts`의 pending map은 process-global이며 세션당 slot을 reservation한다. stable ID는 `owner + NUL + toolCallId`의 SHA-256 앞 32 hex로 `ask_...`를 만든다. owner는 run 또는 세션 identity다. 두 번째 pending은 거절하고 lifecycle은 reserved/registering/prompting/answerable/resolving/prompt-failed다. ID 안정화는 좋은 참고지만 **세션 slot과 run당 pending은 같지 않다.**
- **[확인] manager·기한.** `openclaw:src/gateway/question-manager.ts`의 `QuestionManager`는 transient request/terminal map을 memory에 둔다. terminal grace는 **15,000ms**; duplicate provided ID는 `QUESTION_ID_IN_USE`, terminal resolve는 `QUESTION_ALREADY_TERMINAL`, invalid answer는 `QUESTION_INVALID_ANSWER`, inactive requester는 `QUESTION_REQUESTER_INACTIVE`다. `expiresAt=now+duration`을 만들고 `expiresAt<=now`이면 expire한다. active requester validator와 `registerHumanInputWait`로 run을 연결한다. 이는 재시작 가능한 lophn ledger와 다른 저장 범위다.
- **[확인] answer validation.** 같은 파일 `validateAnswers`(508–563)는 unknown question ID를 거절하고 누락/빈 배열은 `allowEmpty`일 때만 인정한다. ordinary answer의 whitespace-only string을 거절하고 single-select의 길이 >1을 거절한다. label/value를 canonical value로 바꾸고 Other가 없을 때 unknown option을 거절한다. secret/form은 trim 대신 실제 길이 0만 거절한다. 이 validator와 일반 model-facing ask_user의 제한을 구분해야 한다.
- **[확인] 일반 text bridge.** `openclaw:src/agents/harness/gateway-question.ts`의 `claimPendingAgentQuestionAnswerFromCaller`, `claimQuestionAnswer`는 creator authority·현재 pending을 확인하고 일반 text를 parse하여 `question.resolve`에 `resolvedBy:'plain-text'`와 resolutionId로 보낸다. ordinary 답의 staged transcript는 먼저 commit한다. lophn은 authority 확인만 가져오고 **일반 세션 메시지를 답으로 claim하는 편의 기능은 버린다.**
- **[확인] no answer 뒤 판단 계속.** `ask-user-tool.ts`의 `noAnswerResult`(348–364)는 cancelled와 timeout 모두 반환 status를 `no_answer`로 만들고 각각 `proceed with best judgment`를 model에 안내한다. abort·delivery failure·wait timeout도 닫는 경로가 있다. lophn은 no-answer를 같은 run의 `stopped/no_answer`로 확정하므로 이 continuation 문구를 가져오면 안 된다.
- **[확인] secret은 별도 flow.** `openclaw:src/gateway/question-validation.ts`의 `questionShapeError`는 일반 tool normalization의 `allowPlainSecretQuestions=false`에서 plain secret을 거절한다. `secretStore`는 isSecret 필수, 정확히 질문 1개, option 없음·multi 없음, 유효 env secret ref 등을 요구한다. URL은 absolute HTTP(S), embedded credential 금지다. `gateway-question.ts`의 secret settle 가지는 일반 transcript custody를 만들지 않는다. 이 범위는 safe input route의 실제 참고다. 전체 redaction/storage sink audit는 `[미확인]`이며 단순 mask와 동일시하지 않는다.

### Claude Code 보조 근거 (1c229fcd1e1e)

**CHANGELOG/plugin 예시 근거**이며 소스 프로젝트 수에 세지 않는다. `claude-code:CHANGELOG.md`의 AskUserQuestion 항목은 default auto-continue 제거·`/config` idle timeout opt-in(3453), free-text 후 continue를 강요하던 문구 수정(3027), multi-select Other/array 답 누락 수정(3747/4620), PreToolUse의 updatedInput+allow로 외부/headless UI가 답을 제공할 수 있다는 변경(5589)을 기록한다. 실제 durable state·권한·restart 구현의 근거로 쓰지 않는다. 문구 하나가 no-answer/자유 답의 의미를 바꿀 수 있으므로 출력 fixture에 포함할 이유는 된다.

## 비교

아래 셀은 위 프로젝트별 근거를 요약한다. `미확인`은 저장소 전체의 부재가 아니다.

### 입력·결정 경계 (조사 질문 1·3·5·6·7)

| 프로젝트 | 하나/여러 질문·설명·추천·자유 입력·multi | 명시 answer / 빈 답 | option action / 전제 변경 | secret / approval |
|---|---|---|---|---|
| LangChain | 여러 tool review; name/args/description; respond message; 일반 option UI 미확인 | resume decisions, 개수 일치; respond nonblank 검사 미확인 | edit가 tool/args 변경; 저장된 edit 존중; owner CAS 미확인 | secret 미확인; approve/edit/reject/respond 혼합 |
| OpenCode | questions[]; 설명; recommendation field 없음; custom; multiple | requestID reply; 빈 답 service 검증 없음, Unanswered 결과 | 문자열을 model에 전달; 고정 owner action 미확인 | secret 미확인; question 별도 service |
| Codex | 질문 1–3/option 2–3은 설명; 설명·첫 추천·Other; 답 Vec가 UI multi를 증명하지 않음 | turn response map; blank evidence 제외지만 raw response success | 응답 JSON; 고정 option/CAS 미확인 | isSecret mask만 확인; question과 approval 타입 별도 |
| Gemini CLI | schema 1–4; choice 2–4; 설명; text/yesno/Other/multi; 추천 별도 field 없음 | confirmation payload/index; 빈 submission 수용 | JSON tool result; binding 미확인 | secret 미확인; bus 공유하나 ask_user 타입 구분 |
| Hermes | 질문 ≤5/option ≤4·잘림; 첫 추천; text/multi | 다음 일반 text도 답; skipped/unanswered 별도 | 문자열/JSON result; binding 미확인 | secret 미확인; dangerous confirmation은 terminal로 구분 |
| OpenClaw | 질문 1–3/option 2–4; 설명·첫 추천·Other/multi | 명시 RPC 및 일반 text claim; allowEmpty 외 빈 답 거절 | canonical 선택값; owner action/CAS 미확인 | plain secret 금지+secretStore route; 질문 별도 protocol |
| **lophn** | **질문 하나=결정 하나; option 상한 없음; 설명·추천 이유; 단일 선택 또는 자유 답** | **질문 ID를 지정한 답만; blank 거절; 일반 message 불인정** | **고정 binding/CAS; 사람 선택 뒤 machine이 한 번; 자유 답은 dispatch 없음** | **평문 질문 금지·safe input; question은 approval/권한을 대신하지 않음** |

### 대기·저장·재개 (조사 질문 2·4)

| 프로젝트 | pending scope / 저장 | 기한·미루기·취소 | 답 뒤 같은 진행을 잇는 방식 |
|---|---|---|---|
| LangChain | graph checkpoint; 저장 방식 caller 선택 | middleware deadline/defer 미확인; reject/respond decision | 같은 thread `Command(resume=...)`; 재실행 경계는 graph contract |
| OpenCode | instance Map+Deferred; pending 1 제약 없음 | deadline/defer 미확인; reject/dismiss; finalize fail | await tool result 뒤 계속; 빈 답도 Unanswered로 계속 |
| Codex | active-turn pending oneshot; 같은 sub-ID overwrite warning | 이 handler timeout 없음; cancellation error; durability 미확인 | response sender→JSON tool result; is_blocking=false도 await |
| Gemini CLI | invocation 필드+confirmation bus; durable 복구 미확인 | 이 tool deadline/defer 미확인; Cancel/empty result | onConfirm 답을 execute output으로 model에 전달 |
| Hermes | process-local Event/FIFO; 여러 pending 가능 | 기본 3,600초; <=0 무기한; skip/cancel/timeout | callback waiter result; 다음 일반 text로도 resolve |
| OpenClaw | process-local 세션 slot+gateway Map | 기본 900초; 30–3,600 clamp; terminal grace 15초 | waitAnswer→tool result; no_answer도 best-judgment 계속 |
| **lophn** | **ledger; run당 pending 최대 1; session optional; 본문·답·적용 기록 유지** | **기본 expires_at=null; now>=마감 거절; defer/cancel/expiry 답 없음** | **runtime 자원 해제 후 저장 결정 재확인; 답→같은 run, 답 없음→stopped/no_answer** |

### 숫자의 의미

| 숫자 | 강제되는 자리 / 복사하지 않을 이유 |
|---|---|
| Codex 질문 1–3·option 2–3 | model 설명; 이 schema의 runtime bound라고 쓰지 않는다 |
| OpenCode header 30자·label 1–5 words | annotation; 검증 규칙과 혼동하지 않는다 |
| Gemini 질문 4·choice 2–4 | schema 및 실제 choice validation; lophn은 7개 option도 보존해야 한다 |
| Hermes 질문 5·option 4·option 8,000자 | 질문/긴 option은 error, option 개수는 slice; lophn에서 silent truncation 금지 |
| OpenClaw 900초·30–3,600초 | tool default/clamp; lophn domain은 이를 명시적으로 버렸다 |
| Hermes 3,600초·timeout<=0 | 설정 default와 unlimited sentinel; lophn은 null 기한을 canonical로 저장 |

## lophn에 가져올 것과 버릴 것

| 요구 | 가져올 구현 방식 | 버릴 방식·이유 |
|---|---|---|
| lophn-agent/questions#R1 | 생성 전에 기존 답/근거 read, 한 결정의 prompt/options 구성 | LangChain review batch·Hermes 독립 질문 batch를 그대로 Question 하나로 저장하지 않음 |
| lophn-agent/questions#R2 | pending unique를 DB partial index와 command transaction으로 확정; session optional | OpenCode live map만으로 보장, Codex overwrite, OpenClaw 세션 slot을 run unique로 오인 |
| lophn-agent/questions#R3, R4 | label/description/추천 이유·선택 후 동작을 같은 immutable 값으로 표시; 선택과 명시 제출 분리 | 추천 첫 option preselection→자동 답, 배열 slice, 고정 option 개수 제한 |
| lophn-agent/questions#R5, R9 | created_seq 검증, 전제 변경은 원 질문 close+새 질문 | live UI 내용 overwrite; 오래된 tool result를 새로운 승인처럼 처리 |
| lophn-agent/questions#R6 | request ID와 typed answer command; pending/unknown/terminal typed errors | Hermes/OpenClaw next-message capture, Gemini empty submission을 답으로 수용 |
| lophn-agent/questions#R7, R8 | 저장된 absolute deadline, fake clock 경계, no-answer 별도 reason | timer 재시작으로 기한 연장, timeout 후 best-judgment continuation |
| lophn-agent/questions#R10 | 질문 저장·WaitRun 원자화; 답·적용 outcome·run resolution을 각각 read/recover | process-local promise를 기록의 정본으로 사용, 답 저장을 적용 성공으로 표시 |
| lophn-agent/questions#R11 | OpenClaw처럼 ordinary/secret route 분리; 모든 일반 blob/model write 앞 safe-input 판정 | isSecret mask만으로 안전하다고 주장; 평문을 저장 후 출력에서만 redaction |
| lophn-agent/questions#R12 | 별도 question/approval protocol와 tool 판단; 내부 reversible allowlist | LangChain edit/approve 범위를 OptionAction 권한으로 가져오기 |
| lophn-agent/questions#R13, R14 | 고정 input/hash/comparison/binding_hash; owner의 `(question, option_key)` unique; current scope/CAS 재검사 | respond/free text를 action으로 parse; model에게 적용 tool 권한 부여; 답을 CAS 실패 때 삭제 |
| lophn-agent/questions#R15 | 자유 답→같은 run의 정보 입력만; 동작은 새 고정 option 또는 사람 direct command | `옮겨 주세요`를 자연어 command로 자동 dispatch |
| lophn-agent/questions#R16 | option.adoption의 document/version과 Question ID를 handoff source에 구조화 참조 | 최신 문서 주소로 치환, 추천을 채택으로 기록 |

**[추측] 작업 분리.** question command/store, runtime wait recovery, owner action adapters, safe-input routing, UI confirmation evidence를 각각 구현하고 contract fixture로 묶는 편이 좋다. 단일 ask-user tool+promise부터 만든 뒤 persistence를 덧붙이면 answer/apply/resume 사이 crash boundary를 놓치기 쉽다. 이는 새 요구가 아니라 현 domain model의 구현 순서 추천이다.

### open-issues 후보

- **lophn-agent/questions#R11 — secret 판정 실패·safe-input 완료의 의미.** 비교 소스에서는 mask부터 별도 secretStore까지 보호 수준이 다르다. lophn은 일반 저장 금지를 명시하지만 이 concern만으로 detector unavailable·오탐·안전 입력 취소 시 Question이 pending으로 남는지까지 정할 수 없다. **추천:** platform/secrets·platform/redaction의 정본을 먼저 확인하고 unavailable은 fail-closed, 원문은 일반 blob/model에 쓰지 않는 fixture부터 둔다. 질문 상태를 임의로 answered로 바꾸지 않는다. 요구 변경이 필요한지는 미확인이다.
- **lophn-agent/questions#R3 — provider/UI bound mismatch.** lophn은 option 상한을 두지 않는데 여러 참고 tool이 2–4개로 제한한다. **추천:** lophn canonical Question을 native tool payload로 손실 변환하지 말고 own Question tool schema/UI를 사용한다. native provider tool을 강제해야 하는 adapter가 발견되면 그때 요구 충돌을 올린다. 현재 소스 비교만으로 요구가 비현실적이라고 결론내리지는 않는다.

`open-issues.md`나 intent는 이 조사에서 수정하지 않았다.

## 구현 메모

### 자료와 상태

- 정본은 `Question {id, run, session?, prompt_blob, reason_blob, options, recommendation?, expires_at?, status, answer?, created_seq, closed_seq?}`. options·추천·기한은 immutable; pending partial unique는 `run`이다.
- 상태: 생성→pending, 유효 explicit answer→answered, deadline 도달→expired, defer/cancel/전제 변경→cancelled. defer는 `closed_reason=deferred`이며 answer 없음이다. 화면 닫기·재시작은 상태 전이가 아니다.
- `OptionAction`은 `{concern, command, targets, input, input_hash, comparison, binding_hash}`. 등록 owner schema·CAS만 허용하며 reversible 내부 action 한 개다. 적용은 인증된 machine, 실제 event `actor=user/run=null`; agent command 권한이 아니다.
- answer 저장과 confirmation 증거 소비를 원자화하고, owner가 실제 적용 기록의 `(question, option_key)` unique를 제공한다. 자유 답/action 없는 option은 적용 command가 없다. answered 이후 CAS conflict도 답을 유지한다.
- 재개 순서: `QuestionCreated+ToolCall+WaitRun` 원자 확정→loop 반환·model/app call/lock 해제→사람 결정 저장→request/run read→고정 action이면 owner 적용 결과 확인→`ResolveRunWait(decision_seq)` unique resolution→같은 run 재개. 답 없음은 stopped/no_answer. 상세 runtime 정본은 `lophn-agent/harness/waiting-and-recovery`다.

### 기본값·오류

| 항목 | lophn 구현값 |
|---|---|
| expires_at | null; 값이 있으면 생성 시각보다 뒤, `now < expires_at`에서만 답 수용 |
| pending | run당 1; session 없음도 동일 |
| options | 0개 가능; 현재 고정 상한 없음; 순서/unique key 보존 |
| answer | nonblank text 하나 또는 유효 option key 하나; 둘 다/둘 다 없음 거절 |
| recommendation | 정보일 뿐 default answer/적용 아님 |
| invalid_input | blank·잘못된 key·action schema/hash/CAS shape 불일치 |
| forbidden | 현재 권한 없음·금지 action·confirmation evidence 불일치 |
| not_found | 질문/run/owner target 없음 |
| conflict | 둘째 pending·terminal 답·늦은 답·run 종료·created_seq/CAS mismatch |
| 정확한 replay | 공통 command idempotency 결과만 반환; 다른 답은 conflict |
| no-answer | applied 없음; expiry/defer/cancel 구분 기록 후 stopped/no_answer |

### 짧은 wire 예시

아래는 fixture용 논리 shape이며 public contract의 최종 필드 포장·인증 envelope를 새로 정하지 않는다.

```json
{"question":"qst_fixture","created_seq":21,"answer":{"kind":"option","option_key":"move","text_blob":null},"binding_hash":"<stored binding>","confirmation":"<consumable evidence>"}
```

일반 세션의 `동의합니다`는 이 command가 아니다. text answer는 `kind=text/text_blob`이며 action field를 model이 보완하지 않는다. 적용 input은 제출자의 새 JSON이 아니라 Question에 저장된 고정 action으로 읽는다.

### 테스트·fake provider fixture

테스트 이름은 요구 번호로 시작한다. 참고 프로젝트의 real-model retry 테스트와 달리 lophn 불변 조건은 DB/command fixture로 먼저 검사한다.

1. **questions#R1/R2:** fake provider가 두 독립 결정·parallel ask를 요청; 둘째 pending은 conflict. 세션 없는 Operator run도 같은 규칙·조회/명시 답 경로를 사용한다.
2. **questions#R3/R4:** 0개/7개 option, 설명·추천 이유 보존; option click만으로 answer/action 없음. recommended option이 선택·확정되지 않는다.
3. **questions#R5/R6/R9:** stale created_seq, unknown option, 빈 text/공백, 둘 이상의 선택, text+option 동시 제출, 일반 세션 `동의` 모두 변경 없음. 원 질문 내용 변경 대신 close+새 ID.
4. **questions#R7/R8:** fake clock으로 마감 1ms 전 수용, 마감 정확히/이후 conflict; 재시작 후 같은 expires_at; null 기한은 시간 경과만으로 닫히지 않음. defer/cancel/expiry마다 답·기본 적용 없음, run stopped/no_answer.
5. **questions#R10/R13:** 답 commit 전/뒤·owner dispatch 전/뒤·run resume 전 crash. restart는 ledger를 read하고 답 접수와 적용 완료를 구분한다. 같은 command/re-delivery로 owner 적용 1번, run wait resolution 1번.
6. **questions#R13/R14:** 선택 뒤 현재 scope 변경·대상 없음·CAS 판 변경. 답은 answered로 보존, action 미적용+이유를 전달하고 옛 binding으로 새 입력을 적용하지 않음.
7. **questions#R11/R12:** secret처럼 보이는 자유 답·detector unavailable·safe-input cancel은 일반 blob/history/event/model fixture에 원문 없음. 질문 option으로 외부 전송/권한 부여를 넣으면 생성 거절.
8. **questions#R15/R16:** `다른 자리로 옮겨 주세요` 자유 답→정보만; model의 자동 dispatch 시도 차단. 채택 version 후 최신 version 생성→기존 Question·handoff가 원 version 유지.

### 미확인 범위

LangGraph의 외부 durable checkpointer 구현, Codex pending의 process restart 복원·전체 secret sink, Gemini scheduler의 durable dialog 복구, Hermes gateway caller의 prose steering 분기, 각 UI가 annotation bound를 추가 강제하는 모든 경로는 이번 소스 범위에서 확인하지 않았다. 확인한 in-memory 저장을 전체 시스템의 모든 저장이라고 표현하지 않는다.
