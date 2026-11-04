# bare-runtime: 정의가 고른 것만 싣는 agent

- 목표: 정의에 `runtime: lophn | bare`와 한 줄 목적 `description`을 둔다. bare는 lophn 제품 규칙, place 지침, 내장 skill, 내장 tool 없이 정의 본문과 정의가 고른 tool만 싣는다. `result` call은 turn이 끝날 때 마지막 응답이 답이다.
- 재료: `project-docs/products/roadmap/agent-platform.md` 단계 3(정한 것 14~18, 뒤집는 결정 P4와 "reply로만 done"). 코드 사실과 path는 task brief에 있다.
- 범위 밖: harness runtime 값(단계 6·7이 더한다), 명함(단계 4), lophn runtime의 항목별 끄기.
- 열 때: remove-domain의 `rd-layers`와 content-block의 `cb-core`가 land한 뒤 연다. 셋이 `run-loop/`, `prompt-assembly/`, 정의 file을 같이 고친다.

## 정한 것

1. 고르는 칸은 `tools: string[]`이고 `runtime: bare`일 때만 쓴다(lophn에서 쓰면 `invalid_input`). 이름은 내장 tool(`file.read`), lophn 명령(`call.reply`), 앱 command(`<slug>.<command>`), MCP(`mcp__<server>__<tool>`)다. 명령을 고르면 `lophn` tool이 그 명령만 낸다. MCP는 고른 것만이다. (agent)
2. 상한은 그대로다. 고른 것은 그 place 종류의 목록과 할당한 앱·MCP 안에서만 보이고 돈다. credential 상한(`placeOperations`)은 place 종류로 정해지고 바뀌지 않는다. (agent)
3. bare의 system은 정의 본문 하나이고 cache 표시는 거기에 단다. 전역·project 지침(`LOPHN.md`), skill 목록, place 정보 글은 싣지 않는다. file 범위 계산(`placeData`)은 그대로 돈다. (agent)
4. 받은 메시지 경계는 tag 이름과 메시지마다 붙는 고정 글이 알린다(escape는 program). 웹 tool을 고르면 `lophn-untrusted` 한 줄을 system 끝에 붙인다. 인터넷에서 온 것은 AGENTS.md가 막는 것이다. (agent)
5. notice는 tool이 바뀐 것만 bare에 간다. 지침과 agent 목록 notice는 그 내용을 싣지 않으므로 보내지 않는다. (agent)
6. bare가 `result` call을 받은 turn이 `answer_completed`로 끝나면 core wiring(`TurnEnded`)이 마지막 응답 글을 reply로 보낸다. 글이 비거나 turn이 멈추거나 실패하면 지금처럼 call이 실패한다(`receiver_ended`). `conversation` call은 자동으로 답하지 않는다. lophn runtime은 지금처럼 reply 명령이다. (agent)
7. 새 칸(`runtime`, `description`, `tools`)은 agent도 고칠 수 있다. lophn이 이미 받는 것의 부분집합이다. 내장 lophn agent는 `runtime: bare`를 거절한다. (agent)
8. 정의를 바꾸면 지금 정의 변경과 같은 때 반영한다. 새 규칙을 만들지 않는다. (agent)

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `bare-definition` | 칸 셋, 정의 file, resolve, CLI, 편집기. 동작은 아직 lophn과 같다 |
| 2 | `bare-assembly` | bare가 model에 보내는 것: system, tool, notice |
| 3 | `bare-reply` | `result` call turn이 끝나면 마지막 응답이 답 |

## lead가 할 일

- merge마다: `architecture/agent-definition.md`(정의 칸, bare 조립, tool 목록 규칙), `agent-call.md`(bare의 답)를 고친다.
- 다 끝나면: `products/AGENT.md` P4(bare는 고른 것만, credential 상한은 그대로)와 `agent-platform.md` 단계 3을 고치고, change-log 열린 판에 동작, 결정, 첫 요청 bytes(home·project·app의 lophn vs bare 예 하나)를 적고, 계획 폴더를 지운다.
