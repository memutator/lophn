import { z } from "zod";
import { atSchema } from "../base/values.ts";
import { defineMemory } from "../base/route.ts";
import { sessionRefSchema } from "../lophn-agent/session-lifecycle.ts";

// 주의(attention): host(desktop, 폰)가 지금 무엇을 보고 있는지 알리고, core가 못 본 turn 끝(`unseen`)을 든다.
// 보고한 쪽은 입력이 아니라 자격(`who.principal`)이 정한다: 폰은 `device:<id>`, shell main은 사람 자격이다.
const errors = ["invalid_input"] as const;

// 폰에는 `idle_ms`가 없다(앞에 보이면 focused다). desktop만 OS의 idle 시간을 싣는다.
export const presenceReport = defineMemory({
  resource: "presence",
  method: "report",
  name: "presence.report",
  changes: [],
  input: z.strictObject({
    focused: z.boolean(),
    idle_ms: z.number().int().min(0).optional(),
    looking: z.array(sessionRefSchema).max(32),
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors,
});

const unseenItemSchema = z.strictObject({
  session: sessionRefSchema,
  kind: z.enum(["finished", "failed"]),
  at: atSchema,
});

// `StateChanged{unseen, id: session}`은 서고 꺼질 때 core가 route 밖에서 낸다.
export const unseenList = defineMemory({
  resource: "unseen",
  method: "list",
  name: "unseen.list",
  reads: ["unseen"],
  input: z.strictObject({}),
  output: z.strictObject({ items: z.array(unseenItemSchema) }),
  actors: ["user"],
  errors,
});

// 보는 것과 같은 효과다. 상태가 바뀌면 core가 `StateChanged{unseen}`을 낸다.
export const unseenDismiss = defineMemory({
  resource: "unseen",
  method: "dismiss",
  name: "unseen.dismiss",
  changes: [],
  input: z.strictObject({ session: sessionRefSchema }),
  output: z.strictObject({ dismissed: z.boolean() }),
  actors: ["user"],
  errors,
});

// shell main이 터미널 coding agent의 계기(대기, 끝, 실패)를 core에 알린다. `terminal_sessions/report`는 목록이고 이 route가
// 순간이다: shell의 debounce 뒤에 한 번씩 보낸다. 사람 자격(shell main)만 부른다.
export const terminalSessionsSignal = defineMemory({
  resource: "terminal_sessions",
  method: "signal",
  name: "terminal_sessions.signal",
  changes: [],
  input: z.strictObject({
    terminal_ref: z.string().min(1),
    harness: z.string().min(1),
    title: z.string().nullable(),
    kind: z.enum(["waiting", "finished", "failed"]),
    active_ms: z.number().int().min(0).nullable(),
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors: ["invalid_input", "forbidden"],
});

export const ATTENTION_ROUTES = [
  presenceReport,
  unseenList,
  unseenDismiss,
  terminalSessionsSignal,
] as const;
