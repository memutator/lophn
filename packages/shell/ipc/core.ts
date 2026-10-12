// renderer가 main에 요청하는 read·command와 worker에서 조립하는 읽기, 그리고 MCP 로그인의 memory
// route. token·port·종료는 이 schema에 없다. 어떤 worker·memory route를 받을지는 main의 allowlist가
// 정한다.
import { z } from "zod";

export const coreCallSchema = z.object({
  kind: z.enum(["read", "command", "worker", "memory"]),
  resource: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  method: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  body: z.unknown(),
}).strict();

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
}).strict();

export type ConnectionState = z.infer<typeof connectionStateSchema>;

export const CORE_CALL_CHANNEL = "shell:core-call";
export const CORE_STATE_CHANNEL = "shell:core-state";
/** 구독을 시작한 renderer가 지금 연결 상태를 한 번 묻는다. main이 push를 다시 하지 않는다. */
export const CORE_STATE_GET_CHANNEL = "shell:core-state-get";
