import { z } from "zod";
import { defineMemory } from "../../base/route.ts";
import { appIdSchema } from "../../projects/values.ts";
import { jsonValueSchema, toolNameSchema } from "../channel-values.ts";
import { toolCallOutputSchema } from "./call.ts";

// 받는 기계의 앱 command 입구. 다른 컴퓨터의 core가 넘긴 호출만 온다: handler는 명단의 컴퓨터인 `device:` principal이 아니면 forbidden이다.
// 요청한 쪽은 입력에 없다. call frame의 `by`가 유일한 길이고 받는 기계의 remote call 처리만 그것을 handler에 넘긴다(입력 body에 `by`를 실어도
// strict라 `invalid_input`이다). 명단의 컴퓨터가 `by` 없이 부르면 handler는 `invalid_input`으로 거절한다(폰은 컴퓨터가 아니라 forbidden이다).
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
