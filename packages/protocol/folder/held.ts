// 사람과 그 앱의 agent가 sync log의 held 줄을 푼다(README 계약 10). held는 정리된 흔적과 부딪을 수 있어 적용하지도
// 내보내지도 않은 변경이다. 저절로 풀리지 않는다.
// - list: 풀리지 않은 held 줄과 각 줄이 건드리는 표·종류.
// - apply: 그 변경을 지금 clock의 이 기계 write로 다시 적용해 보통처럼 내보낸다(사람의 다시 정함). 지금 data와 부딪으면 conflict.
// - discard: 적용하지 않고 푼다. bytes는 기록에 남는다.
import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";
import { atSchema } from "../base/values.ts";
import { appIdSchema, toolCallIdSchema } from "../apps/channel-values.ts";

const heldChangeSchema = z.object({
  seq: z.number().int().positive(),
  origin: z.enum(["computer", "device", "rewind", "machine"]),
  machine: idSchema("mch").nullable(),
  device: idSchema("dev").nullable(),
  hlc: z.string().nullable(),
  // 그 변경이 건드리는 row마다 표, 종류, 그 변경의 때(clock의 시각).
  changes: z.array(
    z.object({ table: z.string(), op: z.string(), at: atSchema }),
  ),
});

export const appSyncHeld = defineMemory({
  resource: "apps",
  method: "sync_held",
  name: "app.sync_held",
  input: z.strictObject({
    app: appIdSchema,
    action: z.enum(["list", "apply", "discard"]),
    // apply·discard가 고르는 held 줄.
    seq: z.number().int().positive().optional(),
    // agent가 부르면 그 tool call. apply의 invocation caller가 된다.
    tool_call: toolCallIdSchema.optional(),
  }),
  output: z.object({
    held: z.array(heldChangeSchema).optional(),
    invocation: idSchema("inv").optional(),
  }),
  actors: ["user", "agent"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

// 이 기계의 하위 폴더에 이 기계가 쓰지 않은 file이 보여(알아채지 못한 복제) 멈춘 내보내기를 사람이 다시 켠다.
// 그 file이 아직 있으면 다음 내보내기가 다시 멈춘다. 사람만 한다.
export const appSyncResume = defineMemory({
  resource: "apps",
  method: "sync_resume",
  name: "app.sync_resume",
  input: z.strictObject({ app: appIdSchema }),
  output: z.object({ resumed: z.boolean() }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});
