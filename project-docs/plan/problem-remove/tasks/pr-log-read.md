# pr-log-read

`app.logs` route가 supervisor 메모리 buffer 대신 앱 log file에서 읽고, input·output을 `pr-log-contract`의 모양으로 바꾼다. invocation, 시각, 줄 수로 거른다. 메모리 log buffer와 supervisor의 `logs` op를 지운다.

- 단위: log (wave 4)
- 선행: pr-log-writer, pr-problems-core. file이 쓰이고, 옛 모양을 쓰던 collector와 `problem.more`가 없어진 뒤다.
- 소유(이 task만 고친다):
  - `packages/protocol/apps/runtime.ts`
  - `packages/protocol/apps/app-log.ts` (`pr-log-contract`가 만든 file)
  - `packages/core/apps/runtime/reads.ts`
  - `packages/core/apps/runtime/control-protocol.ts`
  - `packages/core/apps/runtime/supervisor-link.ts`
  - `packages/core/apps/runtime/supervisor-link_test.ts`
  - `packages/core/apps/runtime/mod.ts`
  - `packages/core/apps/runtime/observations/log-buffer.ts`
  - `packages/core/apps/control.ts`
  - `packages/core/apps/register.ts`
  - `packages/core/main/app-supervisor/assembly.ts`
  - `packages/core/diagnostics/log.ts`
  - `packages/protocol/supervision/supervision.ts`
- 읽을 것:
  - 제품 결정: `project-docs/plan/problem-remove/README.md` "정한 것"의 "앱 log를 앱마다 file로 남긴다"(읽기는 file에서, invocation·시각·줄 수로 거른다)와 "App Engineer에게 앱 log, invocation, 앱 상태 읽기 tool을 연다"(coding agent CLI가 쓰는 core route를 그대로 쓴다), "뼈대 검토에서 정한 것" 첫 항목(보통 stdout·stderr 줄은 invocation이 null이고 시각으로 찾는다)
  - 계약: `project-docs/plan/problem-remove/tasks/pr-log-contract.md`의 "내놓는 것"(file 자리, 줄 모양, 읽기 모양), `project-docs/plan/problem-remove/tasks/pr-log-writer.md`(file을 쓰는 쪽, preview 출력은 file에 없다)
  - architecture: `project-docs/architecture/app-call.md`(secret 값이 log에 없다), `project-docs/architecture/layers.md`("실행 때 import가 뜻하는 것": reader Worker와 메인 스레드)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-runtime`, `core-api`, `coding-agent-cli-interface`(CLI `app logs`가 같은 route를 쓴다), `child-supervision-protocol`(supervisor op를 지운다), `diagnostics`; `project-docs/module-catalog.yaml`의 `packages/core/apps`, `packages/core/main`, `packages/core/diagnostics`, `packages/protocol`
  - 코드
    - `packages/protocol/apps/runtime.ts`(`appLogs`, `appLogsInputSchema`, `appLogsOutputSchema`, `LOG_LINE_*`, `AppLogState`, `readActors`), `packages/protocol/apps/app-log.ts`
    - `packages/core/apps/runtime/reads.ts`(reader의 `logs` handler, `RuntimeSources`, `withRuntimeLogs`, `withRuntimeObservation`)
    - `packages/core/apps/control.ts`(`APPS_CONTROL_CONTEXT` 근처 operation 정책의 `appLogs` 줄, `sources`, `overlayReads`, `deps.redact`, `deps.activation?.dataRoot ?? deps.previews?.dataRoot`를 쓰는 곳)
    - `packages/core/apps/runtime/supervisor-link.ts`(`SupervisorClient.logs`), `packages/core/apps/runtime/control-protocol.ts`(`SUPERVISOR_OPS.logs`, `logsInputSchema`, `logsOutputSchema`, `LogsWire`)
    - `packages/core/main/app-supervisor/assembly.ts`(`buffers`, `bufferOf`, `Assembly.logs`, ops의 `[SUPERVISOR_OPS.logs]`, `pr-log-writer`가 둔 buffer 이음, preview `spawn`이 쓰는 `preview:<app>` buffer)
    - `packages/core/apps/runtime/observations/stream-decoder.ts`(`drain`, `createStreamDecoder`)
    - `packages/protocol/supervision/supervision.ts`(`DIAGNOSTIC_KINDS`, `diagnosticSchema`의 `app_log_line_loss`), `packages/core/diagnostics/log.ts`(`descriptions`)
    - `packages/protocol/coding-agent/cli-commands.ts`(`app logs`가 `appLogs.input`·`appLogs.output`을 그대로 쓴다. 고치지 않는다)
- 계약:
  - 쓰는 것: `pr-log-contract`의 `appLogFile`, `appLogPreviousFile`, `appLogLineSchema`, `appLogsReadInputSchema`, `appLogsReadOutputSchema`, `APP_LOG_READ_MAX_LINES`
  - 내놓는 것:
    - `appLogs`(`apps/logs`, name `app.logs`)는 `packages/protocol/apps/runtime.ts`에 그대로 두고 input·output을 `app-log.ts`의 `appLogsReadInputSchema`·`appLogsReadOutputSchema`로 바꾼다. registry와 CLI의 import는 그대로다. actors는 `user`, `coding_agent`, `agent`, `app`이다(collector가 쓰던 `machine`을 뺀다). coding agent CLI `app logs`와 `pr-agent-tools`의 `app.logs`가 이 모양을 쓴다.
    - core가 `app.log.1`과 `app.log`를 바로 읽는다. 읽는 데 supervisor가 필요 없다.
    - 지운다: `log-buffer.ts`, supervisor op `logs`와 `logsInputSchema`·`logsOutputSchema`·`LogsWire`, `withRuntimeLogs`, `AppLogState`, `LOG_LINE_MAX_COUNT`, `LOG_LINE_MAX_LENGTH`, 옛 `appLogsOutputSchema`, 쓰는 곳이 없어지면 진단 `app_log_line_loss`

## 할 일

근거: README "앱 log를 앱마다 file로 남긴다", `pr-log-contract`의 읽기 모양, `project-docs/architecture/layers.md`의 reader Worker와 메인 스레드 나눔.

1. `packages/protocol/apps/runtime.ts`
   - `appLogs`의 `input`을 `appLogsReadInputSchema`, `output`을 `appLogsReadOutputSchema`(`./app-log.ts`)로, `actors`를 `readActors`로 바꾼다. collector(machine)를 말하는 주석을 지운다.
   - 지운다: `LOG_LINE_MAX_COUNT`, `LOG_LINE_MAX_LENGTH`, `logLineSchema`, `APP_LOG_STATES`, `appLogStateSchema`, `AppLogState`, `appLogsInputSchema`, `appLogsOutputSchema`.
2. `packages/protocol/apps/app-log.ts`: 바꿀 것이 없으면 두지 않는다. "옛 `appLogs`는 그대로"처럼 이제 틀린 주석이 있으면 맞춘다.
3. `packages/core/apps/runtime/reads.ts`
   1. reader의 `logs` handler: machine 갈래(`ctx.actor === "machine"`)를 지운다. 접근 판정(`loadApp`, `authorizeApp(..., appLogs.name, ...)`)은 그대로다. 답은 `{ lines: [], truncated: false, as_of_seq, next_cursor: null }`이다(메인 스레드가 덮는다).
   2. `withRuntimeLogs`, `RuntimeSources.logs`, `RuntimeLogSource`, `RuntimeReadDeps.logs`, `DEFAULT_LOG_LIMIT`과 `AppLogState`·`LOG_LINE_*` import를 지운다. `RuntimeSources.redact`는 쓰는 곳이 없어지면 지운다.
   3. file을 읽는 메인 스레드 덮기를 새로 둔다(이름은 worker가 정한다. 예: `withAppLogFile(base, { read, redact })`).
      - 정한 것: 지금처럼 reader가 접근을 판정하고 메인 스레드가 덮는다. 이유: reader Worker의 read handler는 동기이고 data root를 모른다(`packages/core/storage/ledger/reader-worker.ts`).
      - `read(app): Promise<string[]>`는 `app.log.1`, `app.log` 순서의 file 글이다(없는 file은 빈 글). 조립(`control.ts`)이 넘긴다(AGENTS.md "코드": 파일 시스템은 인자로 받는다).
      - 두 file을 통째로 이어 줄로 나눈다. 줄마다 `JSON.parse`와 `appLogLineSchema` 검사를 하고 통과하지 못한 줄(crash로 반쯤 쓴 끝 줄)은 건너뛴다.
      - 거르기: `invocation`이 주어지면 같은 줄만, `since <= at`, `at < until`(`At`은 고정 꼴이라 글자 비교가 시각 비교다). 순서는 file 순서 그대로다(정렬하지 않는다).
      - 맞는 줄 가운데 마지막 `limit`(없으면 `APP_LOG_READ_DEFAULT_LINES`. `pr-log-contract`가 이 이름을 안 만들었으면 그 file의 기본 200)줄을 오래된 것부터 준다. 더 오래된 맞는 줄이 남았으면 `truncated: true`다. `next_cursor`는 null이다.
      - 읽을 때 redaction: 줄마다 `text`를 `redact`(core의 알려진 secret까지 지우는 것, `AppsControlDeps.redact`)에 다시 통과시키고 `APP_LOG_TEXT_MAX_CHARS`로 자른다. 지금 `withRuntimeLogs`가 하던 두 번째 겹이다. 하나라도 null(안전화를 못 끝냄)이면 그 읽기 전체를 `unavailable`로 답한다.
        - 정한 것: 지금은 빈 줄로 답했다. 새 모양에는 `state`가 없어 "줄 없음"과 "안전화 실패"를 가를 수 없어서 오류로 답한다.
      - 정한 것: 두 file을 통째로 읽는다(합쳐 16 MiB 상한). 돌리기와 겹친 읽기에서 줄이 빠지거나 겹치는 것은 다루지 않는다.
   4. 머리 주석("최대 200줄 log", "supervisor log buffer")을 맞춘다.
4. `packages/core/apps/control.ts`
   - `sources`의 `logs`(와 쓰는 곳이 없어지면 `redact`)를 지운다.
   - `overlayReads`가 `withRuntimeLogs` 대신 새 덮기를 붙인다. `read`는 data root(`deps.activation?.dataRoot ?? deps.previews?.dataRoot`. 같은 file에서 이미 쓰는 방식)와 `appLogPreviousFile`·`appLogFile`, `Deno.readTextFile`(`NotFound`는 빈 글)로 만들고, `redact`는 `deps.redact`다. data root가 없으면(부분 조립) 덮지 않는다. reader의 빈 답이 그대로 간다.
     - 정한 것: `packages/core/main/daemon/wiring/apps.ts`를 고치지 않으려고 이미 있는 data root를 쓴다.
   - operation 정책의 `{ name: appLogs.name, actors: ["machine"], ... }` 줄이 아직 있으면 지운다(`pr-problems-core`의 몫이다. 이미 없으면 그대로).
   - 머리 주석("runtime·logs read의 메인 스레드 덮기, supervisor 감독 pipe의 질의 통로")을 맞춘다.
5. `packages/core/apps/runtime/supervisor-link.ts`: `SupervisorClient.logs`, `createSupervisorClient`의 `logs`, `logsOutputSchema`·`LogsWire` import를 지운다. `supervisor-link_test.ts`는 깨지면 맞춘다(지금은 `logs`를 쓰지 않는다).
6. `packages/core/apps/runtime/control-protocol.ts`: `SUPERVISOR_OPS.logs`, `logsInputSchema`, `logsOutputSchema`, `LogsWire`를 지운다.
7. `packages/core/apps/runtime/observations/log-buffer.ts`를 지운다. `packages/core/main/app-supervisor/assembly.ts`에서
   - `buffers`, `bufferOf`, `Assembly.logs`, ops의 `[SUPERVISOR_OPS.logs]`, `pr-log-writer`가 둔 buffer 쪽 decoder 이음, `createLogBuffer`·`LogBuffer`·`logsInputSchema` import를 지운다.
   - 운영 자식의 stdout·stderr는 `logFileOf(app)`의 `attach`만 읽는다(stderr는 지금처럼 `tee`를 지난다).
   - preview 자식의 stdout·stderr는 읽어서 버린다(`stream-decoder.ts`의 `drain`과 아무것도 하지 않는 `createStreamDecoder`). 읽지 않으면 pipe가 차서 자식이 막힌다(지금 주석 "읽지 않으면 자식이 막힌다").
   - `diagnosticSchema` import가 안 쓰이게 되면 지운다.
8. 진단 `app_log_line_loss`: 7 뒤에 쓰는 곳이 없으면 `packages/protocol/supervision/supervision.ts`의 `DIAGNOSTIC_KINDS`와 `diagnosticSchema` 갈래, `packages/core/diagnostics/log.ts`의 `descriptions`에서 지운다.
9. `packages/core/apps/register.ts`, `packages/core/apps/runtime/mod.ts`: `createRuntimeReads`의 꼴이나 export가 바뀌었으면 맞춘다. 아니면 두지 않는다.
10. 지운 이름과 문자열을 grep해 주석과 오류 메시지에 남은 것도 고친다(supervisor op 문자열 `"apps.logs"`, `log buffer`, `200줄`, `collector`).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 읽기 거르기는 사용자 data를 잃거나 권한 경계를 넓히지 않는다(접근 판정 `authorizeApp`은 그대로이고 `machine`을 빼 좁힌다). file에 secret이 남지 않는 것은 `pr-log-writer`의 test가 본다(한 동작은 한 층에서, `.claude/skills/write-test/SKILL.md`).
- core 확인: `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다.
- 남지 않음
  - `grep -rn "LOG_LINE_MAX_COUNT\|LOG_LINE_MAX_LENGTH\|AppLogState\|appLogsOutputSchema\|appLogsInputSchema\|withRuntimeLogs\|createLogBuffer\|LogBuffer\|LogsWire\|logsInputSchema\|logsOutputSchema\|SUPERVISOR_OPS.logs" packages tools`가 0줄이다.
  - `grep -rn "log-buffer\|collected_at" packages tools`와 `grep -rnF '"apps.logs"' packages tools`가 0줄이다.
  - 할 일 8을 했으면 `grep -rn "app_log_line_loss" packages tools`가 0줄이다.

## 보고

- 바꾼 file과 지운 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`packages/protocol/apps/mod.ts` 등). 없음이면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다). 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것"을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
