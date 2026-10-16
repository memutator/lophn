# core-wiring-trim

`packages/core/main/daemon/core.ts`(3,573줄)를 쪼개기 전에 줄인다. test가 끼우던 `CoreOptions` seam과 test만 부르던 `Core` 멤버를 지우고, documents 조립(문서 worker, coordinator 통로, 준비·검사·search 서빙)과 approval 만료·apply 배선을 걷어 낸다. 이 task가 끝난 뒤의 `core.ts`가 다음 task(`core-wiring-split`)의 입력이다.

- 단위: core-wiring (wave 0)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/` 안 모든 file (`core.ts`, `runtime.ts`, `platform-register.ts`, `parent.ts`, `registration.ts`, `main.ts`)
  - 소유 바꾸기 요청(`../ownership.md`에서 이 단위로 옮겨진 것을 확인한 뒤에만 고친다. 아니면 고치지 말고 보고한다): `packages/core/server/credentials.ts`(`FIXED_CREDENTIALS`의 `APPROVAL_EXPIRY_PRINCIPAL`·`DOCUMENTS_FEED_PRINCIPAL` 두 줄과 import), `packages/core/storage/ledger/writer-assembly.ts`(`bindApprovalOwners` import와 호출 한 곳)
- 읽을 것:
  - spec: S2 6장("기한이 없다"), 7장(부품과 소유), 9장(지울 옛 것), 10장(하지 않는 것) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - inventory: `I1.2#4`, `I1.10#11`, `I2.2#7`, `I2.10#15` (`../assignment.md` core-wiring 줄 가운데 이 task 몫. 나머지 core-wiring 줄은 다른 단위로 넘겼다)
  - 계획: `../README.md` 2.1의 "hotspot 쪼개기" 줄, 1장 규칙 6(공용 등록 file)
  - dev: `/home/pyosechang/projects/lophn/project-docs/dev/code.md` "주석과 죽은 코드", "호환성"
  - 지금 코드: `packages/core/main/daemon/*.ts`, `packages/core/server/credentials.ts`, `packages/core/storage/ledger/writer-assembly.ts`
- 계약:
  - 쓰는 것: 없음 (protocol은 고치지 않는다. 지운 동작의 route와 command 정의는 protocol과 각 module에 남는다. 쓰는 곳이 없어진 정의를 지우는 것은 그 module을 가진 단위와 cleanup이다)
  - 내놓는 것 (다음 task가 기대는 모양):
    - `CoreOptions`는 `lophnHome?`, `home?`, `port?`, `teams`, `teamModules?`, `clock?`, `random?`, `parent?`, `codingKeychain`, `codingLoaders`로 줄어든다 (`codingKeychain`, `codingLoaders`는 필수)
    - `Core`는 `port`, `epoch`, `dataRoot`, `done`, `shutdown()`, `restore()`, `restorePlan()`, `restoreStopped()`, `codingCredentials`로 줄어든다 (restore 셋은 remove-platform이 지울 때까지 둔다)
    - 밖에서 import하는 `BlobPrepareCall`(8곳), `CoreRuntime`(6곳), `platform-register.ts`의 상수·함수는 path와 이름을 유지한다

## 할 일

1. **기준선 부팅**: 고치기 전에 지금 core가 뜨고 끝나는지 한 번 돌려 본다 (`dev:core`는 터미널이 필요해 쓰지 않는다).
   ```sh
   H=$(mktemp -d); (sleep 20) | LOPHN_HOME=$H timeout 60 deno run -A packages/core/main/daemon/main.ts --port=0 >$H/out.txt 2>$H/err.txt; echo $?
   ```
   - stdin이 pipe라 부모 pipe 모드로 뜬다. 20초 뒤 stdin이 닫히면 core가 정상 종료한다.
   - 통과 조건: 종료 code 0, `$H/err.txt`에 stack trace가 없고, 도는 동안 `$H/run/` 아래 run metadata file이 생긴다(중간에 `ls $H/run`로 본다).
   - 이 방법이 환경 때문에 안 돌면 보고에 쓰고 이 항목은 건너뛴다. 돌면 마지막 단계에서 같은 명령으로 다시 확인한다. 임시 폴더는 확인 뒤 지운다.
2. **`CoreOptions` seam을 지운다** (`../README.md` 2.1 "hotspot 쪼개기").
   - 지우는 칸: `supervise`, `superviseIo`, `appRevertCaller`, `notePrepared`(선언만 있고 읽는 곳이 없다), `maintenance`, `failShutdown`, `maintenanceTimeoutMs`, `restoreTimeoutMs`, `bootstrapRetryMs`, `secretKeychain`, `secretSweepMs`, `spawn`, `contextWorker`, `workers`, `appProcess`, `appsSweepMs`, `appPreviews`, `onDocumentsHello`, `writerClock`, `appSupervisor`, `agentRuntime`.
   - 지운 칸의 뜻은 제품 기동의 값으로 굳힌다:
     - I/O worker 감독(`io`)과 앱 supervisor(`appsSupervision`)와 agent runtime child는 늘 있다. `io === undefined`·`appsSupervision === undefined`·`options.agentRuntime` 분기와 `ioComponent`의 "감독이 없다" 가지를 지운다. type 오류로 따라가면 된다.
     - context worker는 늘 띄운다 (`options.contextWorker !== false` 조건을 뺀다).
     - writer clock은 늘 `"system"`이다. `runtime.ts`의 `writerClock` 입력과 `openProductWriter`에 넘기던 `nowMs` 분기를 걷고, `isManualClock`/`noteTime` 분기(`sweepTicketClaims`, `sweepApprovalExpiry`)도 지운다. 지우고 나서 `isManualClock`의 쓰는 곳이 남는지 grep한다. `packages/base`는 이 task의 소유가 아니므로 export는 지우지 않고 보고한다.
     - keychain은 늘 제품 것이다: `secretKeychain ?? codingKeychain ?? productKeychain()`을 `codingKeychain`으로 줄인다 (제품 `main.ts`는 `codingKeychain: productKeychain()`을 준다). `mcpKeychain` 지연 생성도 같다.
     - `runStoppedMaintenance`의 `timeoutMs`·`run` 인자, `runStoppedRestore`의 `timeoutMs` 인자는 상수만 남긴다.
     - `bootstrapRetryMs` 대신 상수 `BOOTSTRAP_RETRY_MS`를 쓴다 (이미 import한다).
   - 남기는 칸: `lophnHome`, `home`, `port`, `teams`, `teamModules`, `clock`, `random`, `parent`, `codingKeychain`, `codingLoaders`. `codingKeychain`·`codingLoaders`는 필수로 바꾸고 `coding ? ... : ...` 분기를 지운다(`Core.codingCredentials`도 필수가 된다).
   - `main.ts`가 넘기던 `writerClock`, `appSupervisor`, `agentRuntime`을 뺀다.
3. **`Core` 값에서 test만 부르던 멤버를 지운다.** 밖에서 부르는 곳을 grep으로 확인하고 지운다. 확인한 결과: `updateNotice`, `stopForUpdate`, `record`, `prepareBlob`, `blobBuffer`, `childBlobPrepare`, `reconcileApp`, `sweepTicketClaims`, `sweepTicketChecks`, `sweepProblemsWork`, `sweepProblemsClosing`, `sweepApprovalExpiry`, `sweepInterruptedInvocations`, `codingCredentialsReady`는 `core.ts` 밖에서 부르는 곳이 없다(`packages/shell`의 같은 이름은 renderer 쪽 source다). 지운 멤버가 쓰던 type·함수(`BlobPrepareCall`은 남긴다)도 따라 지운다. `main.ts`가 쓰는 `dataRoot`, `done`, `shutdown`, `restoreStopped`, `codingCredentials`는 남긴다.
   - `runtime.ts`의 `CoreRuntime`: `trackedSessions`(부르는 곳 없음)를 지운다. `notePrepared`는 `core.ts`의 blob relay(`blobRelayFor`의 `note`)가 부르므로 **남긴다**. 계획 README는 둘 다 지우라고 쓰지만 `notePrepared`는 지금 부르는 곳이 있다. grep으로 다시 확인하고 보고에 적는다.
   - 시간·timer 인자는 그대로 두고 `sweepTicketClaims`, `sweepInterruptedInvocations`는 `CoreRuntime`에 남긴다 (다음 task가 옮긴다). `Core`에서만 뺀다.
4. **documents 조립을 걷어 낸다** (`I2.10#15`, `I1.10#11`). 쓰는 것이 모두 `projects/file-tracking`, `projects/versions`, `projects/outline-and-search`에 있는 조립이다. wave 1의 remove-documents가 그 폴더를 지우므로 daemon이 더는 그 폴더를 import하지 않게 한다. `core.ts`에서 찾는 이름:
   - 통로·상태: `documentsChannel`, `fileWindows`, `statusMemoryVia(documentsChannel)`(`assemble`의 `status` 환경), `validateWiring`, `validateDeps`, `coordinatorStreamer`, `validatePort`, `prepareWorkers`, `preparedRoute`, `placementReservations`, `requestVersion`
   - 자격: `DOCUMENTS_FEED_CONTEXT` 기록(`feedCredential`), `machine:documents` 발급(`documentsToken`), 파일 끝의 `basisReader`, `searchReader`, `trackingReader`, `DOCUMENTS_*_MS` 상수
   - worker route 조립: `startApiServer`의 `uploads`에서 `documentUpload`, `fileStreams` 전체(`storedFileStreams`, `fileReadStreams`. 단 `agentProfilesRead` 한 항목은 남긴다), `workers`의 `fileWorkers`·`toolDocumentWorkers`·`formatValidateWorkers`·`prepareWorkers`·`servedWorkers` 가지(`appExportWorkers`와 `withViewBinding(collectorWorkers)`는 남긴다. 남는 `mergedWorkers` 중첩을 정리한다)
   - 쓰기 앞 처리기: `withPlacementReservation`
   - `if (io && documentsToken) { ... }` 블록 전체(documents worker 시작, `documentsRespawner`, `rootsWatch`, `basisSync`, `searchSync`, `startDocumentsFeed`와 `documentsFeed.stop()`, `closeChildBlob`, `respawnStop`, `watchTrackingRoots`, `watchObservationBasis`, `watchSearchIndex`)
   - `modules`: `withDocumentsReader`를 지운다.
   - 파일 아래쪽 helper: `documentPrepareWorkers`, `formatValidateWorkers`, `requestPrincipal`, `readAs`, `baseVersionRead`, `mergedWorkers`(남는 곳이 없으면)
   - import: file-tracking, versions, outline-and-search, `projects/register.ts`의 `connectDocumentsRelaunch`·`workerSpecs`, protocol/projects의 `documentPrepare`·`documentUpload`·`filesRead`·`projectTrackingRoots`
   - **남기는 것**: contexts worker(`CONTEXT_WORKER_OPERATIONS`, `contextWorkerCredential`, `contextsHost`, `contextsInputReader`, dispatcher·watch)는 documents가 아니다. 그대로 둔다.
   - **건드리지 않는 import 둘** (lead가 `../../tmp/implementation-inventory.md` 6장 `I6#1`, `I6#2`로 옮긴다): `createDocumentsChannel`(`projects/file-tracking/coordinator/serving.ts`)은 collector·runner·checker·repair·revert·contexts 통로가 계속 쓴다. `createProductRedactor`(`projects/outline-and-search/redactor.ts`)는 `core.ts`와 `runtime.ts`가 쓴다. 이 둘의 import 줄은 그대로 둔다.
   - `packages/core/server/credentials.ts`의 `DOCUMENTS_FEED_PRINCIPAL`(import와 `FIXED_CREDENTIALS` 한 줄)도 지운다.
   - `projects/register.ts`가 `environment.status`를 안 받아도 되는지 확인한다 (`environment?.status ?? UNATTACHED_STATUS`라서 된다. 이 file은 이 task의 소유가 아니다).
5. **approval 만료와 apply 배선을 걷어 낸다** (`I1.2#4`, `I2.2#7`, S2 10장 "approval 기한").
   - `core.ts`: `APPROVAL_EXPIRY_SWEEP_INTERVAL_MS`, `expiryCredential` 기록, `approvalSweep` interval과 시작 때 한 번 부르는 줄과 `clearInterval`, `Core.sweepApprovalExpiry`, `APPROVAL_EXPIRY_CONTEXT` import.
   - `runtime.ts`: `CoreRuntime.sweepApprovalExpiry`와 구현(`approvalExpiry` const 이하 한 함수), `APPROVAL_EXPIRY_CONTEXT` import.
   - `platform-register.ts`: `APPROVAL_EXPIRY_PRINCIPAL`, `APPROVAL_EXPIRY_CONTEXT`, `platformDefinitions.reads`의 `approvalExpirySweepRead()`, `platformDefinitions.commands`의 `approvalCommands.expire`, `createApplyCommand(() => approvalOwners)`, `approvalOwners`·`bindApprovalOwners`. 이 file의 notifications, assignment 반응, secrets, `withPlatform`은 이 task에서 건드리지 않는다.
   - `packages/core/server/credentials.ts`: `APPROVAL_EXPIRY_PRINCIPAL`.
   - `packages/core/storage/ledger/writer-assembly.ts`: `bindApprovalOwners` import와 호출. 그 앞뒤의 `dispatchOnly` 검사와 `bindQuestionOptionOwners`는 그대로 둔다.
   - `core/approvals/`의 `expiry.ts`, `apply.ts`, `model.ts`의 `deadlineValid`는 approvals 단위(wave 3)가 지운다. 이 task는 건드리지 않고, 쓰는 곳이 없어진 export 목록을 보고에 쓴다.
6. **정리**: 지운 뒤 남은 안 쓰는 import·변수·type을 지운다. 주석은 지운 동작을 말하는 것을 같이 지운다. 새로 만든 file은 없다.
7. **확인**: `deno task check` (type check가 가장 믿을 만한 안전망이다). 1번 부팅 명령을 다시 돌려 같은 결과가 나오는지 본다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (test가 쓰던 seam을 지우는 일이다. 위험 test가 core 전체 기동을 요구하게 되면 그때 필요한 입구만 다시 만든다. `../../dev/testing.md`)
- 남지 않음:
  - `grep -rnE "superviseIo|appRevertCaller|contextWorker|onDocumentsHello|secretKeychain|secretSweepMs|appsSweepMs|appPreviews|bootstrapRetryMs|maintenanceTimeoutMs|restoreTimeoutMs|failShutdown|writerClock|trackedSessions" packages tools --include=*.ts`가 0줄이다.
  - `grep -rnE "APPROVAL_EXPIRY|sweepApprovalExpiry|bindApprovalOwners|machine:documents|DOCUMENTS_FEED" packages tools --include=*.ts`가 0줄이다.
  - `grep -rnE "file-tracking|outline-and-search|projects/versions" packages/core/main/daemon packages/core/server`가 정확히 두 줄이다(`createDocumentsChannel`과 `createProductRedactor`의 import. `runtime.ts`의 것까지 합쳐 세 줄이어도 된다).

## 보고

- 바꾼 file (줄 수 변화: `core.ts` 몇 줄 → 몇 줄)
- 등록할 것: 없음
- 안 쓰게 된 export (남이 쓰던 것은 지우지 않았다): `core/approvals`의 `approvalExpirySweepRead`·`createApplyCommand`·`deadlineValid`·`deadlineReached`·`expireApprovalRequest` 등 쓰는 곳이 없어진 것, `projects/register.ts`의 `workerSpecs`·`connectDocumentsRelaunch`, `base`의 `isManualClock`(쓰는 곳이 남았는지)
- 정한 것:
  - `notePrepared`를 남긴 이유
  - `agentRuntime`·`appSupervisor`·`codingKeychain`을 늘 켜진 것으로 굳힌 것
  - 부팅 확인 결과(전 / 후)
- 소유 바꾸기: `packages/core/server/credentials.ts`, `packages/core/storage/ledger/writer-assembly.ts`를 core-wiring (wave 0 한정)으로. 아니면 이 두 file의 변경이 빠져 type check가 깨진다.
