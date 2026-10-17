# approval-reads

activation이 approvals의 request 읽기(`request(id)`, `pending()`)를 위해 `main/daemon/wiring/approval-reads.ts`가 ledger를 따로 열어 `approvals/rows.ts`를 건너 읽는다. approvals가 그 읽기를 공개 API(`Approvals` port)로 내고, `wiring/apps.ts`가 그것을 activation에 끼우고, `approval-reads.ts`를 지운다.

- 단위: approval-reads (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/approvals/ports.ts`
  - `packages/core/approvals/approvals.ts`
  - `packages/core/approvals/ledger.ts`
  - `packages/core/approvals/routes.ts`
  - `packages/core/approvals/reads.ts`
  - `packages/core/approvals/registration.ts`
  - `packages/core/approvals/mod.ts`
  - `packages/core/approvals/approvals_test.ts`(fixture가 새 메서드 때문에 깨질 때만)
  - `packages/protocol/approvals/requests.ts`(`approvalsPending.actors`에 `machine`을 더할 때만)
  - `packages/core/main/daemon/wiring/approvals.ts`(`APPROVALS_CONTEXT` scope만)
  - `packages/core/main/daemon/wiring/apps.ts`(import와 `activation.attach`의 `approvals` 칸만)
  - `packages/core/main/daemon/wiring/approval-reads.ts`(지운다)
- 읽을 것:
  - 이슈: `project-docs/issues/activation.md`의 "activation 요청 읽기(`approval-reads.ts`)가 approvals의 내부 파일을 직접 읽는다"(정한 것 있음. 닫는 일은 lead가 한다)
  - architecture: `project-docs/architecture/approval.md`("보류 request의 적용", 허락의 접수와 적용 성공을 따로 기록), `project-docs/architecture/activation.md`("계기와 묻는 조건", `ApprovalDecided`가 handler를 다시 부름)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `approvals`, `apps`, `core`, `project-docs/module-catalog.yaml`의 `packages/core/approvals`, `packages/core/apps`, `packages/core/main`
  - 본보기: `approvalsUnapplied`(`approvals/routes.ts`, `approvals/reads.ts`)와 그것을 읽는 `ApprovalLedger.unapplied()`(`approvals/ledger.ts`). 같은 꼴로 읽기를 더한다.
- 계약:
  - 쓰는 것: `packages/core/apps/releases/activation/handler.ts`·`assembly.ts`의 activation `approvals` 칸 — `request(id): Promise<Result<PendingApproval | null>>`, `pending(): Promise<Result<PendingApproval[]>>`. 이 모양은 바꾸지 않는다.
  - 내놓는 것: `Approvals` port(`approvals/ports.ts`)에 `request(id: string): Promise<Result<PendingApproval | null>>`, `pending(): Promise<Result<PendingApproval[]>>`.

## 지켜야 할 것(계획 README 그대로)

- module은 `core/main`을 import하지 않는다. 바닥은 위층을 import하지 않는다. domain끼리는 problems → apps만.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 설치 사본은 읽기 전용이고 release bundle에 굳힌 사본과 섞지 않는다.

이 task는 첫째·둘째와 직접 닿는다: approvals 밖(wiring)이 approvals의 표(`approval_requests`)와 `rows.ts`를 SQL로 읽던 경계 위반을 없애는 일이다. 지운 뒤 wiring은 `rows.ts`·`REQUEST_COLUMNS`·`loadRequest`를 import하지 않는다.

## 알고 시작할 것

- 지금 모양: `wiring/apps.ts`의 `activation.attach({ approvals: { createPending, cancelPendingFor, request, pending } })`에서 `request`와 `pending`만 `approvalLedgerRead(ctx.ledgerPath)`(호출마다 `openConnection`으로 ledger를 새로 연다)에서 온다. 나머지 둘은 이미 `ctx.approvals`(= `ApprovalsService`)에서 온다.
- `ApprovalsService`는 `createApprovals({ ledger, ... })`로 만들고, `ledger`(`ApprovalLedger`)는 wiring이 `createApprovalLedger({ command, read })`로 만든다. `read`는 `ctx.runtime.readers.read(route, APPROVALS_CONTEXT, input)`이다. `APPROVALS_CONTEXT`의 `scope.operations`에 든 route만 읽는다(지금 `approvalsUnapplied.name`이 들어 있다).
- `approvalsPending`(`protocol/approvals/requests.ts`)은 사람(`user`)만 부르는 read이고, 그 handler(`approvalsPendingRead`)는 `approval_requests`의 pending 전부를 `requestOf`로 읽어 돌려준다(커서 없음). `approvalsGet`/`approvalsList`(`protocol/approvals/approvals.ts`)는 모양이 다른 `approvalRequestSchema`다. 보류 request(`PendingApproval`)와 같은지 확인하고, 다르면 쓰지 않는다.
- `ctx.approvals`의 type은 `Approvals` port다(`ctx.provide("approvals", service)`). `calls/gate.ts`·`tool-judgment`도 이 port를 쓰므로 메서드를 더해도 호출하는 쪽은 안 깨진다. `Approvals`를 직접 구현한 대역이 있으면 같은 변경에서 고친다(`grep -rn "Approvals" packages --include=*_test.ts`로 찾는다. 지금은 `approvals_test.ts`가 `createApprovals`를 쓸 뿐이다).

## 할 일

1. `approvals/ports.ts`의 `Approvals`에 `request(id)`와 `pending()`을 더한다. 근거: 이슈 "고치려면"(공개 API로 내놓는다), `approvals/ports.ts`의 `Approvals`가 "Gate를 부르는 쪽이 쓰는 한 입구"라는 주석.
2. 읽기 route를 더한다. 근거: `ApprovalLedger`가 표에 닿는 유일한 길이라는 `approvals/ledger.ts` 머리 주석, `approvalsUnapplied` 본보기.
   - `request(id)`: `approvals/routes.ts`에 `core 안에서만 쓰는 machine read`를 하나 더한다(예: `approvalsRequest`, 입력 `{ request: idSchema("apr") }`, 출력 `withReadCommon(z.object({ request: pendingApprovalSchema.nullable() }))`, `actors: ["machine"]`). handler는 `approvals/reads.ts`에 두고 `loadRequest(snapshot.sql, id)`를 쓴다.
   - `pending()`: 정한 것 — `approvalsPending`의 `actors`에 `machine`을 더해 같은 handler를 쓴다(추천. 새 route와 handler 중복을 만들지 않는다). protocol 한 낱말 변경이고 쓰는 쪽(renderer)은 영향이 없다. reader가 machine actor를 못 받는 등 막히면 `approvalsRequest` 옆에 machine 전용 pending read를 더하고 그 이유를 "정한 것"에 적는다.
   - 두 route는 `approvals/registration.ts`의 `reads`에 올려 reader Worker도 같은 handler를 갖게 한다(`createReaderRegistration`이 `reads`를 그대로 쓴다). `approvals/mod.ts`가 wiring이 필요한 route를 내보낸다.
3. `approvals/ledger.ts`의 `ApprovalLedger`에 `request(id)`, `pending()`을 더한다(`unapplied()`처럼 `calls.read`로 부르고 output을 `safeParse`로 확인한다). `approvals/approvals.ts`의 `createApprovals`가 두 메서드를 `deps.ledger`로 돌려준다. 근거: `createApprovals`가 ledger port만 안다는 구조(`ApprovalsDeps.ledger`).
4. `wiring/approvals.ts`의 `APPROVALS_CONTEXT.scope.operations`에 새 read의 이름을 더한다. `approvalsPending`의 `actors`를 넓혔다면 그 이름도 더한다. 근거: `APPROVALS_CONTEXT`가 route 이름 목록으로만 read를 허락한다.
5. `wiring/apps.ts`의 `activation.attach`를 고친다: `request: (id) => ctx.approvals.request(id)`, `pending: () => ctx.approvals.pending()`. `approvalLedgerRead` import와 `const approvalReads = ...`를 지운다. 근거: 이슈 "정한 것"(wiring은 그걸 끼운다).
6. `wiring/approval-reads.ts`를 지운다. `rows.ts`의 `loadRequest`·`REQUEST_COLUMNS`·`requestOf`가 approvals 안에서만 쓰이는지 `grep`으로 확인한다. 이 task가 지우는 export는 없다(`rows.ts` 밖에서 쓰던 곳이 `approval-reads.ts` 하나였다면 `mod.ts`에 올라가 있지 않은지만 본다).
7. activation 쪽 코드(`packages/core/apps/releases/activation/`)는 고치지 않는다. 모양이 같은 두 함수를 끼우기만 한다. 다른 읽기 지연(reader Worker가 commit 직후 값을 읽는지)이 의심되면 `ApprovalDecided` handler(`approvalDecided`)가 `request(event.subject)`를 읽는 흐름만 본다 — event는 commit 뒤에 나므로 reader가 같은 값을 본다. 어긋나면 고치지 말고 "알려진 미완 동작"에 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 읽기 경로를 옮기는 일이고, 보류 request가 한 번만 결정되고 적용 뒤 `ApprovalDecided`가 나는 규칙은 `approvals/approvals_test.ts`의 "보류 request는 한 번만 결정되고 적용 결과가 나온 뒤 ApprovalDecided가 난다"가 이미 본다. 새 test를 만들지 않는다. 대신 `deno test --no-check packages/core/approvals packages/core/main/daemon/wiring/approvals_test.ts`와 activation test(`packages/core/apps/releases`)를 돌려 깨지지 않음을 본다.
- 남지 않음:
  - `grep -rn "approval-reads" packages tools project-docs/architecture project-docs/*.yaml`이 0줄이다(이슈 절과 plan/change-log는 제외).
  - `grep -rn "approvalLedgerRead" packages tools`가 0줄이다.
  - `grep -rln "approvals/rows" packages/core/main packages/core/apps`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`approvals/registration.ts`의 `reads`는 이 task가 소유한다). 새 route 이름을 `APPROVAL_INTERNAL_COMMANDS`나 다른 목록에 올려야 하면 그 목록 file을 적는다.
- 안 쓰게 된 export: 없으면 "없음"
- 정한 것: `pending()`을 위해 `approvalsPending.actors`를 넓혔는지 새 read를 더했는지와 이유
- 넘길 줄: 없음
- 계약 바꾸기 요청: activation의 `approvals` 칸 모양을 바꿔야 하면 고치지 말고 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
