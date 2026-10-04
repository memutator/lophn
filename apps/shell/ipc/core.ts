// renderer가 main에 요청하는 read·command. token·port·종료는 이 schema에 없다.
import { z } from "zod";

export const coreCallSchema = z.object({
  kind: z.enum(["read", "command"]),
  resource: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  method: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  body: z.unknown(),
}).strict();

export type CoreCall = z.infer<typeof coreCallSchema>;

/** main이 renderer로 미는 연결 상태. 화면은 이 값만 본다. */
export const connectionStateSchema = z.object({
  state: z.enum(["starting", "ready", "stale", "failed"]),
  confirmedAt: z.number().nullable(),
}).strict();

export type ConnectionState = z.infer<typeof connectionStateSchema>;

export const CORE_CALL_CHANNEL = "shell:core-call";
export const CORE_STATE_CHANNEL = "shell:core-state";
