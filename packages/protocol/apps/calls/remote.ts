import { z } from "zod";
import { defineMemory } from "../../base/route.ts";
import { appIdSchema } from "../../projects/values.ts";
import { requesterSchema } from "../../remote/requester.ts";
import { jsonValueSchema, toolNameSchema } from "../channel-values.ts";
import { toolCallOutputSchema } from "./call.ts";

// 받는 기계의 앱 command 입구. 다른 컴퓨터의 core가 넘긴 호출만 온다: handler는 명단의 컴퓨터인 `device:` principal이 아니면 forbidden이고,
// `by`는 받는 기계의 remote call 처리만 call frame에서 옮겨 쓴다(입력의 값이 아니라 그 frame의 요청한 쪽이다).
// `public` command만 받는다. 허락과 요청한 쪽마다의 규칙(`architecture/approval.md`의 표)은 handler가 본다.
export const appRemoteCall = defineMemory({
  resource: "apps",
  method: "remote_call",
  name: "app.remote_call",
  changes: [],
  input: z.strictObject({
    app: appIdSchema,
    command: toolNameSchema,
    input: jsonValueSchema.optional(),
    by: requesterSchema,
  }),
  output: toolCallOutputSchema,
  actors: ["user"],
  errors: [
    "invalid_input",
    "forbidden",
    "unauthorized",
    "not_found",
    "unavailable",
  ],
});
