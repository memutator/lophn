# ap-ask-pending

problem-remove 뒤의 모양을 기준으로 한다. 보류 request 길 전체를 지운다: 표 `approval_requests`, applier, resume, ledger, 보류 command·read와 core machine route 다섯, core가 내는 domain event `ApprovalDecided`. activation(ap-activation)과 reaction(ap-reaction)은 이미 이 길을 쓰지 않는다.

- 단위: ask (wave 2)
- 선행: ap-activation
- 소유(이 task만 고친다):
  - `packages/core/approvals/{applier.ts,ledger.ts,commands.ts,routes.ts,reads.ts,rows.ts,schema.ts}`(지운다)
  - `packages/core/approvals/{approvals.ts,ports.ts,model.ts,mod.ts,registration.ts,approvals_test.ts}`
  - `packages/core/main/daemon/wiring/{approvals.ts,approvals_test.ts,context.ts}`
- 읽을 것:
  - 계획: `project-docs/plan/approval-simplify/README.md`의 "정한 것"(activation 동의를 activation module로 옮기고 `approval_requests`를 쓰는 둘이 다 빠지므로 표를 지운다, reaction은 `off | on`), "뼈대 검토에서 정한 것"(새 event 이름은 옛것 옆에 두고 cleanup이 옛것을 지운다. core와 화면이 따로 옮겨 가도 merge마다 compile된다)
  - roadmap: `project-docs/products/roadmap/approval.md` "지우는 것"의 보류 request 길 전체, "정한 것(agent)"의 "묻는 길은 기다리는 turn 하나다"
  - architecture: `project-docs/architecture/approval.md`(흐름의 "보류 request" 갈래와 "보류 request의 적용" 절이 지울 대상), `project-docs/architecture/event.md`(program 일 event `ApprovalDecided`, 남지 않는 event "보류 request 생김")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `approvals`, `events`, `project-docs/module-catalog.yaml`의 `packages/core/approvals`, `packages/core/main`
  - 앞 task(brief는 `project-docs/plan/approval-simplify/tasks/`): `ap-activation.md`(activation이 `createPending`·`registerApplier`·`cancelPendingFor`·`request`·`pending`과 `ApprovalDecided` handler를 끊는다), `ap-reaction.md`(reaction이 approvals를 거치지 않는다)
  - 코드
    - `packages/core/approvals/approvals.ts`(`createApprovals`, `ApprovalsService`의 `applyAllowed`·`resume`), `ports.ts`(`Approvals`의 보류 몫, `ApprovalApplier`), `model.ts`(`pendingKindAllowed`, `canClose`), `mod.ts`, `registration.ts`
    - `packages/core/main/daemon/wiring/approvals.ts`: `APPROVALS_CONTEXT`의 operation, `createApprovalLedger`, 결정 뒤 적용하는 `writer` 감싸기, `afterReady`의 `resume`
    - 남기는 protocol(shell이 아직 import한다. 고치지 않는다): `packages/protocol/approvals/requests.ts`의 `pendingApprovalSchema`·`approvalsPending`·`approvalsDecide`, `packages/protocol/events/transient.ts`의 `ApprovalRequested`, `packages/protocol/events/domain.ts`의 `approvalDecided`(renderer `packages/shell/renderer/desktop/connection/waiting/settled.ts`·`fake-source.ts`가 type으로 쓴다)
  - 앞 계획 land 뒤 path 확인: `problem-remove`의 `pr-reactions`가 `packages/core/approvals/approvals_test.ts`의 reaction grant 값과 `packages/protocol/events/domain.ts`의 event 목록을 줄인다. 줄 번호와 남은 event는 그 뒤 모양으로 본다.
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: `Approvals`에 `createPending`, `registerApplier`, `cancelPendingFor`, `request`, `pending`이 없고 `ApprovalsService`에 `applyAllowed`, `resume`이 없다. core 등록에 `ListPendingApprovals`, `DecideApproval`과 machine route 다섯(`CreatePendingApproval`, `CancelPendingApprovals`, `RecordApprovalApplied`, `ListUnappliedApprovals`, `GetApprovalRequest`)이 없다. core는 `ApprovalDecided`를 쓰지 않는다. protocol `requests.ts`의 보류 모양(`pendingApprovalSchema`, `approvalsPending`, `approvalsDecide`), 남지 않는 event `ApprovalRequested`, domain event 정의 `approvalDecided`는 shell이 아직 import하므로 남긴다(ap-cleanup이 지운다).

## 할 일

근거는 README "정한 것"과 roadmap "지우는 것"이다. 턴 안 request 길(`turn-requests.ts`, `openTurnRequest`, `decideTurn`, `toolGateHandler`)은 그대로 둔다(ap-ask-turn이 바꾼다).

1. 먼저 지울 이름을 `git grep -nwE "createPending|registerApplier|cancelPendingFor|applyAllowed|ApprovalApplier|approvalsCreatePending|approvalsCancelPendingFor|approvalsRecordApplied|approvalsUnapplied|approvalsRequest|APPROVAL_INTERNAL_COMMANDS|APPROVAL_SCHEMA_STEPS|createApprovalLedger" -- packages`로 찾는다. `packages/core/approvals/`와 `packages/core/main/daemon/wiring/approvals.ts` 밖에 남은 곳이 있으면(ap-activation·ap-reaction의 빠짐) 고치지 말고 file:줄을 보고하고 멈춘다. `Approvals`의 `request(`·`pending(`을 부르는 곳도 같은 식으로 본다(`git grep -n "approvals.request(\|approvals.pending(\|\.pending()" -- packages/core`).
2. 지운다: `packages/core/approvals/{applier.ts,ledger.ts,commands.ts,routes.ts,reads.ts,rows.ts,schema.ts}`.
3. `packages/core/approvals/ports.ts`: `Approvals`에서 `createPending`, `registerApplier`, `cancelPendingFor`, `request`, `pending`과 그 주석을 지운다. `ApprovalApplier` type과 `PendingApproval`·`ApplyResult` import를 지운다. `judge`, `openTurnRequest`, `waitTurnDecision`, `consumeTurnAllow`, `cancelTurnRequests`, `turnRequests`, `Gate`, `Grants`, `SessionAllowances`는 그대로다.
4. `packages/core/approvals/approvals.ts`
   - deps에서 `ledger`를 지우고 `createApplier`를 부르지 않는다. 반환에서 `createPending`, `registerApplier`, `cancelPendingFor`, `request`, `pending`, `applyAllowed`, `resume`을 지운다.
   - `ApprovalsService = Approvals & { decideTurn(...) }`만 남긴다. 머리 주석의 "두 길의 request(turn 안, 보류)"를 turn 안 request 하나로 고친다.
   - `bus`는 `turn-requests.ts`가 아직 쓰므로 deps에 남는다.
5. `packages/core/approvals/model.ts`: `PENDING_KINDS`, `pendingKindAllowed`, `canClose`를 지운다. `intentFingerprint`, `choiceOffered`는 남긴다(turn 안 request가 쓴다. ap-ask-turn이 지운다). 머리 주석은 그대로 맞으면 둔다.
6. `packages/core/approvals/mod.ts`: `ApprovalLedger`·`createApprovalLedger`, `APPROVAL_INTERNAL_COMMANDS`·`approvalsCancelPendingFor`·`approvalsCreatePending`·`approvalsRecordApplied`·`approvalsRequest`·`approvalsUnapplied`, `APPROVAL_SCHEMA_STEPS`, `ApprovalApplier` export를 지운다.
7. `packages/core/approvals/registration.ts`: `schemaSteps`에서 `APPROVAL_SCHEMA_STEPS`, `commands`에서 `approvalCommands`, `reads`에서 `approvalsPendingRead`·`approvalsRequestRead`·`approvalsUnappliedRead`를 지운다. agent grant 몫(`agentGrantRegistration`)과 ap-assign-store가 더한 할당 몫, `memoryRoutes`는 그대로다.
8. `packages/core/approvals/approvals_test.ts`
   - "보류 request는 한 번만 결정되고 적용 결과가 나온 뒤 ApprovalDecided가 난다"를 지운다.
   - SQLite 준비(`withApprovals`, `makeKit`의 ledger·commands·`decide`·`count`·`side`, `activation()` helper)와 `./commands.ts`·`./reads.ts`·`./schema.ts`·`../storage/...` import를 지운다.
   - 남는 두 test("이 session 동안 허락은…", "허락은 그 intent에 한 번만 쓰인다")는 `createApprovals`를 ledger 없이 메모리로 만들도록 준비만 바꾼다. 판정과 이름은 그대로다(ap-ask-turn이 지운다).
9. `packages/core/main/daemon/wiring/approvals.ts`
   - import에서 `approvalsDecide`, `approvalsPending`, `APPROVAL_INTERNAL_COMMANDS`, `approvalsRequest`, `approvalsUnapplied`, `createApprovalLedger`, `Writer`를 지운다.
   - `APPROVALS_CONTEXT.scope.operations`를 `[agentSessionRead.name]`으로 줄이고 위 주석("request 표에 쓰고 읽는")을 tool gate가 session의 agent를 읽는 자격으로 고친다. `records`는 그대로 둔다(자격은 남는다).
   - `createApprovals` 호출에서 `ledger`를 지운다. `send`는 `writeAgentGrant`가 아직 쓰므로 남긴다.
   - build 결과의 `writer`(결정 뒤 `applyAllowed`)와 `afterReady`(`resume`)를 지운다.
10. `packages/core/main/daemon/wiring/approvals_test.ts`: 고칠 것이 없으면 두고, compile이 깨지면 준비만 맞춘다.
11. `packages/core/main/daemon/wiring/context.ts`: `approvals` 칸 위 주석("다른 wiring이 Gate·보류 request·applier 등록에 쓴다")을 "tool gate와 turn 안 request"로 고친다. type은 그대로다.
12. 개발 data(`.dev-data/`)는 지우고 새로 만든다. schema step `approvals`가 빠져 migration 이력이 어긋난다(`history_mismatch`). migration은 만들지 않는다(AGENTS.md "호환성").
13. protocol은 고치지 않는다(위 "남기는 protocol"). shell의 `SHELL_ROUTES`가 아직 `ListPendingApprovals`·`DecideApproval`을 싣지만 core에 handler가 없어 `not_found`다. 화면은 ap-waiting이 끊는다(wave 2는 한꺼번에 land한다, README "lead가 할 일").

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 지우기만 한다. 남는 권한 경계 test(`packages/core/main/daemon/wiring/approvals_test.ts`의 "다른 session·turn의 자격으로는 Gate route가 허락을 소비하지 못한다", `packages/core/approvals/grants/reads_test.ts`)는 지우지 않는다.
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 찍는다.
- 남지 않음:
  - `git ls-files packages/core/approvals | grep -E "/(applier|ledger|commands|routes|reads|rows|schema)\.ts$"`가 0줄이다.
  - `git grep -nE "approval_requests|createPending|registerApplier|cancelPendingFor|applyAllowed|ApprovalLedger|createApprovalLedger|APPROVAL_INTERNAL_COMMANDS|APPROVAL_SCHEMA_STEPS|ApprovalApplier|CreatePendingApproval|CancelPendingApprovals|RecordApprovalApplied|ListUnappliedApprovals|GetApprovalRequest" -- packages/core`가 0줄이다.
  - `git grep -nwE "approvalsPending|approvalsDecide|approvalDecided|ApprovalDecided|ApprovalRequested" -- packages/core`가 0줄이다(`-w`라 `approvalsDecideTurn`은 걸리지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다). protocol의 `pendingApprovalSchema`, `approvalsPending`, `approvalsDecide`, `applyResultSchema`, `ApprovalRequested`, `approvalDecided`는 shell이 끊은 뒤 ap-cleanup이 지운다고 적는다
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
