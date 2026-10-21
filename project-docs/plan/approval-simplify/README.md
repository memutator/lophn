# approval-simplify: 할당이 허락이고, 묻는 길은 기다리는 turn 하나다

- **목표:** approval을 roadmap `approval.md`의 모양으로 줄인다.
  - 묻는 길은 기다리는 turn 하나다.
  - 실행 때 묻는 것은 바깥 효과 tool과 shell 규칙의 `ask` 둘뿐이다.
  - turn mode(attended, unattended, skip)가 물을지를 정한다.
- **재료:**
  - roadmap `project-docs/products/roadmap/approval.md` 전체. 그 "정한 것"이 근거다.
  - architecture: `approval.md`, `agent-call.md`, `event.md`, `activation.md`, `agent-definition.md`, `place-session.md`
  - `project-docs/boundary-catalog.yaml`과 `project-docs/module-catalog.yaml`의 approvals, router, apps
- **범위 밖:**
  - coding harness 물음의 자동 답(맡기는 흐름이 막혀 있다. `problem-ticket.md`)
  - run과 job(`headless-run`, `schedule-job`). 이 계획은 turn mode와 그 전파까지만 만든다.
  - reaction 자체(`problem-remove`, `ae-builds`, `reactor-remove`)
  - eval과 e2e test(사람)
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task id는 `ap-`로 시작한다.
- **시작 조건:** `problem-remove`가 land했다.
- **brief의 기준:** brief는 2026-10-21 main(`e192a9d8c`) 기준으로 썼다. `problem-remove`가 land하면 planner가 path와 계약을 다시 맞춘 뒤 연다.

## 정한 것

roadmap `approval.md`의 "정한 것(사람)"과 "정한 것(agent)"을 그대로 따른다. 아래는 이 계획에서 더 정한 것이다.

- **reaction이 연 turn은 attended다(agent).** 이 계획이 돌 때 남은 reaction은 `ReleaseActivationFailed` 하나이고, `ae-builds`가 그것도 지운다. roadmap "정할 것" 2는 그 뒤 없어진다.
- **reaction 설정은 `off | on`이다.** `ask`가 없어져 보류 request 길이 필요 없다.
- **activation 동의는 activation module의 상태와 사람의 동의 command로 옮긴다.** 대기 목록에 같이 보인다. 지금 `approval_requests`를 쓰는 둘(activation, reaction ask)이 모두 빠지므로 표를 지운다.
- **unattended는 call 봉투에 싣는다.** 받는 turn의 mode는 그 입력이 unattended call이면 unattended다. 이 계획에서 unattended를 여는 입구는 아직 없다(`headless-run`이 연다). 그래서 이 계획의 test는 봉투에 표시를 직접 넣어 본다.
- **skip은 session 표시와 Operator 정의의 기본값 칸이다.** 정의 칸은 사람만 쓴다(PM과 App Engineer의 `operator.update` 입력에서 뺀다).
- **shell 규칙은 제품 기본, 전역, project 세 층이고, Settings에 둔다.** 제품 기본 목록(floor deny, 위험 ask)은 계획에서 정한다. 짧게 시작한다.
- **화면 바꾸기(대기 목록, 할당 편집, skip, shell 규칙 설정)는 `ui-design` skill로 wireframe부터 고친다.** 문구는 `wording` skill을 따른다.

### 뼈대 검토에서 정한 것 (agent, 2026-10-21)

- **shell 규칙의 pattern**
  - `*`는 아무 글자에나 맞는다. `*`가 없는 pattern은 그 명령과 똑같을 때만 맞는다.
  - 명령 전체와, `&&`·`||`·`;`·`|`로 나눈 조각 각각에 규칙을 대고, 가장 엄한 것(deny > ask > allow)을 쓴다. 그래야 `curl * | sh`나 fork bomb처럼 조각을 이어야 보이는 위험도 잡힌다.
- **pattern에서 `\*`는 글자 그대로의 `*`다.** 제품 floor deny에 `rm -rf /\*`와 `rm -rf ~/\*`를 둔다. `*`가 "아무 글자"뿐이면 이 둘을 floor에 둘 수 없어, 사람 없는 run에서 그대로 돈다(AGENTS.md가 막으라는 agent의 data 잃기).
- **할당 줄은 `{app, removed_tools}`만 둔다.** 저장은 revision으로 겹쳐 쓰기를 막는다.
- **shell turn request는 `always`가 더할 줄(`always_patterns`)을 싣고, card가 그것을 보인다.** 사람이 무엇을 허락하는지 본다.
- **`always`는 `ask`였던 조각마다 `<앞 두 낱말> *` 줄을 더한다.** 한 낱말 명령은 그 명령 그대로다. floor deny는 덮지 못한다. 근거: 조각의 길이를 고르는 표(OpenCode의 arity 표)를 두지 않는 가장 단순한 길이다.
- **`shell.run`의 효과는 `external`로 둔다.** 판정은 효과가 아니라 shell 규칙으로 하고, 효과는 기록과 재시도에만 쓰인다. `read`면 일시 실패에 한 번 다시 돌아 같은 명령이 두 번 돈다.
- **MCP server는 설정한 층이 곧 할당이다.** 전역에 둔 server는 모든 agent, project에 둔 것은 그 project의 agent, Operator 정의에 둔 것은 그 Operator에게 할당된 것이다. 끄기는 지금의 `mcp_off`다. agent 할당 줄은 앱만 둔다. 근거: MCP server를 설정하는 것 자체가 사람의 결정이라 줄을 또 두면 같은 허락을 두 번 받는다.
- **unattended는 call만이 아니라 그 call의 답과 늦게 오는 실패, 취소 알림에도 실린다.** 그러지 않으면 unattended 사슬의 답 turn이 attended가 되어 shell `ask`에 멈춘다.
- **turn mode의 순서는 unattended 입력 → session skip → attended다.** skip인 session도 unattended call로 열린 turn은 unattended다. skip이 먼저면 headless 사슬 안의 skip Operator가 표시를 떨어뜨려, 그 뒤가 모두 attended가 되어 사람 없이 shell `ask`에 멈춘다.
- **turn mode의 type은 `packages/protocol/lophn-agent`에 둔다.** `protocol/approvals`가 이미 `protocol/lophn-agent`를 import해서, 거꾸로 두면 `protocol-cycle`이다.
- **unattended 표시는 받은 메시지에 남기지 않는다.** call 봉투, `RoutedInput`, `agent_calls`에만 싣는다. mode는 메모리의 입력에서 오고 결과는 `turns.mode`에 남는다.
- **turn mode는 turn을 시작할 때 정하고 그 turn 동안 바뀌지 않는다.** 도는 turn에 사람이 steer한 메시지도 그 turn의 mode를 따른다.
- **fork는 skip을 가져가지 않는다.** 새 session은 Operator 정의의 기본값으로 시작한다. "이 session 동안" 허락을 fork가 가져가지 않는 것과 같은 이유다(`architecture/place-session.md`).
- **CLI의 `--dangerously-skip-permissions`는 두지 않는다.** CLI가 여는 run은 처음부터 unattended라 묻지 않는다(`headless-run`). roadmap의 그 줄은 lead가 끝에 지운다.
- **activation 동의 대기는 ledger 표에 둔다.** 메모리에만 두면 재시작 때 사라지는데, Reactor cursor는 `TicketVerified`를 이미 지나 다시 묻지 않는다.
- **새 할당 표와 route, 새 event 이름은 옛것 옆에 두고, cleanup이 옛것을 지운다.** core와 화면이 따로 옮겨 가도 merge마다 compile된다.
- **cleanup은 이 계획이 죽게 한 것을 지운다.** `toolDecisionSchema`의 `approval`, 옛 `effect` enum, `comparison_basis`, `contract_revision`, rewind 사실의 `approval_decision`처럼 읽는 곳이 없어진 것이 대상이다. agent 정의의 `safe_tools`와 `permissions`는 `agent-definition` 계획의 일이다.

## 사람이 정할 것

1. **할당한 domain tool의 바깥 효과를 attended에서 물을까**(roadmap "정할 것" 1).
   - 추천은 묻지 않는 것이다. "시킨 것이 승낙", "할당이 허락"을 그대로 따른다. 그러면 attended에서 묻는 것은 shell 규칙의 `ask`만 남는다.
   - brief는 추천대로 썼다. 사람이 "묻는다"로 정하면 Gate의 바깥 효과 줄 하나와 할당 줄의 "묻지 않음" 칸을 되살린다.

## 순서

- wave와 선행은 tasks의 brief가 정한다.
- 지우기(보류 request 길, call 판정, fingerprint, "이 session 동안", `settings_edit`, `app_resource`, 옛 protocol file, 앱 호출의 `askGate`)를 먼저 하고, 더하기(turn mode, shell 규칙, skip, `always`의 줄 더하기, 할당 편집 정리)를 뒤에 한다.

## lead가 할 일

- merge할 때마다 바뀐 곳의 test를 돌린다. e2e와 eval은 돌리지 않는다(사람).
- land는 `LOPHN_LAND_SKIP_E2E=1 land.sh approval-simplify`다. 사람이 lead session에 "e2e를 건너뛰고 land해도 된다"고 직접 말해야 한다(orchestrate skill).
- wave 2는 한꺼번에 land한다. 반만 land하면 할당된 tool이 하나도 안 뜨거나, activation 동의 card가 없다.
- wave 1이 land하면 `LOPHN.md` 쓰기, Operator 고치기, 바깥 효과 앱 tool, agent call이 더는 묻지 않는다. 의도한 것이다.
- 다 끝나면
  - 문서: `architecture/approval.md` 전체, `agent-call.md`(call 판정, 봉투의 mode), `event.md`(지운 event), `activation.md`(동의), `agent-definition.md`(skip 칸), `app-call.md`(Gate 단계와 사람 대기)
  - `project-docs/products/AGENT-ROLE.md`: H3, H4, T3, T4, 6절
  - roadmap `approval.md`에서 land된 것을 지운다.
  - changelog 열린 판에 항목을 덧붙이고, 계획 폴더를 지운다.
- 사람에게 묻는 것: push, 위 "사람이 정할 것". 그 밖은 planner에게 묻는다.
