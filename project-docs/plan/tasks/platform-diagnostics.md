# platform-diagnostics

Settings › Diagnostics 화면이 부를 `diagnostics/status`(구성 요소마다 지금 쓸 수 있는지, 안전한 불가 이유, 점검한 시각)를 짓고, `diagnostics/list`를 제품에 등록한다. 보안 점검(doctor)과 보안 사건 구분을 지운다. 진단 기록(log와 crash)이 redaction을 통과하고 용량 상한을 지키는지 확인한다.

- 단위: platform (wave 3)
- 선행: 계약 고정(contract-platform), core-wiring(wave 0의 core-wiring-split)
- 소유(이 task만 고친다):
  - `packages/core/diagnostics/` 전체
  - `packages/core/main/daemon/wiring/diagnostics.ts` (core-wiring-split이 만든다. 지금 `StatusSource`가 놓인 file이다)
- 읽을 것:
  - spec: 없음. 계약 모양은 `packages/protocol/diagnostics/diagnostics.ts`의 `diagnosticsStatus`, `DIAGNOSTIC_COMPONENTS`(contract-platform)가 정한다
  - inventory: `I1.11#10`, `I1.11#11`, `I2.11#16`, `I2.11#18`, `I3.11#5`
    - 같이 볼 줄(배정이 다른 단위인 것): `I2.11#17`(lophn 내부 오류 분류 `classifyFailure`·`classifyReport`. 배정은 releases-problems이지만 file이 이 폴더 `classify.ts`라 이 task가 한다. 제품이 부르게 이어 주는 일은 releases-problems 몫이라 이 task는 file 안의 `storageFailure`·`safeDetail` 같은 순수 함수를 남기는 것까지다), `I2.11#15`(core API 방어, 코드는 그대로 둬도 된다. 건드리지 않는다)
  - 결정: `../../tmp/ui-inventory.md` 6.7(Diagnostics는 사람이 [Run checks]를 누를 때만 점검하고 보안 점검은 없다)
  - 본보기(화면): `tools/wireframes/frames/compositions/workspace/diagnostics-pane.tsx`, `workspace/data.ts`의 `DIAGNOSTICS`(Core service, Ledger, Event stream, App runtime, Sandbox, Agent runtime, Terminal)
  - 지금 코드: `packages/core/diagnostics/{status,list,doctor,classify,log,files,pipe}.ts`, `worker/doctor.ts`, `packages/core/main/daemon/core.ts`의 `StatusSource`(components 목록, 약 860~930행)
- 계약:
  - 쓰는 것: `protocol/diagnostics`의 `diagnosticsStatus`, `DIAGNOSTIC_COMPONENTS`, `diagnosticsList`, `diagnosticRecordSchema`(contract-platform)
  - 내놓는 것
    - `core/diagnostics/mod.ts`: `ComponentCheck`(lead가 `core/diagnostics/ports.ts`에 이미 두었다. 이 task는 그것을 쓴다), `createComponentChecks`, `diagnosticsStatusHandler`, `createLogRecordSource`. `ComponentCheck = { component: DIAGNOSTIC_COMPONENTS의 값, check(): Promise<{ available: boolean; reason?: string }> }`.
    - `wiring/diagnostics.ts`: `Wiring`을 내놓는다. `build`에서 `Built.memory`에 `diagnostics/status` handler를 내고, `Built.reads`(읽기 map 덧씌우기)로 `diagnostics/list` handler를 더한다. 이 task는 `core`와 `ledger` check를 짓고, 나머지(`events`, `app-runtime`, `sandbox`, `agent-runtime`)는 각 owner의 wiring이 `ComponentCheck`를 `WiringContext`의 `componentChecks` 칸에 더한다(칸은 lead가 `context.ts`에 더한다).

## 할 일

1. **구성 요소 점검** `core/diagnostics/components.ts` (새 file) — `I2.11#16`
   - `ComponentCheck` port를 정의한다. `core`는 API가 요청을 받는지(`ready`), `ledger`는 writer·reader가 healthy인지로 짓는다(지금 `core.ts`의 `components()`의 `api`·`writer`·`reader` 판단을 옮긴다).
   - `available: false`면 `reason`이 반드시 있다. 고정된 안전한 문장만 쓰고 경로·key·값·OS 오류 원문을 싣지 않는다. check가 throw하면 `available: false`와 고정 이유 "check failed"로 바꾼다.
2. **status handler** `core/diagnostics/status.ts` 다시 짜기 — `I2.11#16`
   - `diagnosticsStatus`(memory route) handler: 호출할 때마다 모든 `ComponentCheck`를 동시에 돌리고 각 점검 시각(`checked_at`)과 응답 시각(`checked_at`)을 주입한 clock으로 기록한다(지난 시각을 재사용하지 않는다). 한 check가 오래 걸려도 다른 check를 막지 않는다(check마다 timeout, 시간 초과는 `available: false`).
   - `platform/status`·`platform/health` 읽기(`platformStatusReads`, `PLATFORM_STATUS_ROUTES`)는 core 기동 감시(`main/daemon/parent.ts`)가 쓰므로 모양을 바꾸지 않는다. `StatusSource.components()`는 새 process 구성에 맞춰 같은 `ComponentCheck` 목록을 쓰게 한다.
3. **list 등록** `core/diagnostics/list.ts` — `I3.11#5`
   - `DiagnosticListSource`를 채운다: `createLogFiles`가 쓰는 `<root>/logs/platform-*.jsonl`(JSON 줄)을 읽어 `DiagnosticRecord`로 바꾸는 `createLogRecordSource(root)`. 읽을 수 없는 줄은 건너뛰고 개수만 안전한 log로 남긴다. 최근 순서, 한 번에 최대 200개.
   - wiring file이 `diagnosticsList` read를 등록한다(지금은 제품 core가 `openRuntime`에 `diagnostics`를 넘기지 않아 등록되지 않는다).
4. **log와 crash** — `I2.11#18`
   - `createSafeLog`·`createLogFiles`(redaction 통과, 파일 5개×10MiB 회전)는 그대로다. crash 기록 경로를 확인한다: daemon·I/O worker·agent runtime의 처리하지 못한 오류와 `unhandledrejection`이 `Diagnostic`(`kind: "lophn_internal"`)으로 `createSafeLog`를 지나는지 본다(`grep -rn "unhandledrejection\|addEventListener(\"error\"" packages/core`). 지나지 않는 곳이 소유 안(`core/diagnostics`)에 있으면 이어 주고, 소유 밖이면 보고에 file과 줄을 적는다.
5. **지울 것** — `I1.11#10`, `I1.11#11`
   - `doctor.ts`의 점검(`runCheck`, `DoctorObservation`, `SdkHashObservation`, `GrantRiskObservation`, `CredentialPermissionObservation`, `UNUSED_GRANT_MS`, `diagnosticsCheckRead`, `DIAGNOSTICS_CHECK_ROUTE`, `warmPatternRevision`), `worker/doctor.ts`, `classifySecurity`, `SECURITY_DIAGNOSTIC_KINDS`, `SecurityDiagnostic`. `storageFailure`와 `safeDetail`(req-0450)은 남긴다. 남기는 것만 `core/diagnostics/storage-failure.ts`로 옮기고 `doctor.ts`는 지운다.
   - `mod.ts`의 export를 줄인다. 소유 밖에서 쓰는 export가 있으면 남기고 보고한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. (진단은 화면에 보이는 값이고 secret 경계는 platform-secrets의 test가 맡는다. 단 status handler가 `available: false`에 이유 없이 돌려주지 않는다는 규칙은 handler 안의 검사로 지킨다.)
- 남지 않음: `grep -rn "SECURITY_DIAGNOSTIC_KINDS\|classifySecurity\|diagnosticsCheck\|DoctorObservation" packages/core`가 0줄이다(소유 밖 쓰는 곳은 보고).

## 보고

- 바꾼 file
- 등록할 것: `assembly.ts`의 `WIRINGS`에 diagnostics wiring, `wiring/context.ts`에 `componentChecks` 칸, 각 owner(events, apps, supervision, agent runtime)가 그 칸에 더할 `ComponentCheck`, `ALL_ROUTES`에 `DIAGNOSTIC_STATUS_ROUTES`(contract-platform의 등록할 것), renderer가 부르는 memory route `diagnostics/status`의 allowlist(platform-desktop)
- 안 쓰게 된 export: `diagnosticsCheck`·`DIAGNOSTIC_CHECKS`(protocol, cleanup이 지운다), 위 규칙으로 남긴 export
- 정한 것: 문서에 답이 없어 정한 것(check timeout 값, list의 최대 개수, `ComponentCheck` 모양)
- 넘기는 일: Terminal 점검은 shell main이 안다(wireframe의 Terminal 행). core가 점검하는 여섯 요소와 따로 screens-workspace가 터미널 host의 사용 가능 여부를 어떻게 얻을지 정해야 한다
