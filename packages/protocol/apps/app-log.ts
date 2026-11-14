import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";
import { atSchema } from "../base/values.ts";
import { appIdSchema } from "../projects/values.ts";
import { releaseIdSchema } from "./apps.ts";

// 앱 log 계약. 앱마다 file로 남긴다(자리는 app-storage.ts의 appLogFile).
//
// file 모양
// - JSON Lines이고 줄마다 `AppLogLine` 하나다. `text`는 redaction한 뒤 자른 값이다.
// - 쓰는 쪽은 app supervisor 하나다. 줄 하나를 더해 `app.log`가 APP_LOG_FILE_MAX_BYTES를 넘게 되면
//   먼저 `app.log`를 `app.log.1`로 옮기고(앞 `.1`은 버린다) 새 `app.log`에 쓴다. 앱마다 합쳐 16 MiB다.
// - 읽는 쪽은 `app.log.1`, `app.log` 순으로 이어서 본다.
//
// `text`의 꼴. 쓰는 task마다 다르므로 여기서 고정한다. SDK는 앱 bundle 안이라 zod·protocol을 import하지
// 못해(problems/sdk-report.ts) 함수가 아니라 글로 적는다. 아래 `<message>`가 null이거나 빈 문자열이면
// 어느 줄이든 `: <message>`를 뺀다(예: `exception TypeError`, `error sync_failed`).
// - 앱 stdout·stderr 한 줄: 그대로다. 머리의 `[inv=<id>] `는 떼어 `invocation`에 둔다.
// - SDK `reportProblem(name, message?, details?)`: `error <name>`, message가 있으면 `: <message>`,
//   details가 있으면 한 칸 띄고 그 JSON. invocation 표시는 SDK가 쓰는 줄에만 있다.
// - 앱 process의 비정상 종료: `process_exit <근거>: <message>`.
//   근거는 `unexpected_exit` | `v8_oom` | `start_failed` | `ready_timeout` | `crash_loop`.
// - 잡히지 않은 예외: `exception <name>: <message>` 한 줄, 그 뒤 원래 source로 푼 frame마다
//   `  at <bundle 기준 상대 path>:<line>:<column>` 한 줄. 같은 `invocation`이고 예외 줄 바로 뒤에 이어 쓴다
//   (`at`이 같다는 보장은 없다).
// - 화면 오류: `view_error <observation> <name>: <message>`.

export const APP_LOG_FILE_MAX_BYTES = 8 * 1024 * 1024;
export const APP_LOG_TEXT_MAX_CHARS = 300;
export const APP_LOG_READ_MAX_LINES = 1000;
export const APP_LOG_READ_DEFAULT_LINES = 200;

export const appLogLineSchema = z.object({
  at: atSchema,
  invocation: idSchema("inv").nullable(),
  text: z.string().max(APP_LOG_TEXT_MAX_CHARS),
});
export type AppLogLine = z.infer<typeof appLogLineSchema>;

// since는 포함, until은 제외다. limit을 안 주면 APP_LOG_READ_DEFAULT_LINES줄이다.
export const appLogsReadInputSchema = z.strictObject({
  app: appIdSchema,
  invocation: idSchema("inv").optional(),
  since: atSchema.optional(),
  until: atSchema.optional(),
  limit: z.number().int().min(1).max(APP_LOG_READ_MAX_LINES).optional(),
});

// 맞는 줄 가운데 가장 최근 limit줄을 오래된 것부터 준다. 더 오래된 맞는 줄이 남았으면 truncated다.
// file이 없으면 lines가 비어 있다.
export const appLogsReadOutputSchema = withReadCommon(
  z.object({
    lines: z.array(appLogLineSchema).max(APP_LOG_READ_MAX_LINES),
    truncated: z.boolean(),
  }),
);

const VIEW_ERROR_NAME_MAX_CHARS = 256;
const VIEW_ERROR_MESSAGE_MAX_CHARS = 16_384;

// 앱 화면(shell)에서 잡은 오류를 app log에 쓴다. 사람만 부르고, 실패는 모양 거절, 없는 앱, supervisor 없음뿐이다.
export const appLogViewError = defineMemory({
  resource: "apps",
  method: "log_view_error",
  name: "app.log_view_error",
  changes: [],
  input: z.strictObject({
    app: appIdSchema,
    release: releaseIdSchema.nullable(),
    mode: z.enum(["live", "preview"]),
    observation: z.enum(["error", "unhandledrejection", "render_error"]),
    name: z.string().regex(/\S/).max(VIEW_ERROR_NAME_MAX_CHARS),
    message: z.string().max(VIEW_ERROR_MESSAGE_MAX_CHARS).nullable(),
  }),
  output: z.object({ written: z.boolean() }),
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "not_found", "unavailable"],
});
