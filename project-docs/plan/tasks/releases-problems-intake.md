# releases-problems-intake

문제 보고의 접수 쪽을 새 계약대로 고친다. 앱은 코드가 아니라 이름과 message로 보고하고, collector는 줄인 발생 근거(stack, log, invocation)만 모아 `problem.record_report`로 낸다. 화면 증거와 "값 또는 이유 하나" 짝 체계, 제보의 screenshot·화면 상태를 걷고, 처리되지 않은 오류의 묶는 key를 오류 이름과 앱 source 위치로 바꾼다. 앱 쪽 `sdk/cap-problem`도 한다.

- 단위: releases-problems (wave 3)
- 선행: `releases-problems-register-split`
- 소유(이 task만 고친다):
  - `packages/core/problems/snapshots/` (전부. `register.ts`는 register-split이 만든다)
  - `packages/core/problems/feedback/` (전부)
  - `packages/core/problems/reporting/collector.ts`, `access.ts`, `view-binding.ts`, `work.ts`
  - `packages/core/problems/reporting/worker/` (전부)
  - `packages/core/problems/reporting/adapters/`
  - `packages/sdk/cap-problem/`
- 읽을 것:
  - inventory(lead가 맞추며 더함): `I1.7#7`
  - spec: S4 4장 끝(문제는 보고의 이름과 message로 묶는다), S1 5장(`ProblemOpened`) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`, `.../event.md`
  - spec: S9 1장(제보는 따로다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/annotation.md`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): `I1.7#9`, `I1.7#19`, `I2.1#2`(자기 path의 `from events`만), `I2.7#23`(묶는 key: 처리되지 않은 오류 쪽), `I2.7#24`, `I2.7#25`, `I2.7#26`, `I2.7#31`, `I2.7#38`, `I2.8#11`(snapshots가 쓰는 범주만. 범주 상수와 gc는 platform 몫), `I2.9#6`(core 쪽: `feedback/`), `I2.10#12`(`reporting/collector.ts`의 import)
  - 결정: `../README.md` 3장 #117, #118(설정 선언은 type과 기본값만, 화면 이름은 wording key). `/home/pyosechang/projects/lophn/project-docs/tmp/inventory/00-decisions.md`의 #88
  - 지금 코드: 위 소유 path 전부, `packages/protocol/problems/{reports,snapshots,feedback,sdk-report,exception-observation}.ts`
- 계약:
  - 쓰는 것(contract-releases-problems-problems와 -feedback이 고정): `problemReportInputSchema`, `problemSnapshotInputSchema`, `problemGroupKeyInputSchema`, `problemNameSchema`, 기록 route `problem.record_report`의 입력(`problemReportSchema` 입력, blob purpose 네 개), `problemFeedbackInputSchema`, route `problem.report`·`problem.submit_feedback`, portable `protocol/problems/sdk-problem.ts`의 `ProblemReportCall`·`ProblemReportRequest`. 옛 `observeException`·`observeViewError` route와 `exceptionObservationInputSchema`는 그대로 쓴다. 설정 선언은 contract-platform의 `declareSetting`(`protocol/config/declaration.ts`).
  - 내놓는 것: `snapshots/mod.ts`의 `insertProblemSnapshot(tx, snapshot: ProblemSnapshot)`(`releases-problems-problem-state`가 `problem.record_report` handler에서 부른다). 옛 `insertSnapshotRow`·`SnapshotRow`와 옛 snapshot type은 지우지 않는다(옛 `reporting/commands.ts`가 아직 쓴다). 안 쓰게 되면 보고한다.

## 할 일

1. 접수 (I2.7#24, I2.7#25, I2.7#26). `reporting/worker/collector.ts`(1,491줄)와 `reporting/collector.ts`:
   - `problem.report`(앱)를 받아 `{ name, message, details?, invocation? }`로 report를 만든다. 선언한 problem code 확인(`problemCodeSchema`), 예약 code(`_exception`, `_feedback`, `_invalid_report`)와 `validCode`를 쓰지 않는다. report의 `name`이 이름이다. 처리되지 않은 오류(`observe-exception`, `observe-view-error`)의 `name`은 오류 이름이다.
   - 묶는 key를 만든다. 앱 보고는 `{ kind: "named", name }`. 처리되지 않은 오류는 `{ kind: "exception", discriminator }`이고 discriminator는 `sha256(오류 이름 + 앱 source 위치 "path:line")`이다. 위치는 source map(`snapshots/source-map.ts`)으로 푼 앱 frame 가운데 가장 위 것이고, 못 풀면 그 발생의 Report id를 쓴다. 옛 `grouping/fingerprint.ts`(최대 3 frame 지문)는 쓰지 않는다. 제보는 `{ kind: "feedback", discriminator: report id }`, 기존 문제를 골랐으면 `existing_problem`을 싣는다.
   - 모아 보낼 발생 근거는 `problemSnapshotInput`이다: `invocation`, `error`(`name`, `message`, `frames`, `stack`, `truncation_notes`), `logs`. 값이 없으면 null이다. 이유 칸은 없다.
   - 결과를 `problem.record_report`로 낸다(blob purpose는 `report_text`, `report_details`, `snapshot_stack`, `snapshot_logs` 넷).
2. snapshot (I1.7#9, I2.8#11). `snapshots/`:
   - `screen.ts`를 지운다. `schema.ts`/`model.ts`에서 `screen_*` 열과 `*_missing_reason` 열을 걷는다(개발 data는 지운다. schema step을 그대로 고친다). `reads.ts`/`logs-read.ts`의 화면 부분을 걷는다. `blobs.ts`는 `snapshot_attachment` 범주를 쓰지 않는다.
   - `insertProblemSnapshot`을 더한다. stack은 source map으로 원래 TSX 파일·줄로 푼다(`source-map.ts` 유지), log는 그 무렵 앱 log(`logs.ts`)를 최대 `REPORTING_LIMITS.log_lines`줄, release와 실행 구분(live·preview·test)은 report가 가진다.
3. 제보 (I2.7#31, I2.9#6의 core 쪽). `feedback/`:
   - `model.ts`의 `inspectPng`, `safeScreenState`, `transferBytes`와 `FEEDBACK_LIMITS`의 png·state 칸을 지운다. `work.ts`의 화면 증거 조립을 지운다. 글(`text`, 1~500 scalar)만 받는다. `problem.submit_feedback`을 받아 redaction한 글로 report(source `feedback`, `name = FEEDBACK_PROBLEM_NAME`)를 만든다.
   - `existing_problem`이 있으면 그 문제가 같은 앱의 live 문제인지 확인한다(`adapters/core-problem.ts`의 조회를 유지)하고, 아니면 `invalid_input`이다.
   - 선택한 문제에 쌓는 동작(`feedbackGroup`)은 이미 있는 것을 쓴다.
4. 접수 세부 장치 (I1.7#19, 선택): collector 대기 상한(`collector_pending_*`, `collector_concurrent_assembly`, `automatic_body_bytes`), 발생 재전송 replay 표(`OccurrenceReplays`), 접수 전 redaction 거치기와 본문 읽기 route는 줄여도 된다고 문서가 말한다. 쉽게 줄여지면 줄이고 아니면 두고 보고한다. 접수 60초 20개(`new_reports_per_window`)는 남긴다. redaction 호출 자체는 `packages/base`의 가림 규칙을 계속 쓴다.
5. 설정 (I2.7#38): `detailCollectionSetting`을 `declareSetting`으로 바꾼다. key는 지금 값(`DETAIL_COLLECTION_SETTING_KEY`)을 새 key 규칙(`<owner>.<name>` 소문자)에 맞게 `problems.detail_collection`으로 한다. 타입 `z.boolean()`, 기본값 `true`. 메타 field(설명, 위험, 층, 적용 시점)는 없다. 화면 이름은 wording key(`settingWordingKey`)로 정해진다. 쓰는 곳(collector가 접수마다 읽는 곳)은 contract-platform의 `SettingsReader`로 읽는다. 옛 `defineSetting`을 쓰던 file은 `snapshots/register.ts`다.
6. SDK `sdk/cap-problem` (I2.7#24, I2.7#26): `reportProblem(name, message, details?)`(`ProblemReportCall`). `reporter.ts`, `report-port.ts`, `deliver.ts`가 `ProblemReportRequest`를 쓰고, `guide.md`를 새 꼴(이름과 message, 선언 code 없음)로 다시 쓴다. `exception-observer.ts`는 오류 이름이 묶는 key의 일부가 되므로 `name`을 비우지 않게 한다. 공개 export 이름(`createProblemReporter`, `installProblemReporter`, `reportProblem`, `REPORTER_PORT`, `createExceptionObserver`)은 유지한다. 앱 broker의 보고 입력(`protocol/apps/broker.ts`, contract-app-calls)이 `problemReportInputSchema`를 쓴다.
7. import (I2.10#12): `reporting/collector.ts`의 `DocumentsChannel` import를 lead가 옮긴 공용 위치와 새 이름으로 바꾼다(`projects/file-tracking/...`는 wave 1이 지운다).
8. `from events`(I2.1#2): 이 task의 path에서 `events` 표를 상태 근거로 읽는 곳이 있으면 각 concern의 표 읽기(`reports`, `problems`, `snapshots`)로 바꾼다.
9. 마무리: `snapshots/register.ts`(register-split이 만든 file)를 새 설정 선언과 snapshot 표 이름에 맞춘다. 쓰는 곳이 없어진 옛 코드는 지운다. 다른 task의 file이 import하는 것(예: `snapshots/mod.ts`의 `exceptionGroupKey`를 쓰던 `grouping/`)은 지우지 않고 보고한다.
10. (lead가 맞추며 더함 (`I1.7#7`)) problem code 선언 체계 전부

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "problemCodeSchema\|_invalid_report\|_feedback\|feedback_screenshot\|screen_missing_reason\|inspectPng\|safeScreenState\|snapshot_attachment" packages/core/problems/snapshots packages/core/problems/feedback packages/core/problems/reporting/worker packages/core/problems/reporting/collector.ts packages/sdk/cap-problem`이 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음(등록 file은 register-split이 leaf마다 만든 `snapshots/register.ts`, `reporting/worker/register.ts`가 이 task의 소유다)
- 안 쓰게 된 export: 옛 `insertSnapshotRow`·`SnapshotRow`·옛 snapshot type, `exceptionGroupKey`를 부르던 곳, `FEEDBACK_PROBLEM_MESSAGE`, 그 밖에 이 module을 밖에서 import하던 것 가운데 안 쓰게 된 것의 목록
- 소유 바꾸기: `packages/protocol/apps/broker.ts`의 보고 입력 변경은 contract-app-calls 몫이다. `packages/shell/main/app-frame/feedback.ts`의 새 `shell:feedback-send` 연결은 screens-app-space 몫이다. 보고에 적는다.
- 정한 것: 문서에 답이 없어 worker가 정한 것(예: 처리되지 않은 오류의 위치 형식, 설정 key)
- 계약 바꾸기 요청(wave 3): 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
