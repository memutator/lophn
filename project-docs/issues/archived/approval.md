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
