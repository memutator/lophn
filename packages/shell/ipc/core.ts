// renderer가 main에 요청하는 read·command와 worker에서 조립하는 읽기, 몇 개의 memory route, 그리고
// byte route. token·port·종료는 이 schema에 없다. 어떤 worker·memory·upload·file route를 받을지는
// main의 allowlist가 정한다. `upload`는 `bytes`를 본문으로 보내고(`body`는 route 입력) `file`은
// `{ bytes, contentType }`로 답한다.
import { z } from "zod";

// preload의 검사는 renderer 쪽 realm에서 돌아 `instanceof`가 어긋날 수 있다. 이름표로 본다.
const bytes = z.custom<Uint8Array>((value) =>
  Object.prototype.toString.call(value) === "[object Uint8Array]"
);

export const coreCallSchema = z.object({
  kind: z.enum(["read", "command", "worker", "memory", "upload", "file"]),
  resource: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  method: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  body: z.unknown(),
  bytes: bytes.optional(),
}).strict().refine((call) =>
  (call.kind === "upload") === (call.bytes !== undefined)
);

export type CoreCall = z.infer<typeof coreCallSchema>;

/** main이 renderer로 미는 연결 상태. 화면은 이 값만 본다. */
export const connectionStateSchema = z.object({
  state: z.enum([
    "starting",
    "ready",
    "stale",
    "failed",
    "failed-start",
    "failed-sandbox",
    "failed-schema",
  ]),
  confirmedAt: z.number().nullable(),
  /** `failed-schema`일 때 어느 경우인지. 시작 실패 화면이 구별해 보인다. */
  schemaFailure: z.enum([
    "newer_schema",
    "history_mismatch",
    "damaged_original",
  ]).optional(),
}).strict();

export type ConnectionState = z.infer<typeof connectionStateSchema>;

export const CORE_CALL_CHANNEL = "shell:core-call";
export const CORE_STATE_CHANNEL = "shell:core-state";
/** 구독을 시작한 renderer가 지금 연결 상태를 한 번 묻는다. main이 push를 다시 하지 않는다. */
export const CORE_STATE_GET_CHANNEL = "shell:core-state-get";

/** main → renderer push. Gateway의 ready·event·closed frame을 그대로 넘긴다. */
export const CORE_EVENT_CHANNEL = "shell:core-event";
/** renderer → main invoke. 이 renderer의 구독 조건 전체로 바꾼다. */
export const CORE_WATCH_CHANNEL = "shell:core-watch";

// event 본문은 renderer가 protocol의 busEventSchema로 읽는다. shell은 protocol을 import하지 않는다.
export const coreEventMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready") }).strict(),
  z.object({ kind: z.literal("event"), event: z.unknown() }).strict(),
  z.object({
    kind: z.literal("closed"),
    reason: z.enum(["slow_consumer", "credential_revoked", "shutdown"]),
  }).strict(),
]);

export type CoreEventMessage = z.infer<typeof coreEventMessageSchema>;

// 조건 전체를 통째로 바꾼다. main은 연결이 새로 붙을 때마다 이 조건으로 다시 걸고 ready를 다시 민다.
export const coreWatchSchema = z.object({
  conditions: z.array(
    z.object({
      session: z.string().optional(),
      types: z.array(z.string()).optional(),
    }).strict(),
  ),
}).strict();

export type CoreWatch = z.infer<typeof coreWatchSchema>;
