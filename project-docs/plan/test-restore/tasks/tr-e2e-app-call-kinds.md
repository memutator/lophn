# tr-e2e-app-call-kinds

`app-call_test.ts`와 `kinds_test.ts`를 다시 쓴다(README "정한 것" 표의 두 줄). app-call: agent가 앱 부르기, 큰 changeset, 사람이 부르기, net·secret loopback, 너무 큰 입력. 묻는 단계 둘과 `external_ping`은 뺀다. kinds: kind 위반이면 Gateway가 남지 않는 `KindViolationFound {domain, count}` 하나를 받고 problem과 PM session은 생기지 않는다. 켠 뒤 첫 sync는 기준만 잡는다.

- 단위: e2e (wave 2)
- 선행: tr-support-app.
- 소유(이 task만 고친다):
  - `tests/e2e/app-call_test.ts`
  - `tests/e2e/kinds_test.ts`
  - `tests/support/app/patch-call.ts`
  - `tests/support/app/patch-net.ts`
- 계약:
  - 쓰는 것: tr-support-app의 `tests/support/app/activate.ts`(`activateTestApp`, `TestApp`), `deps.ts`(`appCoreEnv`); `packages/protocol/approvals/assignment.ts`(`agentAssignmentSet`), `packages/protocol/events/transient.ts`(`KindViolationFound`), `tests/support/gateway/mod.ts`(`connectGateway`)
  - 내놓는 것: 없음

## 할 일

app-call의 grant·session-scope 단계와 `external_ping`을 지우고 준비를 새 helper로 바꾸며, kinds를 Gateway event 하나와 session 없음으로 다시 쓴다.
