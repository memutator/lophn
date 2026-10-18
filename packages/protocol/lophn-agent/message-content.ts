import { z } from "zod";
import { canonicalize } from "../../base/mod.ts";
import { idSchema } from "../base/ids.ts";
import { ATTACHED_KINDS } from "./input-tags.ts";

// 본문 blob 하나의 정규 직렬화 상한이다. 요청은 본문 값을 싣고 RPC JSON 상한이 256KiB
// 이므로 id·links 여유가 요청 상한 안에 남도록, 사람 말과 machine 확인은
// 글뿐이라 64KiB(스키마가 검사), agent 답은 글과 카드를 합쳐 240KiB다. agent 답의
// 합계는 core가 준비 전에 검사한다.
export const MESSAGE_TEXT_CONTENT_MAX_BYTES = 65536;
export const MESSAGE_CONTENT_MAX_BYTES = 245760;
// 본문 blob 준비·참조의 이름. 준비 주체는 보낸 사람의 자격이고 참조는 permanent다.
export const MESSAGE_CONTENT_PURPOSE = "message_content";
export const MESSAGE_BODY_OWNER_KIND = "message";
export const MESSAGE_BODY_FIELD = "body";
const encoder = new TextEncoder();

// 사람이 composer chip으로 붙인 것. 이름과 한 줄만 싣고 상세는 tool로 읽는다.
// 위반은 path와 rule, 파일은 path를 더한다. context와 위반은 가리키는 context id도 싣는다: 실패한 turn을
// 다시 보낼 때 이 part로 chip을 되살린다.
const attachedFields = {
  kind: z.literal("attached"),
  attached: z.enum(ATTACHED_KINDS),
  name: z.string().min(1),
  line: z.string().optional(),
  path: z.string().min(1).optional(),
  rule: z.string().min(1).optional(),
  context: idSchema("ctx").optional(),
};
const attachedPartInputSchema = z.strictObject(attachedFields);
const attachedPartSchema = z.object(attachedFields);

// `visual.show`가 대화에 보이는 앱 카드. view는 앱 blueprint 화면 key다.
const appCardFields = {
  kind: z.literal("app_card"),
  app: idSchema("app"),
  view: z.string().min(1),
};
const appCardPartInputSchema = z.strictObject(appCardFields);
const appCardPartSchema = z.object(appCardFields);

const messagePartInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), text: z.string() }),
  attachedPartInputSchema,
  appCardPartInputSchema,
]);
const messagePartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  attachedPartSchema,
  appCardPartSchema,
]);

function canonicalBytes(block: unknown): number | undefined {
  try {
    return encoder.encode(canonicalize(block)).length;
  } catch {
    return undefined;
  }
}

// blob에 들어가는 바이트다. 키를 정렬한 정규 JSON(RFC 8785)이라 같은 값은 같은 바이트다.
export function serializeMessageContent(content: unknown): Uint8Array {
  return encoder.encode(canonicalize(content));
}

function withinBytes(content: unknown, max: number): boolean {
  const size = canonicalBytes(content);
  return size !== undefined && size <= max;
}

const messageContentInputSchema = z.strictObject({
  schema_version: z.literal(1),
  parts: z.array(messagePartInputSchema).min(1),
});
export const messageContentSchema = z.object({
  schema_version: z.literal(1),
  parts: z.array(messagePartSchema).min(1),
});

const textPartInput = z.strictObject({
  kind: z.literal("text"),
  text: z.string(),
});

// 사람 메시지는 글과 composer chip(attached)을 받는다.
export const userMessageContentInputSchema = z.strictObject({
  schema_version: z.literal(1),
  parts: z.array(z.discriminatedUnion("kind", [
    textPartInput,
    attachedPartInputSchema,
  ])).min(1),
}).refine((value) => withinBytes(value, MESSAGE_TEXT_CONTENT_MAX_BYTES), {
  message: "message content is too large",
});
// agent 답은 글, 시각 블록, 앱 카드를 받는다.
export const agentMessageContentInputSchema = messageContentInputSchema;

// 요청은 본문 값(MessageContent)을 싣는다. renderer·shell·runtime은 blob을 준비하지
// 않는다: core가 redaction을 거친 값을 blob으로 준비하고 command가 같은 transaction에서
// 영구 참조를 등록한다. ledger에는 그 blob의 hash만 남는다.
