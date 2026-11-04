import { z } from "zod";
import { turnRequestChoiceSchema } from "../approvals/turn-request.ts";
import { askAnswer } from "../lophn-agent/ask-tool.ts";
import { contentBlocksSchema } from "../lophn-agent/content-block.ts";
import { inputDeliverySchema } from "../lophn-agent/inputs.ts";
import { idSchema } from "../base/ids.ts";

// 화면이 ACP로 보내는 것. 대화 조작뿐이다(session 관리 조작인 fork, rewind, model 바꾸기, compact는 아니다).
// 입력마다 session을 싣는다. 받는 곳(core)이 기존 route로 옮긴다.

const session = idSchema("ses");
const message = idSchema("msg");

export const acpInputSchema = z.discriminatedUnion("type", [
  /** 보내기. 앱 context는 `resource` block이다. id와 key는 같은 값으로 다시 보내도 한 번만 접수된다. */
  z.strictObject({
    type: z.literal("send"),
    session,
    id: message,
    key: z.string().min(1),
    content: contentBlocksSchema,
    delivery: inputDeliverySchema,
  }),
  /** 도는 turn을 멈춘다. */
  z.strictObject({
    type: z.literal("stop"),
    session,
    turn: idSchema("trn"),
    key: z.string().min(1),
  }),
  /** 실패한 turn의 입력을 같은 session에 다시 보낸다. */
  z.strictObject({ type: z.literal("retry"), session, turn: idSchema("trn") }),
  /** 질문 묶음에 답한다. 질문 순서대로 하나씩이다. */
  z.strictObject({
    type: z.literal("answer"),
    session,
    tool_call: idSchema("tcl"),
    answers: askAnswer.input.shape.answers,
  }),
  /** 승인 카드를 결정한다. 거절은 이유를 한 줄 적을 수 있다. */
  z.strictObject({
    type: z.literal("decide"),
    session,
    request: idSchema("apr"),
    choice: turnRequestChoiceSchema,
  }),
  // 다음 turn 줄 고치기.
  z.strictObject({ type: z.literal("send_queued"), session, message }),
  z.strictObject({ type: z.literal("remove_queued"), session, message }),
  z.strictObject({
    type: z.literal("edit_queued"),
    session,
    message,
    content: contentBlocksSchema,
  }),
  z.strictObject({
    type: z.literal("move_queued"),
    session,
    message,
    direction: z.enum(["up", "down"]),
  }),
]);
export type AcpInput = z.infer<typeof acpInputSchema>;
