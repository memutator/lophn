# approval

판정(Gate)과 사람에게 묻는 request의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/approval.md`.

## Gate 물음과 ask 기다림을 core main thread 메모리 route 둘로 둔다

```yaml
kind: defect
modules: [packages/core/approvals, packages/core/main]
```

지금: `approvals/registration.ts`의 `memoryRoutes`가 `approvalsDecideTurn`과 `toolGateCheck` 둘이다. handler는 `main/daemon/wiring/approvals.ts`가 붙이고, 허락 기다림(`approvals/turn-requests.ts`의 `entries`)과 질문 기다림(`createQuestionWaits`)이 main thread 메모리에 있다. agent runtime은 `toolGateCheck`를 긴 호출 한 번으로 부르고 결과만 받는다. 꺼졌다 켜지면 `releaseWaits`가 기다림을 `restart`로 cancelled 처리한다.

영향: 재시작이 기다리던 turn을 끊는다. 이는 의도다(turn은 메모리에서 기다리던 것이라 이어 갈 수 없다고 architecture 문서가 적었다). 단지 ledger에 안 쓰는 route가 하나 더 있고, 기다림이 main thread 한 곳에 몰려 있다.

고치려면: 추천: 남긴다(kept). 표로 옮기면 durable queue가 되어 architecture가 막은 방향이다. archived로 닫는다.

정한 것: 다이어트 계획에서 줄일지 정한다.
