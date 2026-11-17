import { z } from "zod";
import {
  defineCommand,
  defineFile,
  defineMemory,
  defineRead,
  defineUpload,
} from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { atSchema } from "../base/values.ts";
import {
  MESSAGE_IMAGE_MAX_BYTES,
  messageImageTypeSchema,
} from "../lophn-agent/message-images.ts";
import { agentIdSchema, workspaceSchema } from "../lophn-agent/workspaces.ts";
import { acpInputSchema } from "./input.ts";
import { acpSessionMetaSchema } from "./session.ts";
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

// 첫 메시지 전 새 session 화면용이다. 그 agent와 workspace로 지금 session을 열면 받을 session meta(model 묶음과 기본 model,
// mode, 명령, capability)를 session 없이 읽는다. title·usage·cli_session은 null이다. harness는 session이 늘 있어 쓰지 않는다.
export const acpDraft = defineRead({
  resource: "acp",
  method: "draft",
  name: "AcpDraft",
  input: z.strictObject({
    agent: agentIdSchema,
    workspace: workspaceSchema.nullable(),
  }),
  output: acpSessionMetaSchema,
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
  changes: [],
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
  changes: [],
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

// 아래 셋은 터미널 coding agent session(harness GUI handle)만의 길이다. 상태의 주인인 컴퓨터의 앱(host)에 물어 답하고, 앱이
// 붙어 있지 않거나 답하지 않으면 unavailable, 그 session의 GUI가 컴퓨터에 없으면 not_found다. lophn session에는 not_found다.
const codingErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

// tool 본문 한 쪽. coding session의 snapshot과 갱신은 본문을 싣지 않아(`withoutToolBodies`) 화면이 줄을 펼칠 때 이것으로 읽는다.
// 그 tool이나 그 쪽 본문이 없으면 not_found다. lophn session의 본문은 `turnBodyView`로 읽는다.
export const acpToolBodyRead = defineRead({
  resource: "acp",
  method: "tool_body",
  name: "ReadAcpToolBody",
  input: z.strictObject({
    session: idSchema("ses"),
    tool_call: z.string().min(1).max(200),
    part: z.enum(["input", "output"]),
  }),
  output: z.strictObject({ value: z.string(), truncated: z.boolean() }),
  actors: ["user"],
  errors: [...codingErrors],
});

// 사람이 붙인 이미지를 그 coding session 탭의 임시 폴더에 쓰고 그 file의 절대 경로를 받는다. 메시지에는 그 경로의 `file://`
// resource_link를 싣는다(desktop GUI의 붙이기와 같은 자리와 이름 규칙). bytes가 선언한 형식의 그림이 아니면 invalid_input이다.
export const acpImageUpload = defineUpload({
  resource: "acp",
  method: "image_upload",
  name: "UploadAcpImage",
  changes: [],
  input: z.strictObject({
    session: idSchema("ses"),
    content_type: messageImageTypeSchema,
    bytes: z.number().int().min(1).max(MESSAGE_IMAGE_MAX_BYTES),
  }),
  output: z.strictObject({ path: z.string().min(1) }),
  actors: ["user"],
  errors: [...codingErrors],
  max_bytes: MESSAGE_IMAGE_MAX_BYTES,
});

// 그 coding session 탭의 임시 폴더 바로 아래에 쓴 그림을 읽는다(대화의 `file://` link). 그 폴더 밖이거나 그림이 아니면 not_found다.
export const acpImageRead = defineFile({
  resource: "acp",
  method: "image_read",
  name: "ReadAcpImage",
  input: z.strictObject({
    session: idSchema("ses"),
    path: z.string().min(1).max(4096),
  }),
  contentType: "application/octet-stream",
  actors: ["user"],
  errors: [...codingErrors],
});
