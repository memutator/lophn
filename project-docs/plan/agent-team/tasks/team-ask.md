# team-ask

spawn된 session의 질문(`ask` tool)과 shell 승인(`ask` 규칙)을 사람이 아니라 부모에게 가는 result call로 보내고, 부모의 답으로 기다리던 request를 푼다. `team read`에 답하지 않은 call을 보이고, 상한 기본값을 2·8로 내리고, 팀 지시문을 help·첫 call 봉투·skill에 둔다.

- 단위: team (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/approvals/{turn-requests.ts,approvals.ts,ports.ts,approvals_test.ts}`, `packages/core/approvals/gate/{judge.ts,judge_test.ts}`
  - `packages/core/lophn-agent/tool-judgment/tool-gate.ts`, `packages/core/lophn-agent/tools/work.ts`(`askGate`의 거절 글만)
  - `packages/core/lophn-agent/tools/bundles/ask.ts`, `packages/core/lophn-agent/tools/questions/wait.ts`
  - `packages/core/router/{router.ts,commands.ts,model.ts,ports.ts,store.ts,schema.ts,reads.ts,mod.ts,router_test.ts,commands_test.ts,store_test.ts}`
  - `packages/core/storage/migration/schema-steps.lock.json`(끝에 한 줄)
  - `packages/core/lophn-agent/workspaces/lifecycle.ts`
  - `packages/core/main/daemon/wiring/{approvals.ts,router.ts,router-registration.ts,acp.ts,acp-build.ts}`
  - `packages/protocol/approvals/{turn-request.ts,tool-gate.ts}`, `packages/protocol/lophn-agent/{calls.ts,ask-tool.ts,team.ts}`, `packages/protocol/events/agent.ts`
  - `packages/cli/commands/{call.ts,team.ts}`
  - `packages/coding-agent/skills/lophn-agent.ts`
  - `packages/shell/renderer/desktop/connection/events/{waiting-store.ts,waiting-store_test.ts}`, `packages/shell/main/notice/rule.ts`
- 읽을 것:
  - `project-docs/plan/agent-team/README.md`("정한 것" 전부. 이 brief는 그 결정을 코드 모양으로 고정한 것이다)
  - architecture: `project-docs/architecture/approval.md`("묻는 길", "turn mode", "shell 규칙"), `project-docs/architecture/agent-call.md`("result 답", queue, 늦은 실패, `lophn_restarted`)
  - roadmap: `project-docs/products/roadmap/agent-surface.md`("팀 = spawn tree", "규칙 세 줄")
  - boundary: `project-docs/boundary-catalog.yaml`의 `router`
  - 지금 길:
    - shell `ask`: `packages/core/lophn-agent/tools/work.ts`의 `askGate` → `tool-gate.ts` → `approvals.ts`의 `judge` → `turn-requests.ts`. 조립은 `wiring/approvals.ts`의 `toolGateHandler`(`sessionOf`, `modeOf`)와 `gating`·`releaseWaits`.
    - `ask` tool: `tools/bundles/ask.ts` → memory route `askWait`(`wiring/approvals.ts`) → `questions/wait.ts`. 사람 메시지로 풀리는 길은 `waits.humanMessage`다.
    - Router: `router.ts`의 `route`·`reply`·`cancel`·`failAll`·`failLostOnStart`, `commands.ts`의 `teamSpawnCommand`와 `afterCommit` topic(`TEAM_SPAWNED_TOPIC`을 `wiring/router.ts`의 `apply`가 받는 법), `store.ts`의 `lost`.
    - 상태 `waiting`: Router `describe`(`wiring/router-registration.ts`, ledger `tool_calls`에서 읽는다)와 session snapshot(`wiring/session-snapshots.ts`, `turnRequests`·`questionWaits.list`에서 읽는다).
    - 대기 카드와 알림: renderer `waiting-store.ts`, shell `notice/rule.ts`(`TurnRequestOpened`·`QuestionAsked`).
    - step 등록: `packages/core/storage/migration/migrations.ts`(id·hash 대조), `packages/core/main/daemon/schema-steps_test.ts`(hash 찍는 법), 본보기 step `router.agent-calls.workspace`.
- 계약:
  - 쓰는 것: `sessions.spawned_by`, `TargetSession.spawned_by`, `teamRefusal`(부모에게 가는 call은 이미 통과한다), `team spawn|read`, 설정 `lophn-agent.team`.
  - 내놓는 것:
    - ledger step `router.agent-calls.ask`: `agent_calls.ask text`(null | `question` | `approval`). `AgentCallRow.ask`.
    - `ReplyCall` 입력에 `decision: "allow" | "reject"`(선택). CLI `lophn call reply <call> --allow` / `--reject [--body <이유>]`.
    - `AskResult`에 `{outcome: "parent_reply", message}`. `QuestionResolved.outcome`에도 `parent_reply`.
    - `TurnRequest.to_parent: boolean`, `QuestionAsked.payload.to_parent: boolean`(snapshot의 질문 항목도 같은 칸).
    - `team read`의 팀원마다 `open_calls: {call, reply, created_at}[]`.
    - `DEFAULT_TEAM_LIMITS = {max_members: 8, max_depth: 2}`.

## 정한 것 (lead, 근거)

README "lead가 할 일"의 넷과 planner 답(2026-11-08)을 여기서 고정한다.

1. **request와 call 잇기.** call 행에 `ask` 칸(kind)만 남기고, call ↔ request(질문 group) 짝은 main thread 메모리(`wiring/approvals.ts`)에 둔다. request가 메모리에만 있어 짝도 메모리면 충분하다. 행의 `ask` 칸은 재시작 때 열린 ask call을 고르고(5), 답의 꼴을 검사하고(2), 답을 queue 입력으로 배달하지 않게(2) 하는 데만 쓴다.
2. **부모 답의 꼴.** 새 명령을 두지 않고 `call reply`에 `decision`을 더한다. 부모는 받은 call에 답하는 것이고 이미 `call reply`를 안다.
   - `ask = 'approval'` call의 답은 `decision`이 있어야 한다(없으면 `invalid_input`). 다른 call(질문, 보통 call)에 `decision`을 주면 `invalid_input`이다.
   - `decision`은 `allow | reject` 둘뿐이다. `always`는 schema에 없다. 부모의 `allow`는 그 request를 `{outcome: "allow", scope: "once"}`로 풀고 `always_patterns`와 `AlwaysEffect`를 거치지 않는다. 그래서 부모가 shell 규칙을 더하는 길이 없다. `reject`는 body 글을 이유로 싣는다.
   - `deny`는 `judge`에서 끝나 request가 열리지 않으므로 부모에게 가지 않는다.
   - ask call의 답은 보낸 session(자식)의 queue로 배달하지 않는다. Router는 call을 `done`으로 두고 `afterCommit` topic `router.ask-answered`(`{call, decision, text}`)를 낸다. main thread가 짝을 찾아 request나 질문을 푼다. 짝이 없으면(그 사이 끝났다) 아무것도 하지 않는다.
3. **한쪽이 먼저 끝날 때.**
   - 자식 쪽이 먼저 끝나면(turn 끝 `turn_ended`, session 닫힘 `session_closed`, 사람 메시지로 질문이 풀림, 그 밖에 request·질문이 부모 답 말고 다른 것으로 닫힘) main thread가 짝인 call을 자식 이름으로 취소한다(Router `cancel`, 받는 부모에게 취소 알림이 간다). 부모의 늦은 답은 `closed: true`를 받는다.
   - 부모가 끝나 call이 `receiver_ended`로 닫히면 Router는 자식 queue에 실패 알림을 넣지 않고 topic `router.ask-ended`(`{call}`)를 낸다. main thread가 승인 request는 `{outcome: "reject", reason: "the parent session ended without answering"}`으로, 질문은 `cancelled`로 푼다.
   - 물을 때 부모에게 call이 닿지 않으면(부모가 이미 끝남, `failed`) 같은 결과로 바로 푼다. 자식 turn이 영영 걸리는 길이 없어야 한다.
   - 사람이 자식 session에 메시지를 보내 질문이 풀리는 지금 동작은 남긴다(planner). 그때도 짝인 call을 취소한다.
4. **답 글이 자식의 tool result로 가는 꼴.**
   - 질문: `{outcome: "parent_reply", message: <답 body의 글>}`. `human_message`처럼 그 글이 답인지는 model이 읽는다. 질문마다의 구조 답(`answers`)은 만들지 않는다.
   - 승인: 지금 `askGate`의 결과 그대로다. 허락이면 실행, 거절이면 `the person rejected this tool call: <이유>` 대신 `the parent rejected this tool call: <이유>`가 되도록 `rejected`에 누가 거절했는지(`by: "person" | "parent"`)를 싣는다.
5. **재시작.** 지금 `store.lost`는 "accepted인데 가져가지 않은" call만 닫는다. 부모가 이미 가져간 ask call은 accepted로 남는데 자식 request는 사라지므로, 부모가 나중에 답하면 엉뚱한 곳으로 간다. 그래서 `lost`가 `ask is not null`인 accepted call도 가져갔든 아니든 고르고, `lophn_restarted`로 닫는다. ask call의 이 실패는 자식에게 알리지 않는다(자식 turn은 같은 recover에서 interrupted로 닫힌다).
6. **팀 자식의 요청은 event를 그대로 내고 표시로 거른다.** `TurnResumed`(`live-turns.ts`), session snapshot의 `waiting`, acp가 그 event에 기대기 때문이다(planner 답). `TurnRequest.to_parent`와 `QuestionAsked.to_parent`가 true인 것은 renderer waiting store가 카드로 만들지 않고, `notice/rule.ts`가 toast·OS 알림을 내지 않고, acp projection이 permission·질문 카드로 만들지 않는다. 자식 탭의 session 상태는 그대로 `waiting`이다.
7. **turn mode.** 부모에게 보내는 조건:
   - `ask` tool(질문): 자식(`spawned_by` 있음)이면 mode와 skip에 상관없이 부모에게 간다. 팀 밖 session은 지금 그대로다(unattended면 `unattended`, 아니면 사람에게).
   - shell `ask`: `judge`에 입력 `toParent: boolean`을 더한다. 값은 `spawned_by !== null && !session.skip`이다(skip이 먼저, planner 답). `judge`는 shell 규칙이 ask일 때 `mode === "attended" || toParent`면 `ask`, 아니면 `run`이다. deny는 그 앞에서 끝난다.
   - unattended 판정을 runtime에서 core로 옮긴다. `ask.ts`의 handler는 늘 `ctx.questions.ask`를 부르고, `askWait` handler(`wiring/approvals.ts`)가 turn mode와 session의 `spawned_by`를 읽어 정한다. 한 곳에서 정하려는 것이다.
   - ask call은 자식 turn의 unattended 표시를 싣는다(지금 call과 같은 규칙). 그래서 unattended 사슬의 root가 받은 질문에는 root의 `ask`가 `unattended`를 돌려준다(README).

## 할 일

1. **ledger.** `ROUTER_SCHEMA_STEPS` 끝에 step `router.agent-calls.ask`를 더한다: `alter table agent_calls add column ask text check (ask is null or ask in ('question', 'approval'))`. 옛 행은 null이라 옮길 data가 없다. lock file 끝에 `{id, sha256}`. 이미 낸 step의 SQL은 고치지 않는다. row·칸 목록·`AgentCallRow`에 `ask`를 더한다.
2. **judge.** `judge(call, assignment, shell, mode, toParent)`. 정한 것 7. `ApprovalsDeps`/`Approvals.judge`의 `who`에 `toParent`를 더하고, `toolGateHandler`의 `sessionOf`가 session의 `spawned_by`와 `skip`을 읽어 넘긴다.
3. **turn request.** `TurnRequest`에 `to_parent`를 더하고, `openTurnRequest`가 그 값을 받는다. `toParent`인 request는 `always_patterns`를 비운다(카드도 `always`도 없다). `decide`(사람의 결정 route)는 `to_parent` request를 `not_found`로 거절한다: 카드가 없는 request를 사람이 결정하는 길을 열지 않는다. 부모 답으로 푸는 입구 `answerFromParent(id, decision, reason)`를 더한다. 이 입구는 `once`·`reject`만 낸다.
4. **질문.** `questions/wait.ts`의 기다림에 `to_parent`와 부모 답으로 푸는 입구를 더한다(`parent_reply`). `QuestionAsked`·`QuestionResolved`·snapshot 항목을 맞춘다. 사람 메시지(`humanMessage`)로 풀리는 길은 그대로다.
5. **ask call 열기와 닫기(main thread).** `wiring/approvals.ts`가 짝 표(`call → {kind, request | group, session}`)를 갖는다.
   - 열기: 자식의 request·질문을 연 뒤 machine command로 부모에게 result call을 보낸다. `from`은 자식 session, `to`는 `{session: spawned_by}`, `reply: "result"`, `ask: <kind>`, `unattended`는 그 turn의 mode에서. body는 program이 만든다:
     - 승인: GateCall에서 만든 카드 내용(명령 글이나 tool 이름. agent가 쓴 설명은 싣지 않는다, `approval.md`)과 "Reply with `lophn call reply <call> --allow` or `--reject --body <reason>`. If you cannot decide, use `ask` yourself; it goes to your own parent or the person."
     - 질문: 질문의 header·글·선택지와 "Reply with `lophn call reply <call> --body <answer>`. If you cannot answer, use `ask` yourself; it goes to your own parent or the person."
     - body는 call send와 같은 준비(redaction, blob)를 거친다(`wiring/router.ts`의 본문 준비 목록).
   - 닫기: 정한 것 3의 경우마다 machine command로 Router `cancel`(자식 이름)을 부른다. 꺼질 때(`releaseWaits`)는 부르지 않는다. 재시작 recover가 닫는다(정한 것 5).
   - 받기: `wiring/router.ts`의 `apply`가 `router.ask-answered`·`router.ask-ended` topic을 approvals 쪽으로 넘긴다(조립이 둘을 잇는 port를 꽂는다. approvals는 Router를 import하지 않는다).
   - machine command 둘(예: `calls.ask-open`, `calls.ask-withdraw`)을 `commands.ts`에 둔다. 자격은 machine만이다(`callsRecover`와 같은 꼴). runtime이 아니라 core main thread가 부르므로 `RUNTIME_MACHINE_ROUTES`는 해당하지 않는다. 등록 목록 file은 보고에 적는다.
6. **Router.**
   - `route` 입력에 `ask`를 더해 행에 남긴다.
   - `reply`: 정한 것 2. ask call의 답은 배달하지 않고 `done` + topic.
   - `failAll`: ask call은 보낸 session에 실패 알림을 넣지 않고 `receiver_ended`면 topic `router.ask-ended`를 낸다.
   - `store.lost`: 정한 것 5.
7. **team read.** 팀원마다 `open_calls`: caller가 그 팀원에게 보낸, 아직 `accepted`인 `result`·`conversation` call(`{call, reply, created_at}`). 자식이 `call reply`를 잊은 것을 부모가 알아채는 길이다(README).
8. **상한.** `DEFAULT_TEAM_LIMITS`를 `{max_members: 8, max_depth: 2}`로. 사람이 설정한 값은 설정 file에 있고 키가 없을 때만 기본값이라 data step은 없다. `checkSpawnSlot`의 거절 글에 "do the work yourself or ask your parent"를 붙인다.
9. **지시문.** system prompt에는 넣지 않는다(prompt cache, README).
   - `team spawn` help(`packages/cli/commands/team.ts`)와 skill `lophn-agent`의 team 절에 넷을 같은 말로: spawn한 뒤 turn을 끝낸다(답은 새 입력으로 온다); poll하지 않는다; worker면 직접 한다; 모르거나 승인이 필요하면 `ask`한다(부모에게 간다). `call reply`의 `--allow`/`--reject`도 skill과 `call reply` help에 적는다.
   - 첫 call 봉투의 고정 글: `team spawn`의 본문 준비에서 core가 body 앞에 고정 text block 하나를 붙인다(받은 메시지로 저장되어 이력 재생이 같은 bytes다). 내용: "You are a team member spawned by your parent session. Do the work yourself. When done, answer this call with `lophn call reply`. If you are unsure or need approval, use `ask`; it goes to your parent. If you spawn members yourself, end your turn after spawning and do not poll; their answers arrive as new input."
   - `ask` tool description 끝 문장은 결과 목록에 `parent_reply`를 더하고 "In a team, questions go to your parent."를 붙인다. 고정 글이라 cache를 깨지 않는다.
10. **renderer·알림·acp.** 정한 것 6.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(이것으로 충분하다. 있는 test file에 둔다):
  - "부모의 `allow`는 deny 규칙에 걸린 shell 명령을 실행하게 하지 못한다"(deny면 request도 call도 열리지 않는다).
  - "부모의 답으로는 shell 규칙이 더해지지 않는다"(`decision: "always"`는 `invalid_input`이고, `allow`로 푼 request는 `once`이며 `AlwaysEffect`가 불리지 않는다).
  - "팀 밖 session의 `ask`는 지금 그대로다"(attended shell ask는 `to_parent: false` request를 열고 call을 보내지 않는다. unattended 질문은 `unattended`다).
  - "부모가 끝나면 자식의 request가 거절로 풀린다"(`receiver_ended` → reject).
- 남지 않음: `grep -rn "ctx.mode === \"unattended\"" packages/core/lophn-agent/tools/bundles/ask.ts`가 0줄. `grep -rn "max_members: 16\|max_depth: 3" packages`가 0줄.

## 보고

brief-template의 보고 꼴. 등록할 것(protocol `mod.ts`·registry, core command 목록, wiring 조립)을 적는다. 문서(`approval.md`, `agent-call.md`, roadmap)는 lead가 고치니 바뀐 동작을 보고에 짧게 적는다.
