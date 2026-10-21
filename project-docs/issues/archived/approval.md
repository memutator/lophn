# approval (닫음)

## 허락 뒤 `resolve`를 한 번 더 불러 intent를 다시 만든다

```yaml
kind: defect
modules: [packages/core/approvals, packages/core/lophn-agent]
closed: kept
guard: 없음
```

지금: `lophn-agent/tool-judgment/tool-gate.ts`의 `check`가 `intentOf`로 `deps.resolve`를 불러 intent를 만들어 `judge`에 넘긴다. 물음이 허락으로 끝나면 `intentOf`를 한 번 더 불러 새로 만든 intent를 `consumeTurnAllow`(`approvals/turn-requests.ts`)에 넘겨 request의 지문과 비교한다. 같은 tool call에서 `resolve`가 최대 두 번 돈다(앱 app-api는 활성 release 선언을 읽고, MCP tool은 annotation을 본다).

영향: 허락과 실행 사이에 release나 선언이 바뀌어 효과가 달라진 호출을 막는 장치다(데이터·권한 경계). 대가는 허락마다 읽기 한 번이 더 든다는 것, `resolve`가 같은 입력에 같은 값을 준다고 믿는다는 것이다.

고치려면: 추천: 남긴다(kept). architecture 문서가 "실행 직전에 intent의 지문을 다시 비교한다"를 불변 조건으로 두고 있어 지우면 보호가 사라진다. 이유를 `check`의 해당 주석에 한 줄 더하고 닫는다.

닫음: 남긴다. 허락과 실행 사이에 효과가 바뀐 호출을 막는다.

## Gate 물음과 ask 기다림을 core main thread 메모리 route 둘로 둔다

```yaml
kind: defect
modules: [packages/core/approvals, packages/core/main]
closed: kept
guard: 없음
```

지금: `approvals/registration.ts`의 `memoryRoutes`가 `approvalsDecideTurn`과 `toolGateCheck` 둘이다. handler는 `main/daemon/wiring/approvals.ts`가 붙이고, 허락 기다림(`approvals/turn-requests.ts`의 `entries`)과 질문 기다림(`createQuestionWaits`)이 main thread 메모리에 있다. agent runtime은 `toolGateCheck`를 긴 호출 한 번으로 부르고 결과만 받는다. 꺼졌다 켜지면 `releaseWaits`가 기다림을 `restart`로 cancelled 처리한다.

영향: 재시작이 기다리던 turn을 끊는다. 이는 의도다(turn은 메모리에서 기다리던 것이라 이어 갈 수 없다고 architecture 문서가 적었다). 단지 ledger에 안 쓰는 route가 하나 더 있고, 기다림이 main thread 한 곳에 몰려 있다.

고치려면: 추천: 남긴다(kept). 표로 옮기면 durable queue가 되어 architecture가 막은 방향이다.

닫음: 표로 옮기면 durable queue가 되어 architecture 문서가 막은 방향이다. 재시작이 기다리던 turn을 끊는 것은 의도다.

## Grants 화면에서 agent 부르기를 빼도 core는 그 call을 허락한다

```yaml
kind: bug
modules: [packages/shell/renderer]
closed: fixed
guard: packages/shell/renderer/workspace/agents/editor/grants-model_test.ts
```

지금: `packages/shell/renderer/workspace/agents/editor/grants-panel.tsx`는 agent grant에 줄이 있는 대상만 부를 수 있는 목록에 보이고, 끄면 `grants-model.ts`의 `withSimplePick`이 그 줄을 지운다. core의 Gate(`packages/core/approvals/gate/gate.ts`의 `agent_call`)는 줄이 없으면 묻지 않고 허락하고(AGENT-ROLE T4) `excluded` 줄만 거절한다. 화면에는 `excluded`를 고르는 길이 없고, `excluded` 줄은 기본 설정으로 보인다(`ask: undefined`). 계획 `e2e-coverage`에서 사람이 "agent 줄에 `excluded`를 더한다"로 정했을 때 core와 protocol만 바뀌었다.

영향: 사람이 화면에서 어떤 agent 부르기를 빼면 막았다고 보지만, 그 agent는 묻지 않고 부를 수 있다. 화면이 보이는 권한과 실제 권한이 반대다.

고치려면: 목록은 catalog의 모든 agent를 보이고, 줄 없음은 "기본(부를 수 있음)", 끄기는 `excluded` 줄로 쓴다. 대화 tab의 grant 표시(`packages/shell/renderer/conversation/agent-tab-core-source-sessions.ts`)는 이미 `excluded`를 거절로 보인다. 작음.

닫음: 부르기 목록은 catalog의 모든 agent를 보인다. 줄이 없으면 켜진 기본이고, 끄면 그 agent의 줄을 `excluded`로 쓰고(`grants-model.ts`의 `withCallPick`), `excluded` 줄은 꺼진 것으로 보인다(`callPick`). "Add agent" menu는 지웠다.

## grant read가 `sessions` 표를 SQL로 직접 읽는다

```yaml
kind: defect
modules: [packages/core/approvals, packages/core/lophn-agent]
closed: fixed
guard: `packages/core/approvals/grants/reads_test.ts`
```

지금: `agentGrantsGetRead`(`packages/core/approvals/grants/reads.ts`)는 agent actor의 자기 ref를 만들려고 lophn-agent의 `sessions` 표를 `select role, project, app, operator from sessions where id = ?`로 직접 읽는다. approvals가 lophn-agent를 import하지 않으려고 이렇게 했다. module이 남의 표를 SQL로 읽지 않는다는 규칙에 어긋나고 `check-deps`는 이를 잡지 않는다.

영향: `sessions` 표의 칸 이름이나 모양이 바뀌면 grant read가 소리 없이 `forbidden`이 되고, 그러면 place prompt의 "Agents you can call"에서 session 없는 상대가 모두 빠진다(실패한 grant read는 후보를 싣지 않는다).

고치려면: 호출하는 쪽(`packages/core/agent-roles/place/place-data.ts`)이 이미 가진 자기 ref를 믿지 않고, router의 `callGate`처럼 wiring에서 actor의 ref를 풀어 read context로 넘긴다(중간). 또는 lophn-agent가 actor→ref read를 내고 approvals가 그것을 부른다(작음). 추천은 뒤의 것이다.

닫음: approvals가 port `AgentOfSession`(`packages/core/approvals/grants/ports.ts`)을 내고, lophn-agent의 `agentOfSession`(`packages/core/lophn-agent/session/actor-ref.ts`)을 reader registration(`packages/core/main/daemon/wiring/lophn-agent-registration.ts`)이 끼운다. agent는 자기 grant만 읽고, 풀지 못한 session은 `forbidden`이다. approvals는 lophn-agent를 import하지 않는다.

## shell floor deny가 `rm -rf /`의 그 글자 모양만 막는다

```yaml
kind: bug
modules: [packages/protocol, packages/core/approvals]
closed: fixed
guard: packages/core/approvals/gate/judge_test.ts의 "floor deny와 사람이 쓴 deny 규칙은 unattended와 skip에서도 막는다"
```

지금: `packages/protocol/approvals/shell-rules.ts`의 `PRODUCT_SHELL_RULES.floor`는 `rm -rf /`, `rm -rf ~`, `rm -rf ~/`, `rm -rf /\*`, `rm -rf ~/\*`, `mkfs*`, `dd * of=/dev/*`, fork bomb이다. `packages/core/approvals/gate/shell-match.ts`의 `shellRuleMatches`는 공백만 줄이고 글자를 그대로 맞춘다. 그래서 `rm -fr /`, `rm -r -f ~`, `rm -rf --no-preserve-root /`, `sudo rm -rf /`는 floor에 맞지 않고 제품 기본 ask(`rm -r*`, `rm -fr*`)에만 맞는다. `judge`(`packages/core/approvals/gate/judge.ts`)는 ask를 unattended·skip에서 `run`으로 바꾼다.

영향: skip session이나 unattended run에서 agent가 flag 순서만 다른 `rm -fr ~`를 실수로 부르면 묻지도 막지도 않고 사람의 home이 지워진다. AGENTS.md "속도"가 막으라는 agent 실수(데이터 잃기)다. skip은 이 계획의 wave 3, unattended 입구는 `headless-run`부터 열린다.

고치려면:
- floor에 flag 순서 변형을 더한다(`rm -fr`, `rm -r -f`, `rm -f -r`, `--no-preserve-root`, `sudo` 앞붙임 × `/`, `~`, `~/`, `/\*`, `~/\*`). 작음. 목록이 길어지고 다른 변형(`$HOME`, `/home/<사람>`)은 여전히 빠진다.
- `rm`의 짧은 flag 묶음을 정규화한 뒤 맞춘다(`-fr`·`-r -f`를 `-rf`로). 작음~중간. roadmap "하지 않는 것"의 명령 parser에 한 걸음 다가간다.
- 그대로 둔다. roadmap "규칙은 실수를 줄일 뿐 경계가 아니다".

추천: 첫째에서 `rm -fr`·`rm -r -f`·`rm -f -r`와 `sudo` 앞붙임만 더한다. 계약 file 한 곳의 목록이고, 사람 없는 run에서 home을 잃는 길 가운데 흔한 것을 닫는다.

정한 것(사람, 2026-10-21): 추천대로 넓힌다.

닫음: `PRODUCT_SHELL_RULES.floor`가 `rm`의 flag 순서 넷(`-rf`, `-fr`, `-r -f`, `-f -r`)과 대상 다섯(`/`, `~`, `~/`, 글자 그대로의 `/*`·`~/*`)의 곱, `mkfs*`, `dd * of=/dev/*`를 `sudo` 앞붙임 있이와 없이 둘 다 막는다. ask에 `rm -f -r*`를 더했다. `--no-preserve-root`, `$HOME`, `/home/<사람>`은 여전히 floor 밖이다(규칙은 경계가 아니다).
