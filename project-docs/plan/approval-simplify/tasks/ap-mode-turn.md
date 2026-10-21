# ap-mode-turn

turn을 시작할 때 mode(attended, unattended, skip)를 정해 turn 행에 남기고 tool gate와 tool 맥락에 넘긴다. mode는 그 turn 동안 바뀌지 않고, 도는 turn에 사람이 steer한 메시지도 그 turn의 mode를 따른다. unattended turn이 보내는 call·reply에 표시를 싣고, unattended turn의 `ask`는 기다리지 않고 "사람이 없다"를 바로 돌려준다.

- 단위: mode (wave 3)
- 선행: ap-mode-envelope, ap-skip-session
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{turns.ts,turn-values.ts,ask-tool.ts}`
  - `packages/core/lophn-agent/run-loop/{schema.ts,commands.ts,turn.ts,loop.ts,reads.ts,core-ports.ts}`
  - `packages/core/lophn-agent/run-loop/{model.ts,prepare.ts,credentials.ts}`
  - `packages/core/lophn-agent/run-loop/turn-mode.ts`(새 file)
  - `packages/core/lophn-agent/tools/tool-context.ts`
  - `packages/core/lophn-agent/tools/bundles/{ask.ts,call.ts}`
  - `packages/core/main/daemon/wiring/approvals.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`("도는 turn은 시작 때 읽은 판을 끝까지 쓴다", "사람에게 묻는 중 사람이 그 session에 메시지를 보내면 기다림을 끝내고"), `project-docs/architecture/agent-call.md`("입력함 순서 … steer는 사람 메시지만 고른다", "도는 turn에 끼우지 않는다"), `project-docs/architecture/place-session.md`(checkpoint와 steer), `project-docs/architecture/approval.md`(turn 안 request)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `run-loop`, `agent-tools`, `agent-sessions`, `approvals`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/main`(wiring)
  - 제품 결정: `project-docs/products/roadmap/approval.md`의 "turn mode" 절 전체("unattended turn의 `ask` tool은 기다리지 않는다", "skip은 call을 따라 가지 않는다"), `project-docs/plan/approval-simplify/README.md`의 "뼈대 검토에서 정한 것"(turn mode는 turn을 시작할 때 정한다, unattended는 답에도 실린다)
  - 본보기(코드): `packages/core/router/schema.ts`의 `list()`(상수 목록으로 CHECK를 만든다), `packages/core/lophn-agent/run-loop/schema.ts`의 `turns_started_immutable` trigger, `packages/core/main/daemon/wiring/approvals.ts`의 `agentOf`(machine 자격 reader로 읽는 꼴)
- 계약:
  - 쓰는 것: `TurnMode`(ap-contract), 봉투 `unattended`(ap-mode-envelope), session `skip`(ap-skip-session), `Approvals.judge`의 `who.mode`(ap-ask-turn)
  - 내놓는 것: `turns.mode`, `StartTurn` 입력 `mode`, `turnRecordSchema.mode`, `ToolContext.mode`. 정하는 규칙(session skip이면 skip, 입력 봉투가 unattended면 unattended, 그 밖 attended)은 함수 `turnModeOf` 하나에 둔다. `turns.mode`는 시작 뒤 바뀌지 않고, 도는 turn에 steer한 사람 메시지는 그 turn의 mode를 따른다. tool gate는 그 turn 행의 mode로 판정한다. `AskResult`에 `{outcome: "unattended"}`가 있다. skip turn의 `ask`는 사람이 있으므로 기다린다.

## 할 일

추가(planner, 살 단계 뒤): (1) turn mode의 type(`TURN_MODES`, `turnModeSchema`, `TurnMode`)은 `packages/protocol/lophn-agent`(예: `turn-values.ts`)에 있다. `protocol/approvals`에 두면 `protocol-cycle`이다(`ap-contract`가 옮긴다). (2) `turnModeOf`의 순서는 unattended 입력 → session skip → attended다. skip인 session도 unattended call로 열린 turn은 unattended다. 아래 "skip이 먼저"는 따르지 않는다.

**띄우기 전에 planner가 1번의 `turnModeSchema` 자리(protocol 순환)를 정한다.** 5번의 순서도 planner에게 올렸다.

줄 번호는 main `e192a9d8c` 기준이고 앞 wave(ap-ask-turn, ap-assign-tools, ap-call-judge)와 같은 wave의 ap-mode-envelope가 고친 뒤라 밀려 있다. 이름으로 찾는다.

1. protocol
   - `packages/protocol/lophn-agent/turns.ts`의 `startTurnInputSchema`(22-38)에 `mode: turnModeSchema`를 더한다(필수).
   - `packages/protocol/lophn-agent/turn-values.ts`의 `turnRecordSchema`(99-117)에 `mode: turnModeSchema`를 더한다.
   - import 자리는 ap-contract의 `packages/protocol/approvals/mode.ts`다. **뼈대 문제**: `protocol/approvals`는 이미 `protocol/lophn-agent`를 import한다(`assignment.ts`, `gate-call.ts`, 옛 `grants.ts`). 여기서 거꾸로 import하면 `tools/check-deps.ts`가 `protocol-cycle`로 막는다. planner가 `TURN_MODES`·`turnModeSchema`·`TurnMode`의 자리를 `protocol/lophn-agent`로 옮기면 그 자리를 import한다. 정해지기 전에는 이 task를 띄우지 않는다.
   - `packages/protocol/lophn-agent/ask-tool.ts`의 `askResultSchema`(56-64)에 `z.object({ outcome: z.literal("unattended") })`를 더하고 주석에 "unattended: 사람이 없는 turn이라 묻지 않았다"를 더한다.
2. turns 표(`packages/core/lophn-agent/run-loop/schema.ts`)
   - `create table turns`에 `mode text not null check (mode in (...))`를 더한다. 값 목록은 `TURN_MODES`로 만든다(`packages/core/router/schema.ts`의 `list()` 꼴).
   - `turns_started_immutable` trigger(44-48)의 열 목록에 `mode`를 더하고 abort 글을 "turn basis, start, limits and mode are fixed once started"로 바꾼다. 머리 주석(3-6)에 "mode는 시작 때 정한다. 도는 turn에 steer한 사람 메시지도 그 mode를 따른다"를 더한다.
   - step을 새로 더하지 않고 있는 step의 글을 고친다. 옛 개발 data는 `history_mismatch`로 거절되니 `.dev-data/`를 지우고 새로 만든다(AGENTS.md "호환성").
3. turn 행 읽기(`packages/core/lophn-agent/run-loop/model.ts`): `TURN_COLUMNS`, `TurnRow.mode`, `turnRowOf`, `turnRecordOf`(69)에 칸을 더한다. `reads.ts`는 `turnRecordOf`를 쓰므로 고칠 것이 없으면 두지 않는다.
4. `StartTurn`(`packages/core/lophn-agent/run-loop/commands.ts`의 `start`): `insert into turns`(227-239)에 `input.mode`를 넣는다. 같은 id의 재전달은 지금처럼 이전 결과를 돌려준다.
5. 규칙(`packages/core/lophn-agent/run-loop/turn-mode.ts`, 새 file): `turnModeOf(session: { skip: boolean }, input: { unattended: boolean }): TurnMode`. session이 skip이면 `"skip"`, 아니면 `input.unattended`면 `"unattended"`, 그 밖 `"attended"`. 주석에 ap-contract `mode.ts`의 규칙을 가리킨다. **뼈대 문제**(planner에게 올렸다): 이 순서면 skip session이 unattended call을 받은 turn이 skip이 되어 그 turn이 보내는 call에 표시가 빠지고, 사슬 아래가 attended가 된다. roadmap "unattended turn이 보낸 call로 열린 turn은 unattended다"와도 어긋난다. planner가 순서를 바꾸면 이 함수의 두 줄만 바뀐다.
6. turn 시작 재료
   - `packages/core/lophn-agent/run-loop/credentials.ts`의 `BeginTurnInput`(131)에 `mode: TurnMode`를 더한다.
   - `packages/core/lophn-agent/run-loop/prepare.ts`의 `prepare`(636): session을 읽은 바로 뒤(647) `const mode = turnModeOf(session, start.input)`. `start.input`은 입력함의 `RoutedInput`이다(감독 pipe가 `z.unknown()`으로 그대로 나른다).
   - `closeUnstarted`(581)가 `mode`를 받아 그 `StartTurn` 입력(599-610)에 싣는다.
   - `begin`(775-785)에 `mode`, `startTurn`(792)의 command 입력에 `mode: input.mode`를 싣는다.
   - `loopFor`(406)에 `mode`를 넘겨 `toolSetup.context`(465)가 `mode`를 채운다.
7. tool 맥락(`packages/core/lophn-agent/tools/tool-context.ts`): `mode: TurnMode`(1번과 같은 자리에서 import)를 더한다. 주석: "이 turn의 mode. 시작 때 정해 turn 동안 같다. call·reply가 unattended 표시를 싣고 ask가 사람 없음을 안다. Gate 판정은 core가 turn 행에서 읽는다".
8. call·reply tool(`packages/core/lophn-agent/tools/bundles/call.ts`)
   - `call`의 입력을 `callSendInputSchema.omit({ dedup: true, unattended: true })`로 하고 handler가 `...(ctx.mode === "unattended" ? { unattended: true as const } : {})`를 싣는다.
   - `reply`의 입력을 `callReply.input.omit({ unattended: true })`로 하고 handler가 같은 표시를 싣는다.
   - skip turn은 싣지 않는다. 주석: "skip은 call을 따라 가지 않는다(roadmap)". `cancel`은 싣지 않는다(Router가 call 행의 표시를 쓴다).
9. ask tool(`packages/core/lophn-agent/tools/bundles/ask.ts`)
   - handler 처음에 `ctx.mode === "unattended"`면 `ctx.questions.ask`를 부르지 않고 `ok(fitted("ask unattended: no person is present in this turn", { outcome: "unattended" }))`를 돌려준다.
   - 설명(12-14)에 "In a turn with no person present it does not wait and returns unattended: decide yourself, or leave it undone and say what is left."를 더한다. skip turn은 지금처럼 기다린다.
10. tool gate의 mode(`packages/core/main/daemon/wiring/approvals.ts`)
    - ap-ask-turn이 남긴 `toolGateHandler`가 `approvals.judge`에 넘기는 고정 `mode: "attended"`를 그 turn 행의 mode로 바꾼다.
    - turn은 `ctx.runtime.readers.read(turnRead, APPROVALS_CONTEXT, { turn: input.turn })`로 읽는다(`agentOf`가 `agentSessionRead`를 읽는 꼴). `APPROVALS_CONTEXT.scope.operations`에 `turnRead.name`을 더한다.
    - 못 읽으면 판정하지 않고 그 오류를 돌려준다. tool은 실행되지 않는다.
11. `turn.ts`, `loop.ts`, `core-ports.ts`는 `ToolContext`를 `toolSetup.context`에서 받아 펼치므로 고칠 것이 없으면 두지 않는다.
12. 문서(`architecture/agent-call.md`의 봉투 mode, `approval.md`)는 lead가 계획 끝에 고친다(README "lead가 할 일"). 고치지 않는다.

정한 것:
1. ask의 "사람이 없다"는 runtime의 tool handler가 `ctx.mode`로 돌려준다. core의 `ask/wait`는 고치지 않는다. 이유: 그 route를 부르는 것은 ask tool 하나이고, 계약이 `ToolContext.mode`를 둔다.
2. 도는 turn에 steer한 사람 메시지는 따로 할 일이 없다. mode는 turn 행에 있고 steer는 turn을 시작하지 않는다(README "turn mode는 turn을 시작할 때 정하고 그 turn 동안 바뀌지 않는다"). trigger가 바뀌지 않음을 지킨다.

## 끝남

- `deno task check`가 통과한다. schema step 글을 바꿨으니 `project-docs/plan/tools/lead/boot.sh`(새 data root)로 core가 뜨는지 본다.
- 위험 test: 없음. 표시가 call, 답, 늦은 실패, 취소 알림을 따라 가는지는 ap-mode-envelope의 "attended turn이 보낸 call은 attended로 열린다. unattended가 attended 사슬로 새지 않는다"가 본다. mode마다 `ask`가 `run`이 되는지와 `deny`가 남는지는 ap-gate의 `judge` test가 본다. `turnModeOf`는 한 줄 규칙이다(write-test "사소한 함수").
- 남지 않음: `grep -n "mode: \"attended\"" packages/core/main/daemon/wiring/approvals.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
