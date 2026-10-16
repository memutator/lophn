# agent call와 run-loop 입력 구현 목록 (2026-10-15)

기준 코드: main `acfe4cc3`. 본 설계: `tmp/specs/agent-call.md`(S3) 전부, `products/AGENT-ROLE.md` 3~5장, S1(`event.md`)의 Router와 8장 call 표시, S4(`agent-definition.md`) 3장 session 목록 tool과 6장 입력 꼴, S6(`coding-agent.md`) 2장 2와 5장 2의 앱별 줄, S8(`place-session.md`) 3장. 요구 req-1490, 1491, 1494, 1499~1506, 1509, 1516. docs-review의 "S3" 절(핑퐁 두 번)과 2026-10-15 steer 결정.

코드를 읽고 안 사실 몇 가지(아래 항목의 바탕).
- 지금 코드에는 Router도 call도 없다. agent끼리 부르는 길은 `handoff.submit` 하나이고, run을 `assignment`에 접수하는 `AcceptRun`(`run-loop/commands.ts`)이 입구다.
- handoff는 받는 쪽의 session을 열지 않는다. `session: null`인 run을 assignment에 접수한다. 그래서 받는 쪽 대화가 화면에 없고, 받는 run의 place는 보낸 run을 따라 거슬러 올라가 정한다(`agents/layers.ts`의 `placeOfRun`).
- 도는 turn에 사람 메시지를 넣는 길은 이미 있다. 메시지 `mode`가 `correction`이면 도는 run에, `request`면 새 run에 접수된다(`session/message-commands.ts`, `run-loop/core-ports.ts`의 `inputs()`가 매 model call 전에 미반영 correction을 읽는다). 새 설계의 steer가 이것이고, 이름·표시·기본이 다르다. 기본은 이미 다음 turn이다(composer `drafts.ts` 기본 `mode: "request"`).
- coding agent는 지금 사용자가 shell에서 눌러 띄운다(`coding-agent/cli/commands/session.ts`의 `session plan`). App Engineer가 call로 맡기는 길도, coding agent의 CLI 메시지(req-1491)도 없다(`ticket claim/renew/release/report`만 있음).
- tool 자동 재시도는 `run-loop/retry.ts`의 `toolMayRetry`이고, 재시도 키는 `tools/bundles/common.ts`의 `toolIdempotencyKey`(첫 ToolCall ID)다. 지금 handoff의 `dedup_key`는 모델이 정하는 문자열이다.

## 덜어낼 것

| 항목 | 근거 | 지금 코드 | 비고 |
|---|---|---|---|
| handoff tool 폴더 전체: `SubmitHandoff` command 래퍼, 읽기 둘, 내용 blob 준비 | S3 10장 "지울 옛 것", changes.md 2장 agent call 줄 | `packages/core/lophn-agent/tools/handoff/{mod,model,commands,reads,body}.ts` | 고정 방향 표 검사, 사람 요청 계보 검사, 문서 판 근거 검사가 들어 있다. call은 새로 짓는다("새로 만들 것"). `sameHandoff`의 같은 key면 첫 결과를 돌려주는 생각만 dedup으로 이어진다 |
| handoff 시험 | AGENTS.md 호환성("틀린 옛 test는 지우고 다시 쓴다") | `tools/handoff/flow_test.ts`(1215줄), `tools/handoff/handoff_test.ts`(364줄), `protocol/lophn-agent/handoffs_test.ts` | |
| handoff protocol route 셋(`SubmitHandoff`, `ReadHandoffStatus`, `ReadHandoffResult`)과 registry 등록 | S3 10장 | `packages/protocol/lophn-agent/handoffs.ts`, `registry.ts`(5, 33행), `mod.ts`(14행). `core/lophn-agent/register.ts`(129~132, 432~445, 941, 992~993, 1191~1192행)에서 건다 | |
| 고정 방향 표 `HANDOFF_DIRECTIONS`, `handoffAllowed` | S3 10장 "고정 방향 표(Operator 금지)", AGENT-ROLE 7장 "누가 누구를 부를 수 있는지를 고정 표로 두지 않는다" | `protocol/lophn-agent/decision-values.ts`(71~84행). 쓰는 곳: `handoffs.ts`, `run-loop/commands.ts`(252~254행 "operators take no handoff"), `roles/app-engineer/interview.ts`(95행) | 부를 수 있는지는 agent grant(S2)가 정한다 |
| 칸 넷 내용 `handoffContentSchema`(무엇, 왜, 제외, 기대 결과) | S3 10장 "칸 넷", 새 봉투는 `body` 하나와 `refs` | `decision-values.ts`(86~93행). `tools/bundles/agent.ts`(114~123행), `run-loop/core-ports.ts`(174~186, 245~260행 `handoffRequestText`) | |
| 문서 판 고정 근거 `HandoffReference`(document, version, section, question)와 검사 `checkReferences`, `adoptionOf` | S3 10장 "문서 고정 판 근거", removed.md 문서 판 | `protocol/lophn-agent/run-values.ts`(29~39행), `tools/handoff/model.ts` | `adoptionOf`는 `core/apps/tickets/ports.ts`(3행)도 쓴다. ticket의 채택 질문 검사가 어떻게 되는지는 tickets 쪽이 정한다("다른 영역에 넘긴 것") |
| handoff 내용 blob 한 벌: blob field 등록, 준비기, run 읽기 종류 `handoff_content` | 같은 이유(봉투 `body`는 받는 session 기록에 둔다) | `HANDOFF_BODY_*`와 `handoffBodyFields`(`register.ts` 1013행), `tools/handoff/body.ts`, `core/main/daemon/core.ts`(351~353, 1324~1360행), `protocol/lophn-agent/run-reads.ts`(93~108행), `waiting-and-recovery/reads.ts`(51~56행) | |
| run 출처 `handoff` 가지와 그 열·제약·index | S3 10장 "run 단위 → call 봉투", S1 12장 "run 출처 `message`, `handoff` → Router 입력의 보낸 쪽" | `protocol/lophn-agent/run-values.ts`(46~68행), `run-loop/schema.ts`(`source_sender_run`, `source_original_message`, `source_dedup_key`, `runs_source_handoff`, `runs_original_message`, `runs_sender`), `run-loop/model.ts`(131~133행), `run-loop/commands.ts`(251~275행 보낸 run 계보 검사), `register.ts`(548~566행), `tool-judgment/model.ts`(19행 `Origin`), `tool-judgment/work.ts`(140행) | 개발 데이터는 지우고 새로 만든다. `message` 가지는 "고칠 것" |
| "사람 요청에서 이어진 run만 보낼 수 있다"는 검사 | S3 10장, req-1490 (보내는 곳 제한 없음) | `tools/handoff/model.ts`의 `humanOrigin`, `tools/bundles/agent.ts`(376~384행), `tools/toolkit.ts`(98~108행 `runFacts`의 `original_message`) | 보낸 쪽은 program(reaction)이나 사람 요청 밖의 session도 될 수 있다 |
| session 없는 run과 assignment 단위 줄 | S3 2장 "새 session", S1 3장 Router | `run-loop/schema.ts`(`runs_active_assignment`), `run-loop/work.ts`(`queueKeyOf`의 `assignment:` 가지), `agents/layers.ts`(48, 64~100행 `MAX_HANDOFF_DEPTH`로 보낸 run의 place를 따라감) | call은 늘 session에 들어간다. 새 session의 place는 `to`가 정한다 |
| agent tool `handoff.submit`, `handoff.read_status`, `handoff.read_result` | S3 8장, S4 9장 "`handoff.*` → call, reply, cancel" | `tools/bundles/agent.ts`(111~213, 345~402행), `agents/role-caps.ts`(118~120, 154~156, 177~179행), `tool-judgment/builtin-binding.ts`(155행), `tools/agent_tools_test.ts` | |
| tool `run.read_result` | 결과는 reply 입력으로 돌아온다(req-1499). 결과를 폴링하는 tool은 필요 없다 | `tools/bundles/agent.ts`(`runReadResultTool`, 107, 130, 348행), `role-caps.ts`(113, 147, 173행) | S4 목록에서 따로 지우는지 맞춰 본다. 지금은 handoff 결과를 읽는 쪽이 주 쓰임이라 같이 둔다 |
| handoff 근거로 App Engineer가 앱 밖 문서를 읽는 예외 | 문서 판이 없어졌다(removed.md 1장) | `run-loop/agent-credentials.ts`(29~70행 `agentConditions`의 `evidence`), `protocol/server/identity.ts`(53행), `core/storage/ledger/target-authorization.ts`(37행), `core/projects/outline-and-search/outline-support.ts`(102행), `roles/app-engineer/scope.ts`(`handoff_evidence`) | `agentConditions`가 `source.references`를 받는 인자도 같이 빠진다 |
| handoff 자료 봉투 `handoffEnvelope` | 입력 꼴은 `<lophn-call>`(S4 6장)로 정한다 | `core/supervision/security/data-summary.ts`(17~19행), `security/mod.ts`(22행), `data_envelope_test.ts` | `summaryEnvelope`, `compactedEnvelope`는 compact가 쓰므로 남는다 |
| role 코드 안의 handoff 초안 함수 | S4 4장 기준 4 "일의 흐름은 tool로 만들지 않는다. 지침과 skill이 엮는다" | `roles/app-engineer/interview.ts`(`routeDecision`, 74~115행과 `decisionOwner`), `roles/context-engineer/report.ts`(`conflictHandoff`, 24~55행), `roles/lophn/app-plan.ts`(`NewAppHandoff`, `newAppHandoffReady`, `NO_ASSIGNMENT_WORD`, 120~140행), `roles/lophn/plan.ts`(`NO_HANDOFF_WORD`)와 각 test | Context Engineer → Project Manager 바꿈, role 지침 정리와 겹칠 수 있어 agent definition 목록과 맞춰 본다 |
| 시험용 handoff 흔적 | 위 코드가 없어진다 | `core/testing/lophn-agent-runs_test.ts`, `question-world.ts`, `tool-judgment-world.ts`, `assignment-state.ts`, `run-loop/run_test.ts`, `selector_test.ts`, `tool-judgment/flow_test.ts`, `judgment_test.ts`, `roles/*_test.ts`, `observability/*_test.ts`, `usage/usage_test.ts`, `prompt-assembly/summary_test.ts` 등(handoff 낱말이 든 test 약 30개) | 지우거나 call 설계에 맞춰 다시 쓴다(옮겨 고치지 않는다) |

## 고칠 것

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| run 접수 입구 `AcceptRun` | 출처 `message`와 `handoff` 둘을 받는 command → Router 한 입구. 사람 메시지, call, reply, reaction, coding agent 메시지가 같은 입구로 들어오고 봉투(`from`, `to`, `reply`, `body`, `refs`, `reply_to`, `dedup`)가 붙는다 | S1 3장 Router "일부(run 출처 `message`, `handoff`)", S3 2·3장, changes-by-topic harness/run-loop 줄 | `run-loop/commands.ts`(216~340행), `protocol/lophn-agent/runs.ts`, `run-values.ts` |
| 사람 메시지 접수 | `ReceiveMessage`가 run까지 한 transaction에서 접수 → Router(보낸 쪽 사람)를 거친다. 봉투는 metadata로만 두고 본문은 평문 그대로 | S3 5장 "사람의 메시지는 봉투만 쓴다", S4 6장 "사람 메시지(turn 시작) 평문" | `session/message-commands.ts`(`receiveWith`), `session/commands.ts` |
| `mode: correction` → steer, `mode: request` → 기본 | 이름과 뜻을 steer로 바꾼다. 기본(다음 turn)은 이미 그렇게 동작하니 `request`를 값으로 둘 이유가 없는지 정한다. 도는 turn에 넣는 동작(다음 model 요청 앞에 붙이고 끝내기를 막음)은 유지. `MessageReceived`가 turn 안에서 여러 번 난다 | req-1509, S1 6장, S4 6장 "사람 메시지(steer)" | `protocol/lophn-agent/messages.ts`(14, 45~65, 102~105, 265~268행), `session/message-commands.ts`(209~230행), `session/model.ts`(`hasUnappliedSteering`, 417행), `run-loop/commands.ts`(69, 544행), `run-loop/core-ports.ts`(261~279행), `session/session-title.ts`, `session/rewind/checkpoints.ts`(9~25행) 외 `waiting-and-recovery/{work,recovery-work,commands}.ts` |
| steer 본문 감싸기 | 반영할 때 평문 text를 이력에 붙임 → `<lophn-steer>`로 감싸 사람이 직접 보낸 것임을 밝힌다. 이 모양만 믿는다는 규칙은 built-in 지침에 둔다 | S4 5장, 6장 입력 꼴 | `prompt-assembly/layers.ts`(110~113행), `run-loop/turn.ts`(581~585행), `run-loop/ports.ts`(39~43행) |
| 입력 본문 만드는 곳 | run 출처가 `message`/`handoff`일 때만 요청 글을 읽음 → 입력 종류(사람, call, reply, reaction, coding agent 메시지, notice)마다 6장 꼴로 만든다. `[machine] ...` 평문 알림은 `<lophn-notice kind="…">`로 | S4 6장 | `run-loop/core-ports.ts`(`inputs()`, 237~280행), `run-loop/turn.ts`(`[machine]` 문구), `waiting-and-recovery/work.ts`(57행) |
| 자료 분류와 tag escape | `DATA_START_MARKER` 방식의 data 감싸기(`PromptSourceKind`) → `lophn-` tag 방식. 본문 안의 닫는 tag escape와 속성 값 scrub 규칙은 `countUnescapedMarkers` 쪽 생각을 가져간다 | S4 6장 입력 꼴 첫 두 줄, 11장 5 | `safety/fence.ts`(120~160행), `safety/model.ts` |
| 사람의 단추 한 번으로 새 session 열기 | 역할의 enabled assignment 하나를 찾아 session, message, run을 접수 → Router call(보낸 쪽 사람, `to` 새 session의 role과 place, `reply: none`) | S1 8장 반응 표(누르면 그 위반을 붙여 Project Manager를 부름), S3 2장 | `session/request.ts`(`startRequest`, `receiverOf`) |
| 새 session 열기 | `OpenSession`이 assignment ID를 받음 → Router가 role과 place로 받을 agent를 골라 연다 | S3 4장, S8 2장 | `protocol/lophn-agent/sessions.ts`(`openSession`), `session/commands.ts`(169행) |
| session archive·지움·닫기가 열린 call에 미치는 영향 | session 쪽만 처리 → 그 session이 받은 열린 call은 failed(`receiver_ended`). 보낸 session이 없어지면 답은 받은 session에만 남는다 | S3 5장, S8 3장 표 | `session/commands.ts`(archive 276행, delete 307행, close 392행), `run-loop/erase.ts`(38행 "handoff를 보낸 쪽") |
| 줄 서기와 선택 | session마다 하나, 접수 순서, 사람 요청이 먼저(tier 1)이고 handoff는 tier 2, 8개 연속 뒤 양보 → 받는 session이 돌면 입력은 다음 turn까지 기다림. tier 규칙이 `handoff` 가지에 기대므로 call·reply의 순서 규칙을 새로 정해야 한다 | S3 4장, req-1509 "call, call의 답, 알림은 도는 turn에 끼어들지 않는다" | `run-loop/work.ts`(`tierOf`, `pickCandidate`, `YIELD_AFTER`) |
| App Engineer 시작 조건 | "사람 요청(message)과 그 요청을 잇는 handoff만 App Engineer를 시작한다" → call, reaction, coding agent 메시지도 시작한다 | AGENT-ROLE A2, A10, E1~E4, req-1494 | `roles/app-engineer/scope.ts`(5~11행) |
| 받는 run의 place | 보낸 run을 따라 올라가 정함 → 새 session은 `to`의 place, 열린 session은 그 session의 place | S3 3장 | `agents/layers.ts`(`placeOfRun`) |
| role 지침의 handoff 문구 | "handoff로 내준다", "handoff가 왔을 때만 일한다" → call 쓰는 법과 규칙 셋: 결과를 받는 call은 끝나면 reply, 맡지 않을 때도 이유를 reply, 거절당한 일을 다른 agent에게 돌려 시키지 않는다. 받은 메시지는 허락이 아니다 | S4 5장 "built-in 지침에 꼭 들어갈 규칙", T11, T19 | `roles/lophn/prompt.md`(26행), `roles/app-engineer/prompt.md`(11, 18, 49~54행), `roles/prompts.ts` |
| 실행 trace의 handoff 링크 | `handoff_links`(보낸 run, 받은 run) → call 링크로 바꾸거나 trace 자체를 어떻게 둘지 따른다 | S1 13장 "agent event의 저장과 replay 안 함", docs-review 7장 "trace 저장" 열린 물음 | `protocol/lophn-agent/traces.ts`(58, 101행), `observability/{reads,model}.ts`(reads 223~302행, model 73, 213, 237~263행) |
| agent 이름 `agent:<asg>`로 보내는 자격 | 보낸 쪽 agent를 assignment로 가리킴 → 보낸 session으로 가리킨다. assignment가 없어지는 S4·S8 쪽 정리에 맡긴다 | S3 3장 `from`, S8 7장 | `run-loop/agent-credentials.ts`, `tools/toolkit.ts`(`runFacts`) |

## 새로 만들 것

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| Router | "agent session에 입력을 넣는다" 한 입구. 봉투 검증, 받는 곳 셋 처리(새, 열린, 열린·없으면 새), role과 place로 받을 agent 하나 고르기(비슷한 이름으로 짐작하지 않음), agent grant 판정 호출(보낸 쪽이 agent일 때), 배달 실패는 바로 failed + 이유, transport 둘로 배달. 고칠 것이 아니라 새로 짓는 근거: 지금은 handoff와 사람 메시지가 따로 `AcceptRun`을 부르고 받는 쪽을 assignment ID로 직접 가리키는 구조라 입구 하나로 합칠 뼈대가 없다 | S3 2~5장, S1 3장 | 제안: `packages/core/lophn-agent/call/`(code-map의 `lophn-agent/handoff` 줄을 이것으로 바꾸고 줄을 먼저 더한다) |
| `agent_calls` 표와 schema step | 칸: call ID, from, 받는 session, reply, 상태, dedup, 시각. 행은 agent가 보낸 call에만 둔다(사람 메시지와 program reaction은 행 없음). 받는 session은 줄에 서 있는 coding call에서는 비어 있을 수 있다 | S3 5장 | `lophn-agent/call/schema.ts` |
| 상태 전이 | accepted → done / failed / cancelled. `sent`, `declined` 없음. 끝난 call은 다시 열지 않는다. 닫힌 call에 온 답이나 메시지는 `closed` 이유로 돌려준다 | S3 5장 | `lophn-agent/call/` |
| 실패 이유 | `not_found`, `not_allowed`, `closed`, `receiver_ended`. 이유를 붙여 보낸 session에 새 입력으로 돌려준다(`<lophn-reply status reason>`). 답을 받지 않는 call도 배달 실패는 돌려준다 | req-1501, S3 5장 | `lophn-agent/call/` |
| dedup | (보낸 session, tool call ID)가 같으면 두 번째 call은 첫 call ID를 돌려주고 call과 session을 더 만들지 않는다. 키는 `toolIdempotencyKey`(첫 ToolCall ID)를 쓰고 모델이 정하는 문자열은 없앤다 | req-1504, S3 11장 3 | unique 제약을 `agent_calls`에 |
| call tool | 봉투를 만들어 Router에 넣고 call ID를 바로 돌려준다. 보낸 agent의 turn은 이어 간다. 효과는 read로 Gate의 agent 대상. 입력은 `to`(셋 중 하나), `reply`, `body`, `refs` | req-1499, S3 8장 | `packages/core/lophn-agent/tools/bundles/`에 새 묶음, `role-caps.ts`에서 모든 role에 |
| reply tool | `reply_to`에 답이나 대화 메시지를 보낸다. 맡지 않을 때도 이유를 reply로 보낸다(별도 tool과 상태 없음). 취소된 call이면 `closed` | req-1502, S3 8장 | 위와 같음 |
| cancel tool | 자기가 보낸 끝나지 않은 call을 취소한다. 받은 session에 취소 입력(notice)이 간다. coding call이면 줄에서 빼거나 session을 멈추고 token을 회수한다(S6) | req-1503, S3 5장, S6 2장 3 | 위와 같음 |
| 사람이 취소하는 command | req-1503 "보낸 쪽이나 사람은 취소할 수 있다"에서 사람 쪽 | req-1503 | `lophn-agent/call/` command, protocol route |
| session 목록 tool | 보낼 수 있는 열린 session을 돌려준다: ID, role, place, 이름, 상태. agent grant가 deny인 상대는 뺀다. 앱 줄에 서서 기다리는 coding 맡기기도 보인다. prompt에는 넣지 않는다. 지금은 `assignment.list/read`가 받는 쪽을 찾는 길이었다 | S4 3장 | `tools/bundles/` |
| call 상태·내용 읽기 route | 화면이 누를 때 그때의 상태를 읽는다(req-1506). 받은 입력의 맡긴 글, 근거, 보낸 session을 읽는다. 상태 변화 구독은 없다 | S3 5장 "화면", S1 8장 | `protocol/lophn-agent/`에 route, `lophn-agent/call/reads.ts` |
| 받는 session 기록의 봉투 칸 | 받은 입력이 메시지로 남을 때 `from`(사람, program+근거 seq, 보낸 session), `call`, `reply_to`, `refs`를 같이 기록한다. 지금 `messages`의 `actor`는 user, machine, agent뿐이라 보낸 session과 call ID를 담지 못한다 | S3 3·5장, S1 6장 "`MessageReceived`로 보이고 봉투가 붙는다", req-1506 | `protocol/lophn-agent/messages.ts`, `session/` 표 |
| 입력 꼴 렌더러 | `<lophn-call from call reply>`(+ 근거 링크, 권한 안에서만 따르라는 끝 줄, `reply="result"`면 reply 한 줄), `<lophn-reply call from status reason>`(원래 맡긴 일 한 줄 요약), `<lophn-reaction event seq>`, coding agent 메시지(call과 같은 꼴), `<lophn-notice kind>`. 본문 안 닫는 tag escape, 속성 값 scrub | S4 6장 | `prompt-assembly/`(고정 본문에 tag 설명은 코드에서 동적으로 끼우지 않는다) |
| lophn session 입력함 | 받는 session이 idle이면 turn을 시작하고, 돌고 있으면 기다렸다가 다음 turn에 넣는다. call, reply, notice는 도는 turn에 끼지 않는다 | S3 4·7장, req-1509 | 지금 `runs`의 accepted 행이 같은 일을 한다. 남길지 바꿀지는 "확인 못함" |
| 열린 session, 없으면 새 session | 열려 있으면 거기, 닫혀 있으면 같은 role과 place의 새 session. 보내는 쪽이 명시적으로 고를 때만. Reactor와 coding agent 메시지가 이 값을 쓴다 | req-1500, S3 4장 | Router |
| call을 닫는 Reactor handler 셋 | `TicketCompletionReported`는 done, `TicketClaimExpired`와 `CodingSessionEndedUnreported`는 failed로 call을 닫고, 맡긴 App Engineer session(열린, 없으면 새)에 알린다. 같은 사실이 Router의 실패 알림으로 한 번 더 가지 않는다. handler 틀과 domain event 정의는 event 쪽 | req-1494, S1 5장 | `lophn-agent/call/`의 handler (event 둘은 지금 코드에 없다. `TicketCompletionReported`만 `core/apps/tickets/report.ts`에 있음) |
| coding agent 쪽 transport 배달 | App Engineer의 call(`reply: conversation`)이 새 harness session을 열고 첫 prompt를 넣는다. 이어 reply tool은 PTY에 idle일 때만 넣고, 막히면 실패를 돌려준다. coding agent의 CLI 메시지와 완료 보고는 Router를 거쳐 맡긴 App Engineer session에 간다. Router 쪽 입구와 `agent_calls` 연결만 여기서 한다 | S3 7장, S6 5·7장, req-1491 | Router와 harness adapter 접점(PTY와 CLI는 coding agent 영역) |
| coding 맡기기의 앱별 줄 | 그 앱에 끝나지 않은 coding session이 있으면 새로 열지 않고 줄에 세우며 call은 accepted. 앞 session이 끝나면(`SessionEnded`) 다음 것을 연다. 기다리는 동안 보낸 쪽은 cancel. 실패 이유 `busy`는 두지 않는다 | req-1516, S3 5장, S6 2장 2·5장 2 | Router |
| 시험 | 상태 전이와 실패 이유별 시험, dedup 재시도 시험, 받는 곳 셋 시험, 취소 뒤 늦은 답 시험, 입력 꼴 escape 시험, 두 transport 시험. flow E2E 하나(Operator → App Engineer call 왕복) | AGENTS.md 코드 | `lophn-agent/call/*_test.ts`, `e2e/flows/` |
| code-map 갱신 | call 위치를 module 표에 적는다 | `../../dev/code-map.md` 1장 | `../../dev/code-map.md` |

## UI 덜어낼 것

| 항목 | 근거 | 지금 코드 | 비고 |
|---|---|---|---|
| 문구 `roles.label.origin-handoff` "Handed over by another role" | handoff 개념이 없어진다. 쓰는 곳이 shell renderer에 없다(grep 확인) | `packages/design/wording/en.ts`(2224행), `placeholders.ts`(2289행) | 죽은 문구 |

## UI 고칠 것

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| 보내기 방식 이름 | `SendMode = "request" \| "correction"`, 보낼 때 `mode`와 대상 `run` ID를 보냄 → 기본(다음 turn)과 steer. steer의 대상은 turn이 아닌 지금 도는 것이라 `run` 칸 의미도 정한다 | req-1509, S3 11장 6 | `conversation/delivery-state.ts`(8, 15~20행), `drafts.ts`(13, 25행), `agent-view.tsx`(225~238, 285~296행), `agent-thread.tsx`(107~164행), `agent-source.ts`(91, 243, 252행), `agent-core-source.ts`(221행), `agent-core-source-values.ts`(41행), `agent-core-source-thread.ts`(514행) |
| composer 선택 문구 | "Change this work" / "Next request" → steer / 기본으로 문구를 바꾼다. 도는 중에만 선택이 나타나고 쉬는 중에는 늘 새 turn으로 보내는 동작은 유지 | req-1509 | `conversation/composer/agent-composer.tsx`(67~77, 180~215행), `design/wording/en.ts`(1094~1095, 1147~1150, 1214~1216행), `placeholders.ts` |
| 내 말 옆 "Change" 표시 | 보낸 메시지 옆 tag "Change" → steer 표시 | 같음 | `message-list/message-body.tsx`(101~118행), `en.ts`(1150행) |
| rewind 안내 | steer 메시지는 checkpoint가 아니라 rewind에서 메시지만 복원된다는 문구 이름 | S1 6장 | `conversation/rewind/text.ts`(72행), `agent-core-source-rewind.ts`(252행), `en.ts`(1343행) |
| 도는 중 보내기 단추 | 도는 중에는 Send 단추 대신 Stop이 있고 Enter로만 보낸다 → 기본 다음 turn으로 보내는 동작과 steer 선택이 눈에 보이는 모양인지 정한다(지금 모양이 이미 맞을 수 있다, 확인 못함) | req-1509 | `agent-composer.tsx`(180~215행) |
| 대화 줄의 actor 구별 | actor가 user, machine, agent 셋 → 다른 session·program·coding agent가 보낸 입력도 구별해 그린다 | req-1506, S1 8장 | `conversation/agent-thread.tsx`(140~210행), `agent-core-source-thread.ts` |

## UI 새로 만들 것

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| 받은 session 메시지의 보낸 쪽 chip | call, reply, reaction, coding agent 메시지가 들어온 메시지에 보낸 쪽(agent role과 이름, 또는 program과 사건, 또는 coding agent)을 chip으로 붙인다 | req-1506, S3 5장 "화면" | `conversation/message-list/`, `agent-thread.tsx` |
| chip을 누르면 읽는 패널 | 맡긴 글, 근거 링크(ticket, problem, 파일 경로), 보낸 session 링크(눌러 그 session 탭을 연다)를 call 읽기 route로 읽어 보인다 | req-1506 | 위 옆, 읽기 source는 `agent-core-source*.ts` |
| 보낸 session의 call 블록 | 지금은 일반 tool 한 줄(`activity/tool-line.tsx`의 label과 하위 줄)로 보임 → call 전용 블록: 받는 곳, 맡긴 글 한 줄, 답 방식. 누르면 그때의 상태(accepted, done, failed + 이유, cancelled)를 읽어 보인다. 상태가 바뀌어도 따로 알리지 않는다 | req-1506, S3 5장, S1 8장 | `conversation/activity/` |
| 답과 실패 메시지의 이어 붙임 | 보낸 session에서 답과 실패가 그 call에 이어진 새 메시지로 보이게 `reply_to`로 묶는다 | req-1506 | `message-list/turns.tsx` |
| call 취소 단추 | 끝나지 않은 call을 사람이 취소한다(req-1503). 위치는 call 블록의 상세 안이 자연스럽다(제안) | req-1503 | call 블록 |
| 문구 | 위 컴포넌트의 문구와 상태 이름. 화면에는 `call`, `accepted` 같은 안쪽 낱말을 그대로 내지 않는다는 규칙(`wording/rules.ts`)을 따른다 | `design/wording/rules.ts` | `design/wording/en.ts` |

## 문서끼리 어긋난 것

- S3 8장은 "이름과 입력 schema는 S4에서 정한다"고 하는데, S4 3장은 call, reply, cancel의 이름과 한 줄 설명만 있고 입력 schema가 없다. `to` 세 가지의 모양, 새 session을 role과 place로 가리킬 때 모델이 place를 어떻게 적는지(project 이름? 앱 이름?), `refs`의 종류와 모양, reply의 필드가 어느 문서에도 없다. S3 3장 `refs`는 "ticket, problem, 파일 경로, 보낸 session"만 말한다.
- S3 5장 `agent_calls` 칸에는 실패 이유와 받는 곳(`to`의 role과 place)이 없는데, 화면은 눌렀을 때 상태와 실패 이유를 읽어야 하고(req-1506, 1501) "열린 session, 없으면 새 session"은 닫힘을 가린 뒤 role과 place가 필요하다. 어디에 두는지 한 줄 정해야 한다.
- AGENT-ROLE 곳곳의 링크가 낡았다: R1은 `../tmp/architecture/agent-call.md`, T1은 `../tmp/architecture/event.md` 2장, T19는 "agent-call.md 8장", T6은 `../tmp/architecture/approval.md`를 정본처럼 가리킨다. S1·S3·S2가 확인됨이 되며 설계 문서가 "옮겨 감"으로 바뀌었으니 spec 장 번호로 고쳐야 한다. 특히 T19는 spec에서 S3 6장·S4 5장이다.
- S3 5장 "닫힌 call에 온 답이나 메시지는 `closed` 이유와 함께 보낸 쪽에 돌아간다"의 "보낸 쪽"이 늦게 답한 쪽(받은 agent)인지 call을 보낸 쪽인지 읽기 나름이다. req-1503은 "받은 쪽에 돌아간다", AGENT-ROLE T18은 "닫힘으로 돌아간다"이다. 늦게 보낸 쪽에 reply tool의 결과로 돌려주는 것이 맞아 보인다(제안).
- changes.md 2장 agent call 줄은 "session 단위"로 쓰고 "결과가 보낸 쪽을 깨우지 않음"이 옛 모델이라 한다. 맞지만 같은 줄이 "grant 판정"을 새로 짓는 것의 일부로 적어서 Gate 목록(02)과 겹친다. call 쪽 책임은 Router가 Gate를 부르는 지점까지다.
- changes.md 4장 lophn-agent 줄 "바꾸면 다음 run부터"는 S4 2장 결정(run = turn, "다음 turn부터")과 어긋난다. 코드의 `runs` 표·`Run*` 이름은 아직 run이다. 이름을 turn으로 바꿀지는 refactor 몫인데 S1 12장 "ledger에 쓰는 `Run*` event를 지운다"와 함께 정해야 한다.
- S1 5장 "call 닫음의 반응"은 "handler가 맡긴 session으로 call을 보내고 그 call의 상태를 닫는다"인데, 어느 call이 두 가지(새 call과 닫히는 원래 call)인지 문장에서 갈린다. 코드로 옮길 때 `agent_calls` 행이 둘이 되는지(program이 보낸 call은 행 없음) 한 줄 확인이 필요하다. S3 5장은 "program의 reaction은 행을 두지 않는다"이므로 원래 call 한 행만 닫는 것으로 읽었다.
- AGENT-ROLE 5.2 표가 "받는 agent 고르기"를 role별 기호(같음, 앱, prj, 이름)로 정하는데, S3 3장은 `to`가 role과 place이고 "받는 이름은 정확히 맞아야 한다. 짐작하지 않는다"이다. 표는 보내는 agent가 무엇을 적는지의 지침이고 Router는 표를 코드로 갖지 않는다는 해석으로 구현 목록을 썼다(Router에 role 짝 표를 두지 않는다). 둘이 같은 뜻인지 문서에 한 줄 필요하다.

## 다른 영역에 넘긴 것

- Gate와 agent grant 판정(02): `tool-judgment/*`(`builtin-binding.ts`의 `handoff.submit` 줄은 위에서 지움), 승인 계보 "handoff 계보에서 사람이 거절한 같은 동작은 다시 묻지 않음"(`core/approvals/commands.ts` 264, 315행, `approvals/lineage.ts`, `lineage_test.ts`)은 새 설계에서 어떻게 되는지 02가 정한다.
- 사람에게 묻는 tool(04): 질문 대기 중 온 사람 메시지가 기다림을 끝내고 tool 결과가 되는 흐름(`waiting-and-recovery/commands.ts` 700~735행의 옛 질문 취소 + correction), `QuestionAsked`·`QuestionResolved`.
- coding agent transport(06): PTY 입력(idle일 때만), hook, token, CLI `hook` 명령, coding agent의 CLI 메시지 command(지금 `cli/commands/ticket.ts`에 없음), App Engineer가 harness를 띄우는 길(지금은 shell에서 사용자가 `session plan`으로 띄움), turn 끝 신호 없는 harness의 첫 prompt만 규칙.
- domain event와 Reactor(01): `TicketClaimExpired`, `CodingSessionEndedUnreported` 정의, reaction grant를 보고 Router에 call을 넣는 handler 틀, `assignments/reaction*.ts`(AppCreated → App Engineer assignment 만들기)의 앱 등록 때 생기는 방식, `ContextViolationFound` 반응과 toast에서 눌러 Project Manager 부르기.
- 위반 넘기기 한 벌(01): `core/projects/contexts/handoff.ts`, `api/commands-violations.ts`의 `handOffViolations`, `protocol/projects/context-api.ts`의 `violationsHandOff*`, shell `workspace/contexts/context-violations.tsx`, `core-source.ts`. 이 길은 위에서 `session/request.ts`를 Router로 옮기면 그 위에서 호출 지점만 바뀐다.
- assignment 상태 machine과 role 이름 바뀜(S4·S8 목록): `assignments/*`, `agents/role-caps.ts` 전체, `roles/context-engineer` → Project Manager. 여기서는 handoff가 걸린 줄만 다뤘다.
- ticket의 채택 질문 검사(tickets 쪽): `core/apps/tickets/ports.ts`가 `tools/handoff`의 `adoptionOf`를 import한다. handoff 폴더를 지우기 전에 이 의존을 끊어야 한다.
- session rewind(08): steer를 checkpoint에서 어떻게 보이는지, call로 열린 session에서 checkpoint가 되는 첫 입력이 무엇인지(`session/rewind/checkpoints.ts`는 사람 `request` 메시지만 checkpoint).
- 재시작 복구(event 쪽): 돌던 turn을 interrupted로 닫는 새 규칙과 `waiting-and-recovery/recovery*.ts`의 이어 가기. 입력함의 대기 입력이 재시작에서 어떻게 되는지는 아래 "확인 못함".

## 확인 못함

- `runs` 표(accepted, running, waiting_user, finished, result, basis 등 큰 표)를 turn 단위로 남기는지, 입력함을 어디에 두는지(durable인지 메모리인지). S3 10장은 "durable queue, stall 감시, orphan 회수를 한꺼번에 만들지 않는다"고 하고, S1 13장은 "agent event의 저장과 replay 안 함"이라 하는데 `runs`와 모델 호출·tool call 기록(복구, 사용량의 근거)이 ledger에 크게 있다. lophn session의 대기 입력이 재시작 뒤에 남는지 문서에 없다(coding agent는 버려진다고만 명시). 이 결정에 따라 위 "run 접수 입구", "입력함", "줄 서기" 항목의 크기가 크게 달라진다.
- Router가 core process에 사는지 agent-runtime process에 사는지. 지금은 `AcceptRun`이 core의 command이고 run을 고르고 돌리는 selector·driver는 agent-runtime 쪽(`core/main/agent-runtime/product-driver.ts`, `run-loop/driver.ts`)이다. `run-loop/work.ts`의 selector는 읽었으나 `driver.ts`, `product-driver.ts`는 앞부분만 읽었다.
- call과 사람 메시지가 한 session 입력함에 함께 쌓였을 때의 순서(사람이 먼저인지 접수 순서인지). 지금 코드는 사람 요청이 먼저(tier 1)인데 S3·S1에 순서 규칙이 없다.
- 앱 줄(req-1516)에 서 있는 coding call을 lophn이 꺼졌다 켜진 뒤 어떻게 하는지. 줄은 Router 메모리이면 사라지고 `agent_calls`에는 accepted로 남는다. S3 10장·S1 10장에 줄 복구 규칙이 없다.
- 사람이 steer를 고르는 UI의 모양(select, 단축키 등). req-1509는 동작만 정한다. 지금 composer는 도는 중에 select + Stop이다.
- 사람이 취소하는 단추의 위치. req-1503이 사람의 취소를 허용하나 S3 5장 "화면"에 취소 얘기가 없다.
- shell의 session 목록과 sidebar(`conversation/header/session-popover.tsx` 등)가 call로 열린 session을 어떻게 보이는지는 읽지 않았다(S1 8장 구독이 맡는 것으로 보고 이 목록에는 넣지 않음).
- `protocol/events`의 `Run*` event payload에서 `source`가 어디까지 쓰이는지(ledger 소비자)는 grep으로만 보았고 읽지 않았다.
- e2e에 handoff 흔적은 없었다(grep 결과 0건). `e2e/flows`에서 agent끼리 부르는 flow가 있는지 이름으로는 못 찾았다.
