import { z } from "zod";
import { defineCommand, defineMemory, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { atSchema } from "../base/values.ts";
import { acpInputSchema } from "./input.ts";
import { acpStateSchema, acpUpdateSchema } from "./state.ts";

// core가 내놓는 ACP의 길이다. snapshot read와 갱신 event(`AcpUpdated`, events/transient.ts)가 짝이다.
// 갱신을 놓치거나 끊기면 snapshot을 다시 읽는다.
export const acpSnapshot = defineRead({
  resource: "acp",
  method: "snapshot",
  name: "AcpSnapshot",
  input: z.strictObject({ session: idSchema("ses") }),
  output: acpStateSchema,
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "not_found"],
});

export const acpUpdatedPayloadSchema = z.strictObject({
  session: idSchema("ses"),
  update: acpUpdateSchema,
});

// 항목이 대화에 들 때 session 안의 순번을 정해 저장한다. core 안 machine 자격만 낸다. 이미 순번이 있는 id는
// 그 순번을 그대로 돌려준다. `data`는 기록에서 다시 만들 수 없는 항목(승인 결과)의 내용이다.
export const acpItemsAllocate = defineCommand({
  resource: "acp",
  method: "allocate",
  name: "AllocateAcpItems",
  input: z.strictObject({
    session: idSchema("ses"),
    items: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          kind: z.enum(["message", "tool", "approval", "notice"]),
          turn: idSchema("trn").nullable(),
          at: atSchema,
          data: z.string().nullable(),
        }),
      )
      .min(1)
      .max(500),
  }),
  output: z.object({
    items: z.array(z.object({ id: z.string(), seq: z.number().int() })),
  }),
  actors: ["machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "not_found"],
});

// 화면이 대화를 조작하는 입구 하나. 입력 꼴마다 지금 있는 route(SendMessage, StopTurn, AnswerAskQuestions,
// DecideTurnRequest, 줄 고치기 넷, session 조작)로 보내고, 권한은 부른 사람의 자격으로 그 route가 본다.
export const acpSend = defineMemory({
  resource: "acp",
  method: "send",
  name: "AcpSend",
  input: acpInputSchema,
  // fork가 새 session을 열면 그 id다.
  output: z.strictObject({ session: idSchema("ses").optional() }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});
