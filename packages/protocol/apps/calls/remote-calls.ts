import { z } from "zod";
import { withReadCommon } from "../../base/envelope.ts";
import { idSchema } from "../../base/ids.ts";
import { defineRead } from "../../base/route.ts";
import { atSchema } from "../../base/values.ts";
import { machineIdSchema } from "../../machine/mod.ts";
import { requesterSchema } from "../../machine/requester.ts";
import { appIdSchema } from "../../projects/values.ts";
import { toolNameSchema } from "../channel-values.ts";

// 이 컴퓨터의 agent나 앱이 다른 컴퓨터의 앱 command를 부른 기록이다. 받는 컴퓨터의 invocation과 다른 표이고 changeset도 rewind도 없다.
// 받는 컴퓨터가 꺼져 있어도 부른 쪽에서 읽는다. `unknown`은 보냈는데 답을 잃은 호출이다(그 컴퓨터에서 돌았을 수 있다).
export const appRemoteCallRecordSchema = z
  .strictObject({
    id: idSchema("rcl"),
    caller: requesterSchema.refine(
      (by) => by.kind === "agent" || by.kind === "app",
      { message: "only an agent or an app calls another computer" },
    ),
    machine: machineIdSchema,
    // 부를 때의 컴퓨터 이름이다. 이름은 나중에 바뀌어도 기록은 그대로다.
    computer: z.string().min(1),
    app: appIdSchema,
    command: toolNameSchema,
    status: z.enum(["running", "succeeded", "failed", "denied", "unknown"]),
    started_at: atSchema,
    finished_at: atSchema.nullable(),
    error: z.string().max(512).nullable(),
  })
  .refine(
    (value) => (value.finished_at !== null) === (value.status !== "running"),
    {
      message: "finished_at is set only when not running",
    },
  );
export type AppRemoteCallRecord = z.infer<typeof appRemoteCallRecordSchema>;

const REMOTE_CALLS_MAX_COUNT = 200;

export const appRemoteCalls = defineRead({
  resource: "apps",
  method: "remote_calls",
  name: "app.remote_calls",
  input: z.strictObject({
    // 대상 앱으로 거른다.
    app: appIdSchema.optional(),
    // 부른 앱으로 거른다. 빼면 agent가 부른 것도 든다.
    caller_app: appIdSchema.optional(),
    session: idSchema("ses").optional(),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(REMOTE_CALLS_MAX_COUNT).optional(),
  }),
  output: withReadCommon(
    z.object({ calls: z.array(appRemoteCallRecordSchema) }),
  ),
  reads: [
    {
      name: "app_activity",
      id: (input) => input.app ?? input.caller_app ?? null,
    },
  ],
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});
