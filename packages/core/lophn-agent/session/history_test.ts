import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import type { CoreCall } from "../run-loop/core-call.ts";
import { readSessionConversation } from "./history.ts";

const id = (prefix: string, n: number) =>
  `${prefix}_0${String(n).padStart(25, "a")}`;
const SELF = id("ses", 1);
const OTHER = id("ses", 2);

type Row = {
  n: number;
  from: unknown;
  reply_to: string | null;
  reply: string | null;
  text: string;
};

function stub(rows: Row[], request: number): CoreCall {
  const common = { as_of_seq: "100", next_cursor: null };
  return (path, body) => {
    if (path === "/sessions/read") {
      return Promise.resolve(ok({
        session: {
          id: SELF,
          agent: { role: "lophn" },
          place: null,
          title: null,
          lifecycle: "open",
          forked_from: null,
          model_selection: null,
          compaction: null,
          skip: false,
          state_seq: "1",
        },
        ...common,
      }));
    }
    if (path === "/rewind/list") {
      return Promise.resolve(
        ok({ reverts: [], hidden_from_seq: null, ...common }),
      );
    }
    if (path === "/tool-calls/list") {
      return Promise.resolve(ok({ tool_calls: [], ...common }));
    }
    if (path === "/session_messages/list") {
      return Promise.resolve(ok({
        messages: rows.map((row) => ({
          id: id("msg", row.n),
          session: SELF,
          turn: id("trn", row.n === request ? 2 : 1),
          delivery: "next_turn",
          body: "0".repeat(64),
          created_seq: String(row.n),
          created_at: "2026-01-01T00:00:00.000Z",
          from: row.from,
          call: row.reply_to === null && row.from !== "human"
            ? id("cal", row.n)
            : null,
          reply_to: row.reply_to,
          refs: [],
          reply: row.reply,
          event: null,
          fail_reason: null,
          step: null,
        })),
        ...common,
      }));
    }
    if (path === "/messages/body") {
      const message = (body as { message: string }).message;
      const row = rows.find((r) => id("msg", r.n) === message)!;
      return Promise.resolve(ok({
        message,
        session: SELF,
        body: "0".repeat(64),
        size_bytes: 1,
        content: {
          schema_version: 1,
          parts: [{ kind: "text", text: row.text }],
        },
        ...common,
      }));
    }
    throw new Error(`unexpected read ${path}`);
  };
}

test("session이 자기 답으로 남긴 메시지는 history에서 assistant role의 본문 그대로이고, 다른 agent가 보낸 call은 user role의 call tag다", async () => {
  const rows: Row[] = [
    {
      n: 1,
      from: { kind: "human" },
      reply_to: null,
      reply: null,
      text: "hello",
    },
    {
      n: 2,
      from: { kind: "agent", session: SELF },
      reply_to: null,
      reply: null,
      text: "my answer",
    },
    {
      n: 3,
      from: { kind: "agent", session: OTHER },
      reply_to: null,
      reply: "result",
      text: "please do it",
    },
    {
      n: 4,
      from: { kind: "human" },
      reply_to: null,
      reply: null,
      text: "this turn",
    },
  ];
  const read = await readSessionConversation(stub(rows, 4), {
    session: SELF,
    request: id("msg", 4),
  });
  if (!read.ok) throw new Error(read.error.message);
  const [human, own, call] = read.value.messages;
  assert.deepStrictEqual(read.value.messages.length, 3);
  assert.deepStrictEqual([human!.role, human!.text], ["user", "hello"]);
  assert.deepStrictEqual([own!.role, own!.text], ["assistant", "my answer"]);
  assert.deepStrictEqual(call!.role, "user");
  assert.deepStrictEqual(
    call!.text.includes(`<lophn-call from="agent:${OTHER}"`),
    true,
  );
});
