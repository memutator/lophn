# code-health

여러 module에 걸친 코드 건강 이슈다(죽은 이름, 긴 파일, test 준비 코드). 짝이 되는 architecture 문서는 없다.

## test 준비 코드가 길다

```yaml
kind: defect
modules: [packages/core/approvals, packages/core/apps]
```

지금: test 수는 적은데 파일마다 준비 코드(setup)가 길다. `apps/calls/calls_test.ts` 344줄(test 3개, 앞 120줄 남짓의 `setup()`과 helper가 앱 process·invocation ledger를 메모리로 흉내), `approvals/approvals_test.ts` 336줄(test 3개, `openLedger`로 임시 ledger를 열고 `makeKit`으로 조립), `apps/rewind/rewind_test.ts` 278줄(test 4개, `DatabaseSync(":memory:")`와 `setup`), `approvals/gate/gate_test.ts` 250줄(test 2개, 대부분 grant·intent fixture). 쓰는 준비가 파일마다 달라서 "공용 ledger fixture 하나"로 모이는 모양이 아니다. calls와 gate는 ledger를 쓰지도 않는다.

영향: 같은 파일에 test 하나를 더하는 비용이 준비 코드를 읽는 데서 든다. 다만 test를 적게 두는 것이 AGENTS.md의 방향이라 test가 늘 일이 적다.

고치려면:
- A. 공용 fixture로 모은다. 파일마다 준비 모양이 달라 억지로 맞추면 오히려 무거워진다. 비용 중간.
- B. 건드리지 않는다. 그 파일에 test를 더할 때 필요한 만큼만 helper로 뺀다.
- 추천: B. 안 쓰는 test는 AGENTS.md 지침대로 합치거나 지운다.
