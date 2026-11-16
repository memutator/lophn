import { z } from "zod";
import { turnRequestChoiceSchema } from "../approvals/turn-request.ts";
import { askAnswer } from "../lophn-agent/ask-tool.ts";
import { contentBlocksSchema } from "../lophn-agent/content-block.ts";
import { inputDeliverySchema } from "../lophn-agent/inputs.ts";
import { idSchema } from "../base/ids.ts";

// 화면이 ACP로 보내는 것. 대화 조작과 session 조작(model, mode, 명령, rewind, fork, compact, 이름)이다.
// 입력마다 session을 싣는다. 받는 곳(core)이 기존 route로 옮기고, source가 가진 기능은 `session.capabilities`가 알린다.

const session = idSchema("ses");
const message = idSchema("msg");

// ACP 쪽 승인 결정. core는 `session`을 받지 않는다(`turnRequestChoiceSchema`가 그대로다).
// 그 CLI session 안에서만 허락하는 범위가 `session`이다.
export const acpDecideChoiceSchema = z.discriminatedUnion("kind", [
  ...turnRequestChoiceSchema.options,
  z.strictObject({ kind: z.literal("session") }),
  // plan 승인. 그 subject의 `modes` id 하나. plan subject에만 쓰고 다른 subject면 받는 쪽이 `invalid_input`이다.
  z.strictObject({ kind: z.literal("mode"), mode: z.string().min(1) }),
]);
export type AcpDecideChoice = z.infer<typeof acpDecideChoiceSchema>;

export const acpInputSchema = z.discriminatedUnion("type", [
  /** 보내기. 앱 context는 `resource` block이다. id와 key는 같은 값으로 다시 보내도 한 번만 접수된다. */
  z.strictObject({
    type: z.literal("send"),
    session,
    id: message,
    key: z.string().min(1),
    content: contentBlocksSchema,
    delivery: inputDeliverySchema,
    /** 앱 화면이 보낸 것이면 그 앱(shell main이 보낸 view에서 정해 덮는다. 이름표일 뿐이다). */
    via_app: idSchema("app").optional(),
    /** 이 화면이 아는 마지막 사람 메시지(null은 하나도 못 봄). 그 뒤에 다른 기기의 사람 메시지가 있으면 거절된다. 없으면 검사하지 않는다. */
    seen: message.nullable().optional(),
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
    choice: acpDecideChoiceSchema,
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
  // session 조작. `key`는 `stop`과 같이 같은 값으로 다시 보내도 한 번만 접수된다.
  z.strictObject({
    type: z.literal("set_model"),
    session,
    key: z.string().min(1),
    model: z.string().min(1),
    /** 축 id → 값. */
    options: z.record(z.string(), z.string()),
  }),
  z.strictObject({
    type: z.literal("set_mode"),
    session,
    key: z.string().min(1),
    mode: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal("run_command"),
    session,
    key: z.string().min(1),
    name: z.string().min(1),
    argument: z.string(),
  }),
  /** `files`·`apps`는 lophn `RewindChoice`와 같은 칸이다. */
  z.strictObject({
    type: z.literal("rewind"),
    session,
    key: z.string().min(1),
    message,
    files: z.boolean(),
    apps: z.array(idSchema("app")),
  }),
  /** `message`가 null이면 마지막 확정 메시지까지다. */
  z.strictObject({
    type: z.literal("fork"),
    session,
    key: z.string().min(1),
    message: message.nullable(),
  }),
  z.strictObject({
    type: z.literal("compact"),
    session,
    key: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal("rename"),
    session,
    key: z.string().min(1),
    title: z.string().min(1),
  }),
  // subagent, background task, 켜고 끄기, goal, role. source가 가졌는지는 capability가 알린다.
  z.strictObject({
    type: z.literal("stop_child"),
    session,
    key: z.string().min(1),
    child: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal("steer_child"),
    session,
    key: z.string().min(1),
    child: z.string().min(1),
    text: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal("stop_task"),
    session,
    key: z.string().min(1),
    task: z.string().min(1),
  }),
  /** 지금 도는 root tool(Bash·Agent 등)을 background로 보낸다. tool id를 싣지 않는다(adapter가 고른다). */
  z.strictObject({
    type: z.literal("background_tool"),
    session,
    key: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal("set_toggle"),
    session,
    key: z.string().min(1),
    id: z.string().min(1),
    on: z.boolean(),
  }),
  /** `objective`가 null이면 goal을 지운다. `paused`는 멈추기·다시 하기. */
  z.strictObject({
    type: z.literal("set_goal"),
    session,
    key: z.string().min(1),
    objective: z.string().min(1).nullable(),
    paused: z.boolean(),
  }),
  /** 사람이 친 `!` 뒤의 글(앞 `!`는 뺀다)을 명령으로 돌린다. */
  z.strictObject({
    type: z.literal("run_shell"),
    session,
    key: z.string().min(1),
    command: z.string().min(1),
  }),
  /** `run_shell`이 만든 사람 쪽 tool item(`item`) 하나만 멈춘다. 그 줄은 `cancelled`로 끝난다. 도는 turn은 건드리지 않는다. */
  z.strictObject({
    type: z.literal("stop_shell"),
    session,
    item: z.string().min(1),
  }),
  /** 그 CLI의 다른 session으로 같은 탭에서 바꾼다. */
  z.strictObject({
    type: z.literal("open_session"),
    session,
    key: z.string().min(1),
    cli_session: z.string().min(1),
  }),
  /** 이 session만 그 role의 model로 바꾼다(omp `/switch @role`). */
  z.strictObject({
    type: z.literal("use_role"),
    session,
    key: z.string().min(1),
    role: z.string().min(1),
  }),
]);
export type AcpInput = z.infer<typeof acpInputSchema>;
