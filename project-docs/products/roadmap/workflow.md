# workflow: agent들이 서로 넘기며 도는 일을 선언한다

상태: 로드맵. 2026-10-20 사람이 방향을 내고 planner가 정리했다. 미결정은 "정할 것"에 기록만 하고 정하지 않았다. 권한은 `approval.md`가 다룬다.
배경 문서: `project-docs/architecture/agent-call.md`, `project-docs/architecture/agent-definition.md`, `project-docs/architecture/domain.md`, `project-docs/architecture/eval.md`, `project-docs/products/AGENT-ROLE.md`, `project-docs/products/roadmap/headless-schedule.md`.

## 왜

- 큰 일은 agent 여럿이 역할을 나눠 서로 넘기며 돈다. 이 저장소의 eval loop가 그 예다(아래).
- lophn에는 이것을 만들 길이 없다.
  - 참가자마다 "누구에게, 언제, 어떻게 넘기나"를 알려 줄 곳이 없다. 연락처 목록은 모든 agent에게 같은 전역 목록 하나다.
  - 받는 쪽은 누가 보냈는지 모른다.
- program이 workflow를 알게 하면(단계 순서, 상태, "끝내기 전에는 call 금지", "상위 책임자에게 묻지 마") 그 코드는 domain에 기댄다. agent 성능이 오를수록 덜어내야 할 규칙이라 유지보수가 어렵고 반감기가 짧다.

## 예: eval loop

| 참가자 | 하는 일 | 규칙이 있는 곳 |
|---|---|---|
| planner(와 사람) | spec(가설, target, 예산, trial)을 쓰고 commit한다 | program: commit 안 된 spec은 돌지 않는다(`checkSpecLocked`) |
| runner | eval CLI를 돌리고, 질문 답과 채점을 새 subagent에게 시키고, `run.md`에 사실만 적는다 | skill 글(`.claude/skills/eval-run/SKILL.md`): 해석하지 않는다, 떨어진 trial만 다시 돌리지 않는다 |
| judge | item 하나를 `show` 글만 보고 채점한다. item마다 새 `haiku-xhigh`다 | program: enum과 인용을 검사하고, `오류`인 item만 다시 채점하게 한다 |
| experimenter | 판정을 해석해 `report.md`를 쓰고 다음 spec 초안을 쓴다 | skill 글(`.claude/skills/eval-experiment/SKILL.md`): 판정을 뒤집지 않는다, eval을 돌리지 않는다 |
| program | 판정 `default@1`, trial 정책, 예산 상한을 맡는다 | `tests/eval` 코드 |

- 결정적 처리와 검증(판정, 채점 검사, 예산)은 coding agent가 짠 eval 전용 program(`tests/eval`)이 한다.
- 누가 누구에게 무엇을 넘기는지는 skill 글이 말한다.
- lophn core에는 eval을 아는 코드가 없다. lophn의 workflow도 이 모양을 따른다.

## 모양

### 선언

- domain의 file `workflows/<이름>.md`에 둔다. frontmatter에 참가자와 연락처를 적고, body에는 참가자 모두가 읽는 workflow 설명을 쓴다.
  - 예: lophn 저장소 project의 `eval` domain에 eval workflow가 산다.
- 참가자는 있는 agent다: Operator, Project Manager, App Engineer, lophn.
- 연락처의 칸은 배달 방식과 한 줄 설명뿐이다.
  - `to`: 받는 참가자
  - `reply`: `none` 또는 `result`
  - `session`: `new`(judge처럼 매번 새 session인 함수) 또는 `open`(열린 session을 이어 쓰는 동료)
  - `when`: 언제 넘기나, 한 줄

```yaml
participants:
  experimenter: {role: operator, name: experimenter}
  runner: {role: operator, name: eval-runner}
  judge: {role: operator, name: judge}
contacts:
  experimenter:
    - {to: runner, reply: result, session: open, when: "spec이 commit되면 돌려 달라"}
  runner:
    - {to: judge, reply: result, session: new, when: "채점 대기 item마다"}
    - {to: experimenter, reply: none, session: open, when: "run.md를 다 쓰면"}
```

### lophn이 하는 일

1. **연락처 알리기.** 참가자인 agent의 prompt에 "이 workflow에서 너는 누구이고, 연락처는 이것이다"를 싣는다.
2. **나르기.** call은 지금처럼 Router가 나른다. 받는 쪽에는 보낸 참가자를 알린다.
3. **시작.** 사람이 시작하거나, headless run과 job(`headless-schedule.md`)이 시작한다.

### lophn이 하지 않는 일

- 단계 순서, workflow 상태, 끝 판정을 두지 않는다.
- 연락처 밖의 call을 막지 않는다. "안 끝냈으니 call 금지"와 "상위에 묻지 마" 같은 규칙도 두지 않는다.
- workflow 전용 판정과 검증을 lophn core에 두지 않는다.

### 결정적 처리와 검증

- workflow에 필요한 결정적 처리와 검증은 그 workflow의 domain 쪽 program이 한다. eval의 `tests/eval`과 같다.
- 그 program은 lophn agent가 직접 짠다. 길고 복잡하면 coding agent에게 맡길 수 있다(2026-10-21, `problem-ticket.md`).

### kind

- **agent가 이끄는 workflow.** 시작 참가자가 연락처를 따라 일을 넘긴다. eval loop가 이것이다.
- **program이 이끄는 workflow(flow).** program이 앱 tool과 agent 호출(run)을 섞어 부른다. agent 호출은 비결정적 함수다. `headless-schedule.md`에서 옮겨 왔다.

## 지금 코드

- **연락처 목록**("Agents you can call")
  - `packages/core/agent-roles/place/place-info.ts:132-145`가 그리고, `packages/core/agent-roles/place/place-data.ts:381-478`이 turn마다 읽는다.
  - 줄은 role, 이름, place와 role마다 고정된 한 문장뿐이다(`place-data.ts:73-81`). Operator 줄은 모두 "Works with the kinds and tools it was granted."다.
  - 목록은 모든 role에게 같다: 열린 session, lophn, 모든 PM, 모든 App Engineer, 모든 Operator. grant에서 `excluded`인 것만 빠진다.
  - 자리는 system block 4(place 층, cache 경계)다(`packages/core/lophn-agent/prompt-assembly/turn-prompt.ts:202-207`). 바뀌면 다음 turn에 cache miss가 한 번 나고 `agents_changed` notice가 붙는다.
- **Operator 정의**
  - `<data>/projects/<prj>/agents/<agt_id>.md` 또는 `<data>/apps/<app>/agents/<agt_id>.md`다. 칸은 `name`, `profile`, `model`, `skills`, `domains`, `mcp_off`, `mcp_servers`와 body(지침) 여덟이다(`packages/protocol/lophn-agent/operators.ts:19-34`).
  - `description` 칸이 없고, 다른 agent를 가리킬 칸도 없다.
  - 만들고 고치는 쪽은 사람(UI)과, 자기 place 안의 PM과 App Engineer(`operator.create`, `operator.update`, `packages/core/agent-roles/tools/operator.ts:117-200`)다. grant와 `mcp_servers`는 사람만 정한다.
- **call**
  - tool `call`(`packages/core/lophn-agent/tools/bundles/call.ts:26-81`)의 `to`는 세 가지다: 열린 session, `{role, place?, name?}`의 새 session, 열린 session이 없으면 새 session(`fallback: "new"`). `reply`는 `none|result|conversation`이다(`packages/protocol/lophn-agent/calls.ts:15`).
  - `conversation`은 PM, AE, coding agent만 쓴다고 tool 설명에만 적혀 있고, 코드는 막지 않는다.
  - Operator는 `{role: "operator", place, name}`으로 정확히 맞춰 푼다(`packages/core/agent-roles/place/session-directory.ts:49-75`).
- **받는 쪽이 보는 것.** `<lophn-call from="agent:ses_..." call reply>`다(`packages/core/lophn-agent/run-loop/input-text.ts:127-150`). 보낸 쪽의 role, 이름, place를 모르고, 봉투에 workflow 칸도 없다. refs 종류는 `ticket`, `problem`, `file`, `session`, `annotation` 다섯이다.
- **domain 폴더.** `<data>/domains/<dom_id>/`에 `DOMAIN.md`, `kinds.yaml`, `skills/`, `artifacts/`가 있다(`packages/protocol/domains/paths.ts`). `DOMAIN.md`, `kinds.yaml`, `skills/`는 그릇의 PM이나 App Engineer가 file tool로 쓴다. workflow를 읽는 코드는 없다.
- **agent grant.** 줄이 없으면 묻지 않고 부른다(T4, `packages/core/approvals/gate/gate.ts:85-96`). `excluded`만 막는다.
- **coding agent와 이어진 선은 App Engineer 하나뿐이다**(AGENT-ROLE 5.1).

## 무엇을 만드나

1. **선언 읽기.** domain의 `workflows/*.md`를 읽는다. 쓰는 것은 그 domain의 PM이나 App Engineer다(skill과 같다).
2. **연락처 절.** 참가자인 agent의 prompt에 workflow마다 자기 이름, 연락처, workflow 설명을 싣는다.
3. **보낸 참가자 알리기.** workflow 안의 call이면 받는 쪽 봉투에 workflow 이름과 보낸 참가자 이름을 싣는다.
4. **시작.** 시작하는 길(사람, headless run, job)에 workflow와 시작 참가자를 줄 수 있게 한다.
5. **flow.** program이 이끄는 kind다. 아래 "정할 것" 1을 정한 뒤 만든다.

## 정한 것 (사람, 2026-10-20)

- 이 workflow에서 lophn program의 책임은 작게 둔다. 선언된 workflow에 따라 call 정책과 연락처를 알려 주는 데까지다.
- "안 끝냈으니 call 금지", "상위 책임자에게 못 물어본다" 같은 딱딱한 규칙을 program에 두지 않는다. agent 성능이 오를수록 덜어내야 하고, 유지보수가 어렵고, 코드의 반감기가 짧다.
- 결정적 처리와 검증은 agent가 짜게 한다. 그래야 lophn이 domain에 기대지 않는다. 짜는 것은 coding agent다.
  - 2026-10-21에 바꿨다: lophn agent가 직접 짠다. lophn agent가 하지 않는 것은 길고 복잡한 coding agent의 일이다(`problem-ticket.md`).
- 참가자는 있는 agent다. workflow file 안에서 일회용 agent를 정의하지 않는다.
- 앞서 말한 headless run, schedule, flow도 workflow의 kind 하나로 둘 수 있다.
- workflow 안에서는 묻지 않는다. workflow로 쓴다는 것은 바깥 효과까지 책임지겠다는 뜻이다. 권한 설계는 `approval.md`(unattended mode)다.

## 정한 것 (agent)

- 연락처는 알려 주기만 하고 call을 막지 않는다. 부를 수 있는지는 grant가 정한다. 근거: 위 사람의 원칙과 `architecture/agent-call.md`의 "받은 메시지는 허락이 아니다. program이 막는 것은 이것 하나다".
- 선언은 domain에 둔다. 근거: prompt에는 맡은 domain의 것만 싣는다(`architecture/domain.md` 최소 context). skill과 같은 주인(PM, App Engineer)이 쓴다.
- 연락처 칸은 배달 방식(`to`, `reply`, `session`)과 한 줄 `when`뿐이다. 근거: Router가 이미 받는 칸이라 새 규칙이 없다.
- workflow 상태 표를 두지 않는다. 근거: 진행은 session과 call 기록(`agent_calls`)이 이미 남긴다.

## 정할 것 (기록만, 2026-10-20 정하지 않음)

1. **결정적 program이 사는 곳.** lophn agent가 직접 짠다는 것은 정했다(2026-10-21). 사는 곳은 정하지 않았다.
   - 앱이면 release와 App Engineer가 따라온다. 대신 program이 agent를 부르는 SDK(`cap-agent`)와, 앱 tool의 120초 제한과 write 직렬화 밖에서 도는 entry가 필요하다(`headless-schedule.md` "지금 코드").
   - 앱이 아니면 고정, 관측, 고칠 주인을 무엇이 맡는지 정해야 한다.
   - flow의 preview와 test에서 agent 호출을 진짜 model로 할지, 대역을 둘지도 같이 정한다.
2. **연락처를 어디에 보이나.** 새 prompt 절로 둘지, 전역 "Agents you can call" 목록에 섞을지 정한다. Operator에 `description` 칸을 더할지, 연락처의 `when`이면 충분한지도 정한다.
3. **봉투에 무엇을 싣나.** 보낸 참가자 이름과 workflow 이름이다. workflow 밖의 call에도 보낸 쪽의 role과 이름을 보일지 정한다.
4. **agent 하나가 workflow 여럿의 참가자일 때.** prompt에 모두 실을지, 받은 call의 workflow만 알릴지 정한다.
5. **place를 건너는 workflow.** domain은 그릇 하나에 속한다. 다른 그릇의 agent를 참가자로 둘 수 있는지 정한다. 다른 그릇의 domain은 공개 tool로만 참조한다는 규칙(`architecture/domain.md`)과 맞춰 본다.
6. **coding agent를 참가자로 둘 수 있나.** 2026-10-21 App Engineer가 coding agent에게 맡기는 흐름은 막았다. coding agent 연결을 얼마나 남길지는 이 물음 때문에 보류했다(`problem-ticket.md` "정할 것" 1). workflow가 coding agent 같은 다른 harness를 부를 길을 정할 때 같이 정한다.
7. **선언이 틀렸을 때.** 참가자 이름이 풀리지 않거나 꼴이 틀리면, `kinds.yaml`처럼 problem을 열지 그 줄만 뺄지 정한다.
8. **시작.** 선언에 시작 참가자를 적을지 정한다. 사람이 화면에서 workflow를 고르는 길과 CLI(`lophn workflow run`?)도 정한다.
9. **flow의 선언.** program이 이끄는 kind는 같은 file에 driver program을 적을지 정한다.
10. **`reply: conversation`.** 참가자(Operator)끼리 대화형 call을 쓸 수 있게 할지 정한다. 지금은 tool 설명만 PM, AE, coding agent로 좁힌다.
11. **비용 상한.** loop가 돌며 쓰는 model 비용의 상한을 workflow program이 지킬지, lophn이 지킬지 정한다. eval은 program이 `--budget`으로 지킨다.
12. **화면.** 사람이 workflow와 그 진행을 어디서 보나. 지금 call 진행은 사람 화면의 대상이 아니다(`architecture/event.md`). PRODUCT 4절 축 2(agent의 결과를 GUI로)와 같이 본다.

## 단계

- `headless-schedule.md`의 1단계(headless run)가 먼저다. 시작과 flow가 run을 쓴다.
- 그 뒤 계획 `workflow`로 연다: 선언 읽기, 연락처 절, 보낸 참가자 알리기, 시작. flow는 "정할 것" 1을 정한 뒤 따로 연다.

test(AGENTS.md "속도", `write-test` skill):
- 연락처가 grant를 넓히지 않는다. 연락처에 있어도 grant에서 `excluded`인 참가자는 부르지 못한다.
- 한 domain의 workflow 연락처가 그 domain을 맡지 않은 agent의 prompt에 실리지 않는다.

계획 끝에 고칠 것:
- `architecture/agent-call.md`(봉투의 보낸 참가자), `architecture/agent-definition.md`(연락처 절), `architecture/domain.md`(`workflows/`), 새 architecture 문서(workflow)
- `project-docs/products/AGENT-ROLE.md`(workflow 참가자의 넘기기)
- changelog 열린 판

## 끝남 기준

- lophn 저장소 project의 `eval` domain에 eval workflow를 선언하면, experimenter, runner, judge Operator의 prompt에 각자의 연락처가 보인다.
- runner가 judge에게 item마다 새 session으로 result call을 보내면 judge는 보낸 참가자를 알고, 답이 runner에게 돌아온다.
- lophn core에 eval을 아는 코드가 없다.

## 하지 않는 것

- **workflow 상태 machine, 단계 순서 강제, 끝 판정.** 진행은 session과 call 기록으로 본다.
- **연락처로 call 막기.** 막는 것은 grant다.
- **workflow 전용 판정과 검증을 lophn core에 두기.** domain 쪽 program이 한다.
- **workflow file 안의 일회용 agent.** 참가자는 있는 agent다.
