# workflow: domain에 선언한 참가자와 연락처를 agent에게 알린다

- **목표:** agent가 이끄는 workflow를 만든다.
  - domain의 `workflows/<이름>.md`에 참가자와 연락처를 선언한다.
  - lophn은 참가자마다 prompt에 자기 연락처를 싣고, call 봉투에 workflow와 보낸 참가자를 싣는다.
  - 단계 순서, 상태, 끝 판정은 두지 않는다.
- **재료:**
  - roadmap `project-docs/products/roadmap/workflow.md` 전체(모양, 정한 것, 정할 것)
  - architecture: `agent-call.md`(봉투, unattended는 call을 따라 간다), `agent-definition.md`(place 층, 연락처 목록, 지침은 한 번만 말한다), `domain.md`(domain 폴더), `place-session.md`, `approval.md`(turn mode)
- **범위 밖:**
  - program이 이끄는 workflow(flow)와 결정적 program이 사는 곳(roadmap "정할 것" 1, 9)
  - coding agent 참가자(roadmap "정할 것" 6, 보류. Router가 받는 곳이 coding agent인 call을 거절한다)
  - 비용 상한(roadmap "정할 것" 11)
  - workflow 화면(roadmap "정할 것" 12)
  - 새 e2e test와 eval(사람). 있는 e2e는 land가 돌리고 통과해야 한다.
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task id는 `wf-`로 시작한다.
- **시작 조건:** `headless-run`이 land했다. workflow를 사람 없이 시작하는 길이 run과 job이다.
- **brief의 기준:** brief는 2026-10-22 main(`550f75416`)에 다시 맞췄다. `headless-run`이 land하면 planner가 그 계획과 같이 고치는 file(`packages/protocol/lophn-agent/calls.ts`, `packages/protocol/lophn-agent/inputs.ts`, `packages/core/lophn-agent/session/model.ts`의 `messages` 표)의 줄만 다시 보고 연다.

## 정한 것

roadmap `workflow.md`의 "정한 것"을 따른다. roadmap "정할 것" 가운데 이 계획에 걸린 것은 아래처럼 정했다(agent, 2026-10-21. 사람이 맡긴 낮은 수준의 선택).

- **연락처는 새 prompt 절로 싣는다**(roadmap 2). 자리는 place 층(cache 경계)이고, 전역 "Agents you can call" 목록과 섞지 않는다. Operator에 `description` 칸은 더하지 않는다. 연락처의 `when`이 그 일을 한다.
- **봉투에는 workflow 안의 call일 때만 workflow 이름과 보낸 참가자 이름을 싣는다**(roadmap 3). workflow 밖 call의 `from`은 지금처럼 session이다.
- **agent 하나가 workflow 여럿의 참가자면 prompt에 모두 싣는다**(roadmap 4). workflow마다 "너는 누구이고 연락처는 이것"이다.
- **참가자는 그릇을 건널 수 있다**(roadmap 5). `{role, place, name}`으로 가리키고 Router가 지금처럼 정확히 푼다. call은 묻지도 막지도 않는다(`architecture/agent-call.md`).
- **틀린 선언은 그 file만 빼고, 이유는 읽기 tool로 본다**(roadmap 7). `workflow.list`가 domain의 선언과 각 오류를 돌려준다. toast는 띄우지 않는다.
- **시작을 따로 만들지 않는다**(roadmap 8).
  - 선언에 시작 참가자(`entry`)를 적는다.
  - 사람은 그 agent에게 말을 걸고, run과 job은 그 agent를 부른다.
  - 참가자인 agent는 늘 자기 연락처를 받으므로, 시작은 그 agent에게 일을 주는 것 하나다.
- **`reply: conversation`은 바꾸지 않는다**(roadmap 10). 연락처에는 `none`과 `result`만 쓴다.
- **쓰는 것은 그 domain의 PM이나 App Engineer다.** file tool로 쓴다. skill과 같다.

### 뼈대 검토에서 정한 것 (agent, 2026-10-21)

- **연락처는 선언에 이름이 오른 참가자 모두가 받는다.** 그 domain을 맡았는지와 상관없다.
  - 근거: 참가자가 자기 연락처를 못 보면 선언이 쓸모없다. 다른 그릇의 참가자, lophn, 그 domain을 고르지 않은 Operator도 참가자일 수 있다.
  - 참가자가 아닌 agent에게는 싣지 않으므로 최소 context는 지켜진다.
  - 그래서 읽는 쪽은 그 agent가 맡은 domain만이 아니라 모든 active domain의 선언에서 자기를 가리키는 것을 찾는다.
- **workflow의 key는 `<domain>/<이름>`이다.** 그릇 하나에 domain이 여럿이면 이름이 겹칠 수 있다. prompt, tool 입력, 봉투가 모두 이 key를 쓴다.
- **call에 workflow를 다는 법**
  - model은 `workflow`(key)만 준다. `participant`는 runtime의 call tool이 보내는 agent 자신으로부터 채운다. model이 꾸밀 수 없다.
  - 보내는 agent가 그 workflow의 참가자가 아니면 tool이 `invalid_input`을 돌려준다. 이것은 꼬리표가 틀린 것을 막을 뿐, 연락처 밖 call을 막지 않는다.
- **agent 하나가 한 workflow에서 참가자 둘로 풀리면 선언 오류다.**
- **풀리지 않는 참가자가 있으면 그 file 전체가 빠진다**(위 "틀린 선언"). 오류는 `workflow.list`에 보인다.
- **`session: open`인 연락처에는 session id를 싣지 않는다.** cache 규칙 때문이다. 지침이 `session.list`나 `fallback: "new"`를 쓰게 한다.
- **봉투의 새 칸(`workflow`, `participant`)은 optional이다.** 옛 constructor를 깨지 않고 옆에 둔다.

## 사람이 정할 것

- 없음.

## 순서

- wave와 선행은 tasks의 brief가 정한다. 계약(선언 file 꼴, 읽기 port, 봉투 칸, prompt 절)을 먼저 고정한다.

## lead가 할 일

- `schedule-job`과 같이 돌 수 있다. 두 계획이 겹치는 file은 `packages/core/agent-roles/tool-lists.ts`(`sj-jobs-tools`, `wf-decl-reader`가 각자 tool 줄을 더한다) 하나다. 나중에 land하는 lead가 rebase 때 두 쪽 줄을 다 남긴다.
- merge할 때마다 바뀐 곳의 test를 돌린다. land(`project-docs/plan/tools/lead/land.sh`)는 `deno task check:full`과 `deno task e2e`를 돈다. 이 계획은 e2e를 새로 쓰지 않지만 있는 e2e는 통과해야 한다. eval은 돌리지 않는다(사람).
- `deno task check`는 `tests/e2e`, `tests/eval`, `tests/support`도 type check하고 `tests/eval`의 test를 돈다. protocol type, route, 봉투를 바꾸는 task는 `tests/`의 쓰는 곳도 같이 고친다. 2026-10-22 main에서 찾은 쓰는 곳은 각 brief에 적었다.
- 새 module을 만들면 `project-docs/module-catalog.yaml`과 `project-docs/boundary-catalog.yaml` 줄을 lead가 그 계약 task보다 먼저, 또는 같이 commit한다. 없으면 `check-modules`가 떨어진다.
- 위험 test는 둘이다. roadmap의 둘을 `approval-simplify`와 위 결정에 맞게 바꿨다.
  - workflow 안의 call도 보낸 turn의 mode를 그대로 따른다. workflow 칸이 mode나 할당을 바꾸지 않는다.
  - workflow의 연락처는 그 workflow의 참가자가 아닌 agent의 prompt에 실리지 않는다.
- 다 끝나면
  - 새 architecture 문서(workflow)를 쓴다. `agent-call.md`(봉투), `agent-definition.md`(연락처 절), `domain.md`(`workflows/`)를 고친다.
  - `project-docs/products/AGENT-ROLE.md`에 workflow 참가자의 넘기기를 더한다.
  - roadmap `workflow.md`에서 land된 것을 지운다.
  - changelog 열린 판에 항목을 덧붙이고, 계획 폴더를 지운다.
- 사람에게 묻는 것: push. 그 밖은 planner에게 묻는다.
