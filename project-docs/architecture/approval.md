# approval

agent가 하는 동작마다 "해도 되나"를 정하는 장치다. 원칙은 둘이다. 시킨 것이 승낙이고, 할당이 허락이다. 사람이 agent에게 맡긴 일과 준 tool은 다시 묻지 않는다. 실행 때 묻는 것은 shell 규칙이 `ask`인 명령뿐이고, 사람이 없는 turn은 묻지 않는다. 실수는 묻기가 아니라 rewind와 deny 규칙으로 줄인다. 이 문서는 판정(`judge`), 묻는 길 하나(turn 안 request), turn mode, shell 규칙, 할당을 다룬다. 앱의 자원 허락(activation 동의)은 `architecture/activation.md`의 일이다.

## 흐름

```
 runtime tool 실행 (work.ts)
   tool 정의의 gate가 GateCall을 낸다: app_tool | mcp_tool | shell
   gate 없는 tool(file, web, ask, call 등)은 이 길을 거치지 않는다
        │ memory route tool_gate/check (그 turn의 agent 자격만)
        ▼
 core approvals
   turn 행의 mode, session의 agent와 place, 할당, shell 규칙 층을 읽는다
   judge(call, assignment, shell, mode) ─┬ deny ─▶ 실행하지 않고 이유를 tool 결과로
   순수 함수                              ├ run  ─▶ 실행
                                          └ ask  ─▶ turn 안 request (메모리)
                                                    TurnRequestOpened ─▶ 대기 목록, toast, 대화 카드
                                                    사람: once | always | reject (DecideTurnRequest, 사람 자격만)
                                                    TurnRequestClosed ─▶ turn이 이어 간다
 앱 호출 경로 (agent·앱이 앱 tool을 부름): 묻지 않고 막기만 한다
   agent ─▶ judge로 할당을 본다      앱 ─▶ active 앱 grant의 app.call
```

- 할당은 사람이 agent에게 앱을 붙이고 그 앱에서 뺄 tool을 적는 것이다(`agent_assignments`, 줄은 `{app, removed_tools}`). 할당한 앱의 tool만 그 agent의 tool 목록에 뜬다.
- MCP server는 설정한 층(전역, project, Operator 정의)이 곧 할당이다. 끄기는 `mcp_off`다. 할당 줄이 없다.
- 효과(read, write, external)는 판정에 쓰지 않는다. 할당한 tool은 바깥 효과도 묻지 않는다(사람, 2026-10-21). 효과는 기록과 재시도에만 쓰인다.
- 사람이 앱 화면에서 누르는 것, 사람이 보내는 메시지, agent call, 지침 파일(`LOPHN.md`) 쓰기, file·web·pdf·image tool은 묻지 않는다. file tool은 place가 범위이고 쓰기는 rewind로 되돌린다.
- coding agent의 tool call은 harness의 일이다. lophn은 harness의 물음을 대기 목록에 비추기만 하고(`subject.kind: "harness"`) 답은 터미널에서 한다.

## 지키는 것

판정
- `judge`는 IO 없는 함수다(`packages/core/approvals/gate/judge.ts`). 시각, 상태, 전역을 읽지 않는다. 같은 입력은 같은 결과다.
- 할당하지 않은 앱의 tool은 `deny not_assigned`, 할당에서 뺀 tool은 `deny removed`다. 어느 mode에서나 막는다. tool 목록은 session 시작 때 고정하지만(`architecture/agent-definition.md`), 판정은 call 때 지금 할당을 읽어 session 도중 뺀 앱 tool도 바로 막는다. session 도중 끈 MCP server는 아직 막지 않는다(`project-docs/issues/approval.md`).
- `deny`는 어느 mode에서나 막는다. skip은 묻지 않는 것이지 금지를 푸는 것이 아니다.
- `ask`는 attended에서만 묻는다. unattended와 skip에서는 `run`이 된다.
- 사람의 결정은 사람 자격만 받는다(`DecideTurnRequest` actors `user`, handler도 한 번 더 본다). agent, coding agent, 앱, MCP server가 스스로 허락하면 판정이 의미 없다.
- agent는 자기 할당을 넓히지 못한다. 할당 쓰기(`SetAgentAssignment`)는 사람만 하고 읽기는 사람과 machine뿐이다. Operator 정의를 만들고 고치는 tool은 `mcp_servers`와 `skip`을 입력으로 받지 않는다.
- 할당 저장은 revision을 비교한다. 다른 창이 먼저 저장했으면 `conflict`이고 화면이 다시 읽는다.
- 선언(blueprint의 효과, MCP `readOnlyHint`)은 믿는다.

묻는 길
- 묻는 길은 turn 안 request 하나다(`packages/core/approvals/turn-requests.ts`). 메모리에 있고, 물은 turn이 기다린다. 재시작하면 비고 기다리던 turn은 cancelled를 받는다.
- 침묵이나 카드 닫기는 결정이 아니고 기한도 없다. 원래 일이 끝나면 cancelled로 닫고 요청자는 거절과 구별해 받는다. 거절 이유는 agent에게 그대로 간다.
- 물은 입력을 그대로 실행한다. 허락은 메모리에서 기다리는 같은 호출을 풀 뿐이고, 다시 판정하거나 입력을 비교하지 않는다. 바꿔치기할 틈이 없어 fingerprint를 두지 않는다.
- 선택지는 `once`, `always`, `reject`다. "이 session 동안" 허락은 없다.
- `always`는 request의 `always_patterns`를 allow 규칙으로 더한다. shell request에만 있고, 비면 `always`를 받지 않는다(`invalid_input`). 카드는 그 줄을 그대로 보여 사람이 무엇을 허락하는지 본다.
- 카드 내용은 program이 GateCall에서 만든다. agent가 쓴 설명은 싣지 않는다.

turn mode
- turn은 시작할 때 mode를 정해 `turns.mode`에 남기고 그 turn 동안 바꾸지 않는다(`turns_started_immutable`). 도는 turn에 사람이 steer한 메시지도 그 turn의 mode를 따른다. Gate는 그 turn 행의 mode로 판정하고, 못 읽으면 판정하지 않는다.
- 정하는 순서는 unattended 입력, session skip, attended다(`packages/core/lophn-agent/run-loop/turn-mode.ts`). skip session이 받은 unattended call의 turn도 unattended다. skip이 먼저면 사슬 아래가 attended로 떨어져 사람 없이 멈춘다.
- unattended는 call 봉투에 실려 따라간다. unattended turn이 보낸 call과 답에 표시가 실리고, 그 call의 늦은 실패와 취소 알림도 call 행의 표시를 따른다(`architecture/agent-call.md`). 답의 표시는 답한 turn에서 온다. 사람이 끼어든 attended turn의 답은 attended다.
- reaction, coding agent 입력, 화면에서 사람이 보낸 메시지가 연 turn은 attended다. `SendMessage`에 `unattended: true`를 실어 넣은 사람 메시지(run 입력, `architecture/run.md`)가 연 turn은 unattended다. 사람 메시지의 이 표시는 run만 싣는다. workflow가 넣은 step 입력(`architecture/workflow.md`)도 unattended 표시를 싣는다. 사람이 instance를 시작한 것이 그 사슬을 맡긴 것이다. 표시는 할당을 넓히지 않는다.
- unattended turn의 `ask` tool은 기다리지 않고 `unattended`를 바로 돌려준다. skip turn의 `ask`는 사람이 있으니 기다린다.
- skip은 session 표시다. 사람만 켜고 끈다(`ChangeSessionSkip`). Operator 정의의 `skip`이 그 Operator 새 session의 기본값이고, 이 칸도 사람만 쓴다. skip은 call을 따라 가지 않는다. fork는 skip을 가져가지 않고 정의의 기본값으로 시작한다.

shell 규칙
- 규칙은 `{pattern, action}`이고 action은 `allow | ask | deny`다. `*`는 아무 글자, `\*`는 글자 그대로의 `*`다. `*`가 없는 pattern은 그 명령과 똑같을 때만 맞고, 끝의 ` *`는 그 앞까지만 있어도 맞는다. 공백은 줄여 맞춘다.
- 층은 셋이다: 제품 기본(`PRODUCT_SHELL_RULES`의 floor deny와 ask), 전역, project. 전역과 project 규칙은 Settings 값 `approvals.shell_rules`에 있다. 사람의 project 폴더에 두지 않는다. PM이 그 폴더를 file tool로 쓰기 때문이다.
- 명령 전체와 `&&`·`||`·`;`·`|`·줄바꿈으로 나눈 조각마다 floor, 그다음 층을 이어 본 가운데 마지막에 맞은 규칙, 없으면 allow다. 그 가운데 가장 엄한 것(deny > ask > allow)이 명령의 결과다. 조각을 이어야 보이는 위험(`curl * | sh *`, fork bomb)도 전체에서 잡힌다.
- floor deny는 어느 층도, `always`도, skip도 덮지 못한다. 글자 그대로 맞추므로 floor는 `rm`의 flag 순서와 `sudo` 앞붙임을 따로 적는다.
- `always`는 ask였던 조각마다 `<앞 두 낱말> *`(한 낱말이면 그 조각, 조각을 이어야 ask인 명령은 명령 전체)를 allow로 더한다. 층은 turn의 place로 정한다: project place면 그 project 층, 앱 place와 lophn이면 전역 층이다. 사람은 Settings › Shell rules에서 옮기고 고친다.
- `shell.run`의 효과는 `external`이다. 판정은 규칙이 하고, `read`면 일시 실패에 다시 돌아 같은 명령이 두 번 돈다.
- 규칙은 실수를 줄일 뿐 경계가 아니다. 따옴표와 escape를 풀지 않고, `shell.run`은 file 범위와 rewind 밖이다(`project-docs/issues/place-session.md`).

## 왜 이 모양인가

- 옛 approval은 intent 7종, grant 저장소 3, 묻는 길 2(turn 안, 보류 request와 applier), fingerprint, "이 session 동안" 허락, agent call 두 번 판정이 있었다. 할당했는데 실행 때 또 묻고, 사람이 없는 실행은 기한 없이 기다렸다. 다른 harness 다섯(Codex, OpenCode, Hermes, OpenClaw, oh-my-pi)은 모두 묻는 길이 기다리는 turn 하나이고 주 gate가 shell이다(`project-docs/products/roadmap/approval.md`).
- 보류 request 길을 지웠다. 쓰던 둘 가운데 reaction의 `ask`는 지웠고(그 reaction 설정이 없어졌다), activation 동의는 activation module이 자기 상태로 갖는다.
- 바깥 효과 tool도 묻지 않는다. "시킨 것이 승낙", "할당이 허락"을 그대로 따른 사람의 결정이다. 다시 묻기로 하면 `judge`의 `ASK_EXTERNAL_WHEN_ATTENDED` 한 줄을 켜고 할당 줄에 묻지 않을 tool 칸을 더한다.
- agent call은 묻지도 막지도 않는다. 받은 agent는 자기 할당으로만 일한다(AGENT-ROLE T5, T6). 누구를 부르는지는 지침과 workflow의 일이다.
- workflow를 쓴다는 것은 바깥 효과까지 책임지겠다는 뜻이고 사람이 loop에서 자주 빠진다. 그래서 unattended는 묻지 않고, 시작한 사람이 그 사슬 전체를 시켰으니 call을 따라 간다. skip은 사람이 그 대화에 정한 것이라 따라 가지 않는다.
- shell 규칙은 prefix와 `*`, 마지막 일치다(OpenCode, Codex). regex 사전(Hermes)과 명령 parser(OpenCode의 tree-sitter)는 쓰지 않는다. 조각의 길이를 고르는 표 없이 `<앞 두 낱말> *`로 `always`의 줄을 만든다.
- LLM judge는 넣지 않았다. 판정은 program이 결정적으로 하고 결정은 사람이 한다.
- timeout은 없다. attended에서는 대기 목록에 남고, unattended에서는 묻지 않는다.
- OS sandbox는 두지 않는다. 조사한 harness 가운데 기본으로 켜는 것은 Codex 하나다.
- 결과 본문을 믿는 문제는 판정과 따로다. web 검색과 읽기 결과만 바깥 글로 감싸고, 앱 tool과 외부 MCP 결과는 감싸지 않는다.
