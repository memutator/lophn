# pr-log-contract

앱 log를 앱마다 file로 남기는 계약을 protocol에 고정한다: file 자리와 돌리기, 줄 모양, 읽기 route의 새 input·output, 화면 오류를 log에 쓰는 route. 옛 `appLogs` 모양은 그대로 두고 옆에 더한다(바꾸기는 `pr-log-read`).

- 단위: log (wave 2)
- 선행: pr-check-exclude.
- 소유(이 task만 고친다):
  - `packages/protocol/apps/app-storage.ts`
  - `packages/protocol/apps/app-log.ts` (새 file)
- 읽을 것:
  - 제품 결정: `project-docs/plan/problem-remove/README.md` "정한 것"의 "SDK `reportProblem`은 남기고", "잡히지 않은 예외와 화면 오류는 log 줄이 된다", "앱 log를 앱마다 file로 남긴다", "App Engineer에게 앱 log, invocation, 앱 상태 읽기 tool을 연다"와 "뼈대 검토에서 정한 것"의 첫 셋(invocation 표시는 SDK가 쓰는 줄에만, `reportProblem(name, details?)`, 앱 process가 비정상으로 끝난 줄). roadmap `project-docs/products/roadmap/problem-ticket.md`의 "모양"과 "지금 코드"의 앱 log 줄
  - architecture: `project-docs/architecture/app-call.md` "지키는 것"의 바깥 길 줄(secret 값이 앱의 log에 없다, log는 어느 fs grant로도 열리지 않는다), `project-docs/architecture/layers.md`("`packages/protocol`: 경계 사이의 약속")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-runtime`, `core-api`, `child-supervision-protocol`; `project-docs/module-catalog.yaml`의 `packages/protocol`
  - 코드(본보기와 이어 붙일 곳)
    - `packages/protocol/apps/app-storage.ts`(`appFolder`의 앱 id 검사)
    - `packages/protocol/apps/runtime.ts`(옛 `appLogs`, `LOG_LINE_MAX_LENGTH`, `appRuntime`. 이 task는 고치지 않는다)
    - `packages/protocol/apps/apps.ts`(`releaseIdSchema`), `packages/protocol/projects/values.ts`(`appIdSchema`)
    - `packages/protocol/base/route.ts`(`defineMemory`, `DefineOptions`의 필수 `errors`), `packages/protocol/base/envelope.ts`(`withReadCommon`), `packages/protocol/base/values.ts`(`atSchema`), `packages/protocol/base/ids.ts`(`idSchema`의 `inv`)
    - `packages/protocol/apps/annotation.ts`(`annotation.send`: 다른 memory route의 꼴), `packages/protocol/apps/calls/invocation.ts`(`appInvocations`)
    - `packages/core/apps/runtime/observations/log-buffer.ts`(`INVOCATION_MARK`, redaction 뒤 자르기), `packages/shell/main/app-frame/view-error.ts`(`checkViewError`의 상한 256자·16,384자), `packages/protocol/problems/exception-observation.ts`(message가 null일 수 있다)
- 계약:
  - 쓰는 것: `packages/protocol/apps/app-storage.ts`의 `appFolder`, `packages/protocol/base`의 `atSchema`·`idSchema`·`withReadCommon`·`defineMemory`, `packages/protocol/apps/apps.ts`의 `releaseIdSchema`, `packages/protocol/projects/values.ts`의 `appIdSchema`
  - 내놓는 것:
    - file 자리(`app-storage.ts`)
      - `appLogFolder(dataRoot, app)` = `<data root>/apps/<app>/logs`
      - `appLogFile(dataRoot, app)` = `<data root>/apps/<app>/logs/app.log` (지금 쓰는 file)
      - `appLogPreviousFile(dataRoot, app)` = `<data root>/apps/<app>/logs/app.log.1` (돌린 앞 file. 하나만 둔다)
    - 돌리기(`app-log.ts`): `APP_LOG_FILE_MAX_BYTES = 8 * 1024 * 1024`. 줄 하나를 더해 `app.log`가 이 값을 넘게 되면 먼저 `app.log`를 `app.log.1`로 옮기고(앞 `.1`은 버린다) 새 `app.log`에 쓴다. 앱마다 합쳐 16 MiB다. 쓰는 쪽은 app supervisor 하나다.
    - 줄 모양(`app-log.ts`): `APP_LOG_TEXT_MAX_CHARS = 300`(지금 `LOG_LINE_MAX_LENGTH`와 같은 값. `app-log.ts`는 `runtime.ts`를 import하지 않는다. `runtime.ts`가 `app-log.ts`를 import하게 되므로 돌아 import하지 않게 한다). `appLogLineSchema` / `type AppLogLine` = `{ at: At, invocation: inv id | null, text: string(≤ APP_LOG_TEXT_MAX_CHARS) }`. file은 JSON Lines이고 줄마다 `AppLogLine` 하나다. `text`는 redaction한 뒤 자른 값이다.
    - `text`의 꼴(쓰는 task가 다 다르므로 여기서 고정한다)
      - 앱 stdout·stderr 한 줄은 그대로다. 머리의 `[inv=<id>] `는 지금 log buffer처럼 떼어 `invocation`에 둔다.
      - SDK `reportProblem`: `error <name>`, message가 있으면 `: <message>`, details가 있으면 한 칸 띄고 그 JSON
      - 앱 process의 비정상 종료: `process_exit <근거>: <message>`(근거: `unexpected_exit` | `v8_oom` | `start_failed` | `ready_timeout` | `crash_loop`)
      - 잡히지 않은 예외: `exception <name>: <message>` 한 줄, 그 뒤 원래 source로 푼 frame마다 `  at <bundle 기준 상대 path>:<line>:<column>` 한 줄(같은 `invocation`, 예외 줄 바로 뒤에 이어서. `at`이 같다는 보장은 없다)
      - 화면 오류: `view_error <observation> <name>: <message>`
    - 읽기 모양(`app-log.ts`)
      - `APP_LOG_READ_MAX_LINES = 1000`, 기본 `limit`은 200
      - `appLogsReadInputSchema` = `{ app, invocation?: inv id, since?: At(포함), until?: At(제외), limit?: 1..APP_LOG_READ_MAX_LINES }`
      - `appLogsReadOutputSchema` = `withReadCommon({ lines: AppLogLine[], truncated: boolean })`. 조건에 맞는 줄 가운데 가장 최근 `limit`줄을 오래된 것부터 준다. 더 오래된 맞는 줄이 남았으면 `truncated: true`다. file이 없으면 `lines`가 비어 있다. 두 file(`app.log.1`, `app.log`)을 이어서 본다.
      - route `appLogs`(`apps/logs`, name `app.logs`)는 자리(`runtime.ts`)와 이름을 그대로 두고 `pr-log-read`가 위 input·output으로 바꾼다.
    - 화면 오류 route(`app-log.ts`): `appLogViewError` = `defineMemory({ resource: "apps", method: "log_view_error", name: "app.log_view_error", input: { app, release: rel id | null, mode: "live" | "preview", observation: "error" | "unhandledrejection" | "render_error", name: 공백 아닌 1~256자, message: 16,384자 이하 | null }, output: { written: boolean }, actors: ["user"] })`. registry 등록과 handler는 `pr-log-view-error`가 한다.
    - App Engineer와 lophn의 새 읽기 tool 이름(코드는 `pr-agent-tools`)
      - `app.status` → `appRuntime`(`apps/runtime`, `app.runtime`)
      - `app.logs` → `appLogs`(`apps/logs`, `app.logs`), 입력은 `appLogsReadInputSchema`
      - `app.invocations` → `appInvocations`(`apps/invocations`, `app.invocations`)
      - 셋 모두 lophn과 App Engineer의 `builtinToolNames`에만 든다.

## 할 일

새 이름만 더한다. 옛 `appLogs`, `LOG_LINE_MAX_COUNT`, `LOG_LINE_MAX_LENGTH`(`packages/protocol/apps/runtime.ts`)는 그대로 둔다(쓰는 곳이 남아 있다. 바꾸기는 `pr-log-read`, `.claude/skills/orchestrate/brief-template.md` "계약 task의 brief"). 근거는 README "정한 것"과 위 계약이다.

1. `packages/protocol/apps/app-storage.ts`에 `appLogFolder`, `appLogFile`, `appLogPreviousFile`를 더한다. 셋 다 `appFolder(dataRoot, app)`를 거쳐 앱 id를 검사한다(값이 data root 밖으로 나가는 path를 만들지 못하게 하는 이 file의 규칙). 붙이는 조각은 고정 글자(`logs`, `app.log`, `app.log.1`)다.
2. `packages/protocol/apps/app-log.ts`를 새로 만든다. import는 `zod`, `../base/values.ts`(`atSchema`), `../base/ids.ts`(`idSchema`), `../base/envelope.ts`(`withReadCommon`), `../base/route.ts`(`defineMemory`), `./apps.ts`(`releaseIdSchema`), `../projects/values.ts`(`appIdSchema`)뿐이다. `./runtime.ts`를 import하지 않는다.
   1. 상수: `APP_LOG_FILE_MAX_BYTES`, `APP_LOG_TEXT_MAX_CHARS`, `APP_LOG_READ_MAX_LINES`, 기본 줄 수.
      - 정한 것: 기본 줄 수는 `APP_LOG_READ_DEFAULT_LINES = 200`으로 export한다. 이유: `pr-log-read`의 handler와 `pr-agent-tools`의 tool 설명이 같은 값을 쓴다.
   2. `appLogLineSchema`(`z.object`, `at: atSchema`, `invocation: idSchema("inv").nullable()`, `text: z.string().max(APP_LOG_TEXT_MAX_CHARS)`)와 `type AppLogLine`.
   3. file 모양(JSON Lines, 돌리기, 쓰는 쪽은 supervisor 하나)과 계약의 `text`의 꼴 전부를 머리 주석으로 적는다. 쓰는 task(`pr-log-writer`, `pr-log-sdk`, `pr-log-exception`, `pr-log-view-error`)가 이 주석을 본다. SDK는 앱 bundle 안이라 zod·protocol을 import하지 못하므로(`packages/protocol/problems/sdk-report.ts` 머리 주석) 꼴은 함수가 아니라 글로 고정한다.
      - 정한 것: message가 null이거나 빈 문자열이면 `: <message>`를 뺀다(예: `exception TypeError`, `error sync_failed`). 이유: 화면 오류(`view-error.ts`)와 예외 관측(`exception-observation.ts`)의 message는 null일 수 있고, README "뼈대 검토에서 정한 것"의 `reportProblem(name, details?)`은 `details`가 없을 수 있다.
      - 정한 것: `reportProblem` 줄의 `<message>`는 `details`를 글로 한 것이다(string이면 그대로, 아니면 JSON). `pr-log-sdk`가 같은 꼴로 쓴다. 계약 줄의 `<message>`를 이 뜻으로 적는다.
   4. `appLogsReadInputSchema`: `z.strictObject({ app: appIdSchema, invocation: idSchema("inv").optional(), since: atSchema.optional(), until: atSchema.optional(), limit: z.number().int().min(1).max(APP_LOG_READ_MAX_LINES).optional() })`. `since`는 포함, `until`은 제외라고 주석에 쓴다.
   5. `appLogsReadOutputSchema`: `withReadCommon(z.object({ lines: z.array(appLogLineSchema).max(APP_LOG_READ_MAX_LINES), truncated: z.boolean() }))`.
   6. `appLogViewError`: 계약의 `defineMemory`. input은 `z.strictObject`이고 `name`은 `z.string().regex(/\S/).max(256)`, `message`는 `z.string().max(16_384).nullable()`이다(지금 `view-error.ts`의 `VIEW_ERROR_NAME_MAX_CHARS`·`VIEW_ERROR_MESSAGE_MAX_CHARS`와 같은 값).
      - 정한 것: `errors: ["invalid_input", "unauthorized", "not_found", "unavailable"]`. 이유: 사람만 부르고, 실패는 모양 거절, 없는 앱, supervisor 없음뿐이다. `defineMemory`는 `errors`가 필수다.
   7. 새 읽기 tool 이름 셋은 코드가 없다(`pr-agent-tools`가 만든다). `app-log.ts`에 적지 않는다.
3. `packages/protocol/apps/mod.ts`에 `export * from "./app-log.ts"`가 필요하다. lead가 등록한다(보고의 "등록할 것"). 새 이름은 `runtime.ts`의 이름과 겹치지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 모양과 상수만 정하고 상한은 zod가 본다(`.claude/skills/write-test/SKILL.md` "쓰지 않는 test"). 상한을 넘기는 판정(돌리기)은 `pr-log-writer`의 test가 본다.
- 남지 않음: `grep -n "runtime.ts" packages/protocol/apps/app-log.ts`가 0줄이다(돌아 import하지 않는다).
- 옛 `appLogs`와 `LOG_LINE_MAX_*`가 그대로 있다(`grep -n "LOG_LINE_MAX_LENGTH\|export const appLogs " packages/protocol/apps/runtime.ts`가 그대로 나온다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `packages/protocol/apps/mod.ts`의 `export * from "./app-log.ts"`, 그 밖에 lead가 고칠 목록 file
- 안 쓰게 된 export: 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것" 넷을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
