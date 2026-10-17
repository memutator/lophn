# approval

판정(Gate)과 사람에게 묻는 request의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/approval.md`.

## 허락 뒤 `resolve`를 한 번 더 불러 intent를 다시 만든다

```yaml
kind: defect
modules: [packages/core/approvals, packages/core/lophn-agent]
```

지금: `lophn-agent/tool-judgment/tool-gate.ts`의 `check`가 `intentOf`로 `deps.resolve`를 불러 intent를 만들어 `judge`에 넘긴다. 물음이 허락으로 끝나면 `intentOf`를 한 번 더 불러 새로 만든 intent를 `consumeTurnAllow`(`approvals/turn-requests.ts`)에 넘겨 request의 지문과 비교한다. 같은 tool call에서 `resolve`가 최대 두 번 돈다(앱 app-api는 활성 release 선언을 읽고, MCP tool은 annotation을 본다).

영향: 허락과 실행 사이에 release나 선언이 바뀌어 효과가 달라진 호출을 막는 장치다(데이터·권한 경계). 대가는 허락마다 읽기 한 번이 더 든다는 것, `resolve`가 같은 입력에 같은 값을 준다고 믿는다는 것이다.

고치려면: 추천: 남긴다(kept). architecture 문서가 "실행 직전에 intent의 지문을 다시 비교한다"를 불변 조건으로 두고 있어 지우면 보호가 사라진다. 이유를 `check`의 해당 주석에 한 줄 더하고 닫는다.

정할 것: 남길지(추천: 남긴다).

## Gate 물음과 ask 기다림을 core main thread 메모리 route 둘로 둔다

```yaml
kind: defect
modules: [packages/core/approvals, packages/core/main]
```

지금: `approvals/registration.ts`의 `memoryRoutes`가 `approvalsDecideTurn`과 `toolGateCheck` 둘이다. handler는 `main/daemon/wiring/approvals.ts`가 붙이고, 허락 기다림(`approvals/turn-requests.ts`의 `entries`)과 질문 기다림(`createQuestionWaits`)이 main thread 메모리에 있다. agent runtime은 `toolGateCheck`를 긴 호출 한 번으로 부르고 결과만 받는다. 꺼졌다 켜지면 `releaseWaits`가 기다림을 `restart`로 cancelled 처리한다.

영향: 재시작이 기다리던 turn을 끊는다. 이는 의도다(turn은 메모리에서 기다리던 것이라 이어 갈 수 없다고 architecture 문서가 적었다). 단지 ledger에 안 쓰는 route가 하나 더 있고, 기다림이 main thread 한 곳에 몰려 있다.

고치려면: 추천: 남긴다(kept). 표로 옮기면 durable queue가 되어 architecture가 막은 방향이다. archived로 닫는다.

정할 것: 남길지.
