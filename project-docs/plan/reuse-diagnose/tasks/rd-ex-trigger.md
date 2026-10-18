# rd-ex-trigger

완료 보고가 나면 program이 예시를 돌리게 하고, 결과가 나오면 ticket의 check 결과로 남긴다. 그러면 `ticket.verify`의 관문(`rd-ex-shape`)이 열린다.

- 단위: rd-ex (wave 4)
- 선행: rd-ex-request. `requestExamples`와 kind `examples` 접수가 거기서 생긴다.
- 소유(이 task만 고친다):
  - `packages/core/apps/tickets/checker/handler.ts`
  - `packages/core/apps/tickets/checker/mod.ts`
  - `packages/core/apps/tickets/mod.ts`
- 읽을 것:
  - issue: `project-docs/issues/coding-agent.md`의 "ticket의 `test_command` check를 runner가 돌리지 않는다"
  - architecture: `project-docs/architecture/coding-agent.md`, `project-docs/architecture/testing.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-tickets`, `events`
  - 코드: `packages/core/apps/tickets/checker/handler.ts`(지금 `TicketCompletionReported`가 깨우면 check_work를 읽고 `checkOutcomeOf`로 결과를 한 번 `RecordTicketChecks`한다), `checker/result.ts`(`examples`는 검증 행을 찾아 결과를 낸다. `rd-ex-shape`), `packages/core/main/daemon/wiring/apps-tickets.ts`(handler를 `ctx.reactor.on`으로 등록하고 machine 자격으로 `TicketCheckWork`·`RecordTicketChecks`를 부른다), 이벤트 `VerificationRecorded`(`packages/protocol/problems/tests.ts`, payload에 `kind`, `ticket: { ticket, completion_seq, … }`)
- 계약:
  - 쓰는 것: `requestExamples`(`rd-ex-request`), 이벤트 `VerificationRecorded`, `TicketCheckWork`, `RecordTicketChecks`
  - 내놓는 것: `TicketCheckClient`에 `requestExamples(input: { ticket, completion_seq }, idempotencyKey)`가 생긴다. handler 둘: `TicketCompletionReported`용(기존 이름 `ticket-check`)과 `VerificationRecorded`용(`ticket-check-examples`).

## 할 일

1. `handler.ts`: `TicketCompletionReported` handler에서 `work.check.kind === "examples"`이면 `client.requestExamples(…)`만 부르고 끝낸다(결과를 지금 남기지 않는다. 검증이 끝나면 아래 handler가 남긴다). 그 밖의 kind는 지금과 같다. 요청 오류는 그대로 올려 Reactor가 다시 시도하게 한다(재전송은 `request_key`가 하나로 묶는다).
2. `VerificationRecorded`를 깨우는 handler `createExamplesCheckHandler(client)`를 더한다: payload의 `kind`가 `examples`이고 `ticket`이 있을 때만, `client.work({ ticket, completion_seq })`로 사실을 읽어 `checkOutcomeOf`로 결과를 정해 `RecordTicketChecks`한다(이미 새 보고가 났거나 conflict이면 아무것도 하지 않는다는 기존 규칙을 그대로 쓴다). 두 handler가 읽기·쓰기 부분을 나누어 쓰도록 한 함수로 뽑는다(복사하지 않는다).
3. `checker/mod.ts`·`tickets/mod.ts`에서 새 handler를 내보낸다.
4. 이 task는 `wiring/apps-tickets.ts`를 고치지 않는다(lead 몫). 필요한 변경을 "등록할 것"에 정확히 적는다.
5. 위험 test는 없다: handler는 `rd-ex-shape`의 관문과 `rd-ex-driver`의 비교 test가 이미 보는 규칙을 잇는 배선이다. 기존 `tickets_test.ts` 쪽 handler test가 있으면 새 분기를 한 행으로 더한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(위 5).
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 `wiring/apps-tickets.ts`에서 (1) `ticketMachineContext.scope.operations`에 `RequestTest`를 더하고, (2) client에 `requestExamples`를 `requestExamples(deps)`(`rd-ex-request`)로 잇고, (3) `ctx.reactor.on("VerificationRecorded", createExamplesCheckHandler(client))`를 더한다.
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 보고 → 요청 → 실행 → 기록 → 결과 → verify의 전체 흐름은 자동 test가 없다(process를 여럿 건너는 E2E는 사람에게 먼저 묻는다). lead가 등록을 마친 뒤 core를 띄워 한 번 손으로 본다.
