# agent-card: A2A의 명함과 시야

- 목표: agent마다 명함(이름, 한 줄 목적, runtime, modality, 답 방식, 기본 lophn agent와의 차이)을 program이 만들고, 부르는 agent가 읽고, 받지 못하는 call은 Router가 보낼 때 거절한다.
- 재료: `project-docs/products/roadmap/agent-platform.md` 단계 9와 단계 3의 남은 것(bare skill). 코드 사실과 path는 task brief에 있다.
- 범위 밖: third-party harness의 능력 선언(단계 7), 발견 범위(agent는 전역), 넘기기 효과를 재는 eval(실제 model 호출이라 사람이 정할 때).

## 정한 것

1. model에 가는 자리는 둘이다. place 정보의 "Agents you can call"은 이름 옆에 `description` 한 줄을 싣고, 전체 명함은 `lophn agent card <name>`으로 읽는다. 차이는 system prompt에 싣지 않는다(cache). notice 기준(basis)에 description을 넣는다. (agent)
2. 차이는 program이 계산하고 place와 상관없다: 할당한 앱의 public command와 public skill, 정의 층 MCP server 이름, `skills_off`, runtime. bare는 `− lophn 내장`과 고른 `tools`를 적힌 그대로 보인다. prompt 원문은 보이지 않는다. (agent)
3. modality는 정의의 새 칸 `modality: {input?, output?}`이고 값은 `text`, `image`, `file`이다. 없으면 셋 다다. Router는 agent가 보낸 call의 block(image → `image`, `resource_link`·`resource` → `file`)을 받는 agent의 `input`과 대조해 `invalid_input`으로 거절한다. 사람 메시지와 workflow step 입력은 보지 않는다. model이 이미지를 못 받으면 명함이 그렇게 알린다(거절하지 않는다). (agent)
4. 답 방식은 칸 없이 program이 정한다. lophn은 `none`, `result`, `conversation`. bare는 `none`, `result`, 그리고 `call.reply`를 골랐으면 `conversation`. 받지 못하는 답 방식의 call도 Router가 `invalid_input`으로 거절한다. (agent)
5. `agent.card`는 모든 place 종류에서 읽을 수 있다. 사람 화면(agent 목록 카드, 편집기)도 같은 명함을 보인다. (agent)
6. 시야는 place 정책이 크게 정하고 agent 정책이 예외로 덧쓴다(사람, 2026-11-04: place마다 agent가 10개면 agent마다 고르는 경우의 수가 너무 많다). 기본: 같은 place 허용, project·app → home 허용, home → project·app 허용, 다른 project·다른 앱으로는 거절. (사람·agent)
7. 다른 place에서 불려 home에 열린 session은 폴더를 읽지 않고 실어 보낸 것만 본다. home의 전역 agent(Image Generator)가 부른 쪽과 상관없는 project를 보지 않게 한다. (사람, 2026-11-04 추천대로)
8. 정책은 설정 하나 `call_policy`에 있다. 거절은 `forbidden`이다. 사람이 보낸 call과 workflow step은 보지 않는다. (agent)
9. bare는 다 덜어진 상태에서 사람이 더한다. skill도 더한다(사람, 2026-11-04). (사람)

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `card-read` | `modality` 칸, 명함 계산, `lophn agent card` |
| 2 | `card-check` | Router가 modality와 답 방식으로 거절 |
| 3 | `card-show` | place 목록의 한 줄 목적, notice 기준, 사람 화면 |
| 4 | `card-policy` | place 정책과 agent 예외, home 좁히기, 명함의 `callable` |
| 5 | `bare-skills` | bare가 skill을 더한다 |

## lead가 할 일

- merge마다: `architecture/agent-definition.md`(정의 칸, 명함), `agent-call.md`(Router 거절)를 고친다.
- 다 끝나면: `agent-platform.md` 단계 9와 3의 남은 것을 끝남으로 적고, change-log 열린 판에 동작과 결정을 적고, 계획 폴더를 지운다. 넘기기 효과를 재는 eval은 실제 model 호출이므로 돌릴지 사람에게 묻는다.
