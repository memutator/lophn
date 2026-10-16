# approvals-requests

request의 두 길을 만든다. 물음이 나온 turn이 기다리는 turn 안 request(메모리)와, 아무도 멈추지 않는 보류 request(`approval_requests` 표)다. 사람의 결정 command, `ApprovalDecided` handler, `ApprovalRequested`·`PermissionRequested`·`PermissionResolved`를 내는 길을 둔다. 옛 범용 적용 엔진(`apply_approved_action`, "concern + command + 대상 + 입력" action)과 설명 글, blob, confirm 규칙, 기한, 계보 억제를 지운다.

- 단위: approvals (wave 3)
- 선행: approvals-gate (`gate`, `createGrants`, `createSessionAllowances`, `agentGrantRegistration`을 쓴다)
- 소유(이 task만 고친다):
  - `packages/core/approvals/`의 `gate/`·`grants/` 밖 전부 (`apply.ts`, `blobs.ts`, `commands.ts`, `confirm.ts`, `erase.ts`, `expiry.ts`, `lineage.ts`, `mod.ts`, `model.ts`, `reads.ts`, `registration.ts`, `restart.ts`, `schema.ts`, `text-prepare.ts`, `text-read.ts`, `text.ts`와 새 file)
  - wiring file `packages/core/main/daemon/wiring/approvals.ts` (core-wiring이 만든다. 이름이 다르면 approvals 몫의 wiring file. 없으면 보고하고 멈춘다)
- 읽을 것:
  - spec: S2 5·6·7장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`. 흐름은 S1 7·9장 5·6번 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`. activation 쪽 접점은 S7 6장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/activation.md`
  - inventory: `I1.2#1`, `I1.2#3`, `I1.2#5`, `I1.2#7`, `I1.2#8`, `I1.2#9`, `I1.2#10`, `I2.1#10`, `I2.2#1`, `I2.2#3`, `I2.2#5`, `I2.2#6`, `I2.2#22`, `I3.2#7`, `I3.2#8`, `I3.2#9`, `I3.2#10`, `I3.2#14`, `I3.2#15` (`../assignment.md`에서 이 task가 맡은 줄 전부)
  - 결정: `../README.md` 2.5의 B2 줄(위험 test), 3장 #3(Gate는 core 한 곳), #4(session 입력함은 메모리)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `/home/pyosechang/projects/lophn/project-docs/dev/testing.md`
  - 지금 코드(읽기만): `packages/core/approvals/{commands,model,schema,reads,registration}.ts`, `packages/core/apps/tickets/{commands,register}.ts`(command·registration 본보기)
- 계약:
  - 쓰는 것: `packages/protocol/approvals/`의 `PendingApproval`, `TurnPermissionRequest`, `TurnDecision`, `approvalsPending`, `approvalsDecide`, `approvalsDecideTurn`, `choicesFor`. `packages/protocol/events/`의 `approvalDecided`(domain event), `ApprovalRequested`·`PermissionRequested`·`PermissionResolved`. `packages/core/approvals/ports.ts`의 `Approvals`·`ApprovalApplier`. `packages/core/events/ports.ts`의 `Bus`, `Reactor`. 앞 task의 `gate`, `Grants`, `SessionAllowances`.
  - 내놓는 것: `createApprovals({ gate, grants, allowances, bus, reactor, ledger, clock, ids })`(`Approvals` 구현). 호출하는 쪽은 `judge`, `openTurnRequest`, `waitTurnDecision`, `consumeTurnAllow`, `cancelTurnRequests`, `turnRequests`, `createPending`, `registerApplier`, `cancelPendingFor`다. 이 입구들을 run-loop(router), tool-judgment(approvals-tool-judgment), activation 처리(releases-problems), 새 일 handler(events-reactor)가 쓴다.

## 할 일

1. 모델 — `core/approvals/model.ts`를 다시 쓴다 (순수 함수만)
   - 상태 전이: `pending → granted | rejected | cancelled`. 끝난 request는 다시 열리지 않는다. 기한이 없다. 기한 장치의 daemon 쪽(60초 sweep timer, `APPROVAL_EXPIRY_PRINCIPAL`)은 `I1.2#4`로 core-wiring이 지우고, `core/approvals/expiry.ts`와 `deadline*` 규칙은 이 task가 지운다.
   - 선택지 검사: 결정의 `choice`는 request의 `choices`에 있는 것만 받는다. 거절 이유는 짧은 글 한 칸(`rejectReasonSchema`)이다.
   - intent 지문: `intentFingerprint(intent)`는 canonical JSON의 sha256이다(`packages/base`의 `canonicalize`·`sha256Hex`). 허락이 쓰이기 직전에 같은 지문인지 본다(S2 6장 "결정 규칙").
   - 지우는 것: `creationValid`, `descriptionPresent`, `externalDescribed`, `repairDescribed`, `deadlineValid`, `deadlineReached`, `cancelActorAllowed`, `closeAllowed`의 옛 규칙, `grantScopeAllowed`, `sessionGrantableValid`, `immutableFields`의 옛 칸 (`I1.2#3`, `I1.2#5`, `I1.2#8`)
2. 보류 request 표 — `core/approvals/schema.ts`, `commands.ts`, `reads.ts` (`I2.2#1`, `I2.2#3`, `I2.2#5`, `I2.2#6`, `I2.1#10`, `I3.2#8`)
   - `approval_requests`를 contract의 `PendingApproval` 모양으로 다시 만든다: `id, intent(JSON), choices(JSON), status, reject_reason, applied(JSON), created_seq, decided_seq, created_at, decided_at`. 요청자, 설명 글 blob, 기한, session 허락 열(`grant_scope`, `grant_session`, `session_grantable`)과 그 index, 내용 불변 trigger의 옛 칸은 모두 뺀다. schema step 내용을 고치고 개발 DB는 지우고 새로 만든다.
   - command (`core/approvals/commands.ts`)
     - `createPending(intent)`: Gate가 ask를 냈을 때 program이 부른다. 표에 쓰고 commit 뒤 `ApprovalRequested`를 Bus에 낸다. 같은 근거의 중복 request는 만들지 않는다(intent 지문이 같은 pending이 있으면 그것을 돌려준다).
     - `decide`(`approvalsDecide`): 사람 자격만. request가 `pending`이 아니면 `conflict`. 한 tx에서 status를 `granted`/`rejected`로 바꾸고 거절 이유를 쓰고 domain event `ApprovalDecided`(`{ kind, decision }`)를 쓴다(`tx.emit`). 결정 규칙 그대로: 침묵이나 카드 닫기는 결정이 아니다. 접수한 시점의 `PendingApproval`을 돌려준다.
     - `cancelPendingFor(app, release?)`: 더 새 release의 activation이 시작되면 이전 activation request를 `cancelled`로 둔다(machine만, S2 11장 4). 사람도 요청자도 취소하지 않는다.
     - `recordApplied(request, result)`: 적용 결과(`applied`/`failed`)를 쓴다(machine만, 아래 3).
   - read (`reads.ts`): `approvalsPending`. 옛 `approvalsGet`·`approvalsList`·`approvalsText` read와 text 관련 file(`text.ts`, `text-prepare.ts`, `text-read.ts`, `blobs.ts`)은 지운다. 요청자 본인만 보던 규칙, 설명 글 읽기는 없다.
3. 결정 뒤 실행 — `core/approvals/applier.ts`(새), `I3.2#7`, S2 6장
   - Reactor handler `approvals:ApprovalDecided`를 만든다. 순서: ① request를 읽는다. 이미 `applied`가 있으면 끝난 것으로 본다(두 번 불려도 효과는 한 번: `ctx.idempotencyKey("apply")`). ② `rejected`면 아무것도 하지 않는다. ③ `granted`면 `registerApplier(kind, applier)`로 등록된 applier를 부른다. applier는 그 종류(`activation` 또는 `reaction`)의 소유 module이 intent를 다시 검사하고 실행한다. ④ 결과를 `recordApplied`로 쓴다. 허락의 접수(`status: granted`)와 적용 성공은 따로 남아 보인다(`I2.2#22`).
   - applier가 없는 종류는 `failed`(`unavailable`)로 쓴다. 조용히 삼키지 않는다.
4. turn 안 request — `core/approvals/turn-requests.ts`(새), `I3.2#9`, `I3.2#10`, S2 6장
   - 메모리에만 둔다. `openTurnRequest(intent)`: 원래 intent의 `origin`이 turn이어야 한다(아니면 `invalid_input`). `TurnPermissionRequest`(`choices`는 `choicesFor`)를 만들어 Map에 두고 Bus에 `PermissionRequested`를 낸다.
   - `waitTurnDecision(request)`는 결정이 올 때까지 기다리는 Promise다.
   - 결정 route `approvalsDecideTurn`(`defineMemory`): 사람 자격만. 선택지에 따라 한다 — `once`: 그 intent에 한 번. `session`: `SessionAllowances.allow(session, key)`를 더한다. `always`: `Grants.setAlways`를 부른다. `reject`: 이유를 `TurnDecision`에 실어 요청한 agent에게 그대로 간다. 결정하면 Bus에 `PermissionResolved`를 낸다.
   - `consumeTurnAllow(request, current)`: 허락은 그 intent에 한 번만 쓰인다. 지문이 다르면 `conflict`로 거절한다. 이미 쓴 허락은 `conflict`다.
   - `cancelTurnRequests(session, cause)`: turn이 끝나거나 session이 닫히거나 시작 때 정리에서 부른다. 기다리던 `waitTurnDecision`을 `cancelled`(cause 포함)로 끝내고 `PermissionResolved(cancelled)`를 낸다. 요청자는 cancelled를 거절과 구별해 받는다.
   - `turnRequests(session)`: session snapshot이 읽는 대기 권한 요청 목록이다.
   - 꺼졌다 켜지면 이 Map은 비어 있다. 다시 열지 않는다.
5. Approvals 조립 — `core/approvals/approvals.ts`(새), `registration.ts`, `mod.ts`
   - `createApprovals(...)`가 contract의 `Approvals` port를 구현한다. `judge(intent)`는 grant를 읽어 `gate`를 돌리고, 출처가 turn이면 `SessionAllowances.has(session, allowanceKey(intent))`를 본다. 허락돼 있으면 ask를 run으로 바꾼다. `SessionAllowances`는 session마다 따로다(다른 session은 보이지 않는다).
   - `registration.ts`: schema step(`approval_requests`, 앞 task의 `agent_grants`), command(`decide`, `createPending`, `cancelPendingFor`, `recordApplied`, `agentGrantsSet`), read(`approvalsPending`, `agentGrantsGet`), memory route(`approvalsDecideTurn`)를 낸다. `owners`(소유 command 목록) 인자와 `blobFields`는 지운다. `createCoreRegistration`도 같은 모양으로 고친다.
   - `mod.ts`: 새 입구만 내보낸다. 다른 module은 이 file로만 import한다.
6. 옛 것을 지운다 — `I1.2#1`, `I1.2#3`, `I1.2#5`, `I1.2#7`, `I1.2#8`, `I1.2#9`, `I1.2#10`
   - 지울 file: `apply.ts`, `blobs.ts`, `confirm.ts`, `erase.ts`, `expiry.ts`, `lineage.ts`, `restart.ts`, `text.ts`, `text-prepare.ts`, `text-read.ts`, `mod.ts`에서 그것들의 export.
   - 다른 단위가 아직 쓰는 export는 지우지 않고 보고한다: `CONFIRM_COMMAND`·`CONFIRM_CONCERN`·`checkConfirmAction`(`core/apps/invocations/confirm.ts`), `eraseApprovalRequests`(`core/lophn-agent/register.ts`, `waiting-and-recovery/erase.ts`), `approvalRunLineage`(`core/lophn-agent/register.ts`), `observeApprovals`·`RESTART_GRANTED_LIMIT`(`core/storage/migration`의 `RestartObservation`), `createApplyCommand`(`core/main/daemon/platform-register.ts`와 `core/lophn-agent/run-loop/runtime-access.ts`의 apply 호출). `grep -rn "core/approvals" packages/core --include=*.ts`로 남은 사용처를 센다. 0이 아닌 것은 file 목록과 소유 단위를 보고한다. 그 단위가 쓰기를 그만두면 cleanup이 지운다.
7. wiring — `wiring/approvals.ts`: 지금 있는 승인 글 준비(`withApprovalText`, `createApprovalTextPreparer`)와 `observeApprovals` 줄은 지운다. `createApprovals`를 만들어 `registration`을 core 등록에 내놓고, Reactor에 `approvals:ApprovalDecided` handler를 등록하고, Bus와 ledger를 넘긴다. 다른 단위에 줄 `Approvals`를 내놓는다.
8. 위험 test
   - `packages/core/approvals/approvals_test.ts` 둘. 첫째 이름은 "이 session 동안 허락은 같은 session에서만 쓰이고 재시작에 남지 않는다". 임시 SQLite와 fake Bus로 `createApprovals`를 만든다: ① external app-api intent는 grant 안이면 `ask`다. ② `openTurnRequest` → `approvalsDecideTurn(session)`으로 같은 대상을 다시 `judge`하면 `run`이다. ③ 다른 session에서 같은 대상은 `ask`다. ④ `createApprovals`를 새로 만들어(재시작) 같은 DB에 붙여 같은 session의 같은 대상을 `judge`하면 `ask`다. 허락이 DB에 어떤 행도 남기지 않았다는 것도 본다(표 행 수 비교). 결정 route를 agent 자격으로 부르면 `forbidden`인 것도 case로 본다. 둘째 이름은 "허락은 그 intent에 한 번만 쓰인다". 같은 준비로 `consumeTurnAllow`가 ① 같은 intent에는 한 번 통과하고 ② 두 번째는 `conflict`이고 ③ 입력이 달라진 intent로 부르면 `conflict`인지 본다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "이 session 동안 허락은 같은 session에서만 쓰이고 재시작에 남지 않는다", "허락은 그 intent에 한 번만 쓰인다"
- 남지 않음: `grep -rn "apply_approved_action\|createApplyCommand\|approvalExpirySweep\|checkConfirmAction" packages/core/approvals`가 0줄이다. `core/approvals/` 밖의 남은 사용처는 보고에 file로 적는다.

## 보고

- 바꾼 file
- 등록할 것: core 조립 목록에 `wiring/approvals.ts`(lead). `protocol/registry.ts`·`protocol/approvals/mod.ts`: 옛 `APPROVAL_ROUTES`·`APPROVAL_EVENTS`를 빼는 것은 사용처가 없어진 뒤 lead가 한다.
- 안 쓰게 된 export: 위 6의 다른 단위 사용처, `protocol/approvals/approvals.ts` 전부(옛 route·event·`ApprovalAction` 등), `Tx.useApproval`
- 정한 것: turn 안 request의 id도 `apr`을 쓴다(한 대기 목록). `createPending`의 중복 방지는 intent 지문 기준. `PermissionRequested`·`PermissionResolved`는 run-loop가 아니라 turn-requests가 Bus에 낸다(request를 가진 쪽이 낸다. S1 9장 5번은 run-loop로 적었지만 observable 동작이 같다)
- 계약 바꾸기 요청(wave 3): `Approvals` port 모양을 바꿔야 하면 여기 적는다
- 넘길 줄: `I1.2#9`의 `core/lophn-agent/register.ts` 부분 → agent-definition, `waiting-and-recovery/erase.ts` → router. `I1.2#1`의 `run-loop/runtime-access.ts` apply 호출 → router. `I1.2#10`의 `storage/migration` 소비처 → platform
