# agent-tools-call

다른 agent와 사람을 잇는 tool과 skill 읽기를 짓는다: `call`, `reply`, `cancel`, `session.list`, `ask`, `skill.read`, `tool.search`. 옛 질문 묶음 tool(`question.submit`, `question.read_decision`, `approval.read_decision`)과 `tools/questions/`는 지운다. Router와 `tools/handoff/`는 router 단위 몫이라 건드리지 않는다.

- 단위: agent-tools (wave 3)
- 선행: agent-tools-registry (`ToolDefinition`, `ToolContext`, `QuestionWait`, `SkillReader`, `splitDeferred`, 껍데기 `bundles/call.ts`·`ask.ts`·`skill.ts`)
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/bundles/call.ts`, `bundles/ask.ts`, `bundles/skill.ts`
  - `packages/core/lophn-agent/tools/call/` (새 폴더: `sessions.ts`)
  - `packages/core/lophn-agent/tools/questions/` (통째로 지운다)
  - `packages/core/lophn-agent/tools/skills.ts` (옛 `skill.read`·`skill.read_supplemental`을 지운다)
  - 예외: `tools/mod.ts`에서 이 task가 지운 file(`questions/`, `skills.ts`)의 export 줄만 지운다
- 읽을 것:
  - inventory(lead가 맞추며 더함): `I1.3#10`, `I1.3#11`
  - spec: S4 3장(call·reply·cancel 입력, session 목록, 사람에게 묻기, skill 읽기, tool 찾기) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S3 3·4·8장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-call.md`
  - spec: S1 6·9장(질문 event와 흐름) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - inventory: `I1.4#13`, `I2.4#8`, `I3.3#6`, `I3.4#8`, `I3.4#9`(`tool.search` 쪽)
  - 결정: `../README.md` 3장 #3, #4
- 계약:
  - 쓰는 것: `TOOL_INPUTS`, `askResultSchema`, `askQuestionSchema`(contract-agent-tools-catalog), `ToolContext`의 `router`·`questions`·`skills`·`listed`(agent-tools-registry), Router port(`core/lophn-agent/ports.ts`, contract-calls-places). `QuestionAsked`·`QuestionResolved` event는 router의 run-loop가 낸다(contract-events가 payload를 정한다). 이 task는 event를 만들지 않는다.
  - 내놓는 것: `CALL_TOOLS`(call, reply, cancel, session.list), `ASK_TOOLS`, `SKILL_TOOLS`(skill.read, tool.search)

## 할 일

1. `bundles/call.ts` (`I3.3#6`):
   - `call`: 입력(`to`, `reply`, `body`, `refs`, coding agent일 때 실행 옵션)으로 봉투를 만들어 `ToolContext.router`에 넣고 call ID를 바로 돌려준다. 보낸 agent의 turn은 이어 간다. dedup 키는 `ToolContext.tool_call`이다(입력이 아니다). 받는 이름은 정확히 맞아야 하고 짐작하지 않는다. Gate는 Router가 보낸 agent의 agent grant로 판정한다. 막히면(`not_allowed`, 끝난 session의 `closed`) 이유를 결과 그대로 돌려준다. 끝난 session이면 이유에 "role과 place로 새 session을 부르라"를 적는 문구는 Router가 준다.
   - `reply`: `call`에 답하는 입력(`body`, `refs`). `cancel`: 자기가 보낸 끝나지 않은 call을 `reason` 한 줄로 취소한다.
   - 효과는 셋 다 `read`(S2 3장 "다른 agent(call)"). 판정은 Router가 한다.
2. `call/sessions.ts` + `session.list`(read): 보낼 수 있는 열린 session을 ID, role, place, 이름, 상태로 돌려준다. agent grant가 deny인 상대는 뺀다. 앱마다 줄에 서서 기다리는 coding agent 맡기기도 보인다(S6). prompt에는 넣지 않는다. 목록은 core의 session 읽기 route(contract-calls-places)로 받는다.
3. `bundles/ask.ts` (`I3.4#8`): `ask`는 `askInputSchema`를 받아 `ToolContext.questions.ask(session, questions)`를 부르고 풀릴 때까지 기다린다. 결과는 `askResultSchema`(`submitted`, `cancelled`, `human_message`)다. 기다리는 중 사람이 메시지를 보내면 그 메시지가 tool 결과가 된다. 뜻을 가리는 코드를 두지 않는다. 설명 문구에 `ASK_TOOL_RULES`를 넣는다. 사람이 열지 않은 session에서도 쓸 수 있다. 권한 확인에 쓰지 않는다. 효과는 Gate를 거치지 않는 `read`다.
4. 옛 질문을 지운다 (`I1.4#13`): `tools/questions/` 폴더 전체(`group`, `option-actions`, `text-*`, `screen`, `rewound`, `protected-settings`, `commands`, `reads`, `model`, `schema`, `erase`, `mod`)와 `question.submit`, `question.read_decision`, `approval.read_decision` 정의. 먼저 `grep -rn "tools/questions\|questions/mod" packages/core --include=*.ts`로 밖에서 쓰는 곳을 센다. session, waiting-and-recovery, run-loop, register.ts가 쓰면 그 file은 다른 단위 몫이므로 지우지 않고 보고에 적는다. 지울 수 있는 것만 지운다.
5. `bundles/skill.ts` (`I2.4#8`): `skill.read`는 `ToolContext.skills.read(session, name, path?)`를 부른다. 꺼진 skill은 막고, 도는 turn은 그 turn이 시작할 때 읽은 판을 쓴다(그래서 지금의 `pinned_hash` 비교와 `changed` 실패는 없다). 전역 skill은 lophn data에 있어 file tool이 닿지 않으므로 이 tool이 유일한 길이다. `skill.read_supplemental`은 지운다(딸린 파일은 `path` 인자). 옛 `tools/skills.ts`를 지운다.
6. `tool.search` (`I3.4#9`): `names`(정본 이름)를 받아 `ToolContext.listed`에서 찾은 정의의 설명과 입력 JSON Schema를 돌려준다. 목록에 없으면 한 줄 오류(`unknown_tool`)다. 정의를 이미 prompt에 둔 tool은 그대로 돌려줘도 된다.
7. (lead가 맞추며 더함 (`I1.3#10`, `I1.3#11`)) agent tool `handoff.submit`, `handoff.read_status`, `handoff.read_result` / tool `run.read_result`

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. call의 거절과 닫힌 session은 Router가, 질문 상태와 복구는 router의 run-loop가 본다. 이 task의 새 코드는 얇은 연결이다.
- 남지 않음: `grep -rn "question.submit\|question.read_decision\|approval.read_decision\|skill.read_supplemental" packages`가 0줄이다(4번에서 남긴 곳 제외).

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: 4번에서 남긴 `tools/questions` 사용처
- 정한 것: `session.list` 출력 칸, `tool.search` 출력 모양, 질문 기다림을 `QuestionWait`에 맡기는 방식
- 계약 바꾸기 요청: Router port나 session 목록 route에 모자란 칸

- (lead가 더함, router-calls가 넘긴 것) Router의 `CallGate.authorize`는 tx 안이라 사람에게 묻지 못하고, 묻는 grant는 `not_allowed`로 닫는다(fail-closed). `call` tool이 command를 보내기 전에 `ToolGate`로 묻고, 통과한 호출만 `calls/send`로 보낸다(lead 결정).
