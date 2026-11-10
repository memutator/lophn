import assert from "node:assert/strict";
import { test } from "node:test";
import { err, ok } from "../../../base/mod.ts";
import type { HistoryMessage } from "../prompt-assembly/mod.ts";
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
  // 지정하면 이 turn이 가져간 메시지다. 없으면 요청은 turn 2, 나머지는 turn 1이다.
  turn?: number;
  // 사람이 `!`로 돌린 명령의 기록이다. 본문이 shell part다.
  shell?: boolean;
};

function stub(
  rows: Row[],
  request: number,
  // turn 번호 → 그 turn을 연 메시지 번호와 남긴 turn 안 이력.
  histories: Record<number, { input: number; messages: HistoryMessage[] }> = {},
): CoreCall {
  const common = { as_of_seq: "100", next_cursor: null };
  return (path, body) => {
    if (path === "/turns/list") {
      return Promise.resolve(
        ok({
          turns: Object.entries(histories).map(([n, history]) => ({
            id: id("trn", Number(n)),
            session: SELF,
            input_message: id("msg", history.input),
            state: "finished",
            basis: "a".repeat(64),
            started_at: "2026-01-01T00:00:00.000Z",
            limits: { model_attempts: null, stall_ms: 300_000 },
            mode: "attended",
            elapsed: { active_ms: 0, stall_ms: 0, checkpoint_at: null },
            finished_at: "2026-01-01T00:00:01.000Z",
            outcome: { kind: "completed", reason: "answer_completed" },
            result: "b".repeat(64),
            state_seq: "1",
          })),
          ...common,
        }),
      );
    }
    if (path === "/turns/body") {
      const turn = (body as { id: string }).id;
      const found = Object.entries(histories).find(
        ([n]) => id("trn", Number(n)) === turn,
      );
      if (found === undefined) {
        return Promise.resolve(err({ code: "not_found", message: "none" }));
      }
      return Promise.resolve(
        ok({
          kind: "turn_history",
          id: turn,
          turn,
          hash: "c".repeat(64),
          size_bytes: 1,
          value: found[1].messages,
          ...common,
        }),
      );
    }
    if (path === "/sessions/read") {
      return Promise.resolve(
        ok({
          session: {
            id: SELF,
            agent: "lophn_home",
            workspace: null,
            title: null,
            lifecycle: "open",
            forked_from: null,
            model_selection: null,
            compaction: null,
            skip: false,
            called_from: null,
            spawned_by: null,
            opened_by_app: null,
            harness: null,
            state_seq: "1",
          },
          ...common,
        }),
      );
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
      return Promise.resolve(
        ok({
          messages: rows.map((row) => ({
            id: id("msg", row.n),
            session: SELF,
            turn: id("trn", row.turn ?? (row.n === request ? 2 : 1)),
            delivery: "next_turn",
            shell: row.shell === true,
            body: "0".repeat(64),
            created_seq: String(row.n),
            created_at: "2026-01-01T00:00:00.000Z",
            from: row.from,
            call:
              row.reply_to === null && row.from !== "human"
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
        }),
      );
    }
    if (path === "/messages/body") {
      const message = (body as { message: string }).message;
      const row = rows.find((r) => id("msg", r.n) === message)!;
      return Promise.resolve(
        ok({
          message,
          session: SELF,
          body: "0".repeat(64),
          size_bytes: 1,
          content: {
            schema_version: 1,
            parts:
              row.shell === true
                ? [
                    {
                      kind: "shell",
                      command: "echo hi",
                      exit_code: 0,
                      timed_out: false,
                      stdout: row.text,
                      stderr: "",
                      truncated: false,
                    },
                  ]
                : [{ kind: "text", text: row.text }],
          },
          ...common,
        }),
      );
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

// turn 밖에서 돈 `!` 명령을 model이 못 보거나 두 번 보면 다음 turn이 틀린 사실 위에서 돈다.
test("turn 밖에서 돈 shell 메시지는 가져간 turn의 prompt에 요청보다 앞에 한 번 들고 그다음 turn의 이력에도 한 번만 든다", async () => {
  const human = (n: number, text: string, turn?: number): Row => ({
    n,
    from: { kind: "human" },
    reply_to: null,
    reply: null,
    text,
    ...(turn === undefined ? {} : { turn }),
  });
  const shell: Row = { ...human(2, "hi-output", 2), shell: true };
  const taken = await readSessionConversation(
    stub([human(1, "hello", 1), shell, human(3, "now", 2)], 3),
    { session: SELF, request: id("msg", 3) },
  );
  if (!taken.ok) throw new Error(taken.error.message);
  assert.deepStrictEqual(taken.value.messages.length, 2);
  assert.deepStrictEqual(taken.value.messages[0]!.text, "hello");
  assert.match(
    taken.value.messages[1]!.text,
    /^<lophn-shell command="echo hi" exit_code="0">\n\$ echo hi\nhi-output\n<\/lophn-shell>$/,
  );

  const later = await readSessionConversation(
    stub(
      [human(1, "hello", 1), shell, human(3, "now", 2), human(4, "next", 3)],
      4,
    ),
    { session: SELF, request: id("msg", 4) },
  );
  if (!later.ok) throw new Error(later.error.message);
  const texts = later.value.messages.map((message) => message.text);
  assert.deepStrictEqual(texts.length, 3);
  assert.deepStrictEqual(
    texts.filter((text) => text.includes("<lophn-shell")).length,
    1,
  );
});

// 앞 turn의 tool 이력이 빠지면 다음 turn이 앞 turn의 prompt cache를 못 읽고, model은 읽은 것을 잊어 다시 부른다.
test("앞 turn이 남긴 turn 안 이력은 그 turn의 요청 뒤에 그대로 들고, 이력이 맡은 그 turn의 답 메시지는 따로 들지 않는다", async () => {
  const rows: Row[] = [
    {
      n: 1,
      from: { kind: "human" },
      reply_to: null,
      reply: null,
      text: "read it",
    },
    {
      n: 2,
      from: { kind: "agent", session: SELF },
      reply_to: null,
      reply: null,
      text: "reading",
    },
    {
      n: 3,
      from: { kind: "agent", session: SELF },
      reply_to: null,
      reply: null,
      text: "it says hi",
    },
    {
      n: 4,
      from: { kind: "human" },
      reply_to: null,
      reply: null,
      text: "next",
    },
  ];
  const history: HistoryMessage[] = [
    {
      role: "assistant",
      parts: [
        { kind: "text", text: "reading" },
        { kind: "tool_use", id: "k1", name: "file.read", input: { path: "a" } },
      ],
    },
    {
      role: "user",
      parts: [{ kind: "tool_result", id: "k1", text: '{"content":"hi"}' }],
    },
    { role: "assistant", parts: [{ kind: "text", text: "it says hi" }] },
  ];
  const read = await readSessionConversation(
    stub(rows, 4, { 1: { input: 1, messages: history } }),
    { session: SELF, request: id("msg", 4) },
  );
  if (!read.ok) throw new Error(read.error.message);
  const [request, ...rest] = read.value.messages;
  assert.deepStrictEqual([request!.role, request!.text], ["user", "read it"]);
  assert.deepStrictEqual(
    rest.map((message) => [message.role, message.parts, message.tool]),
    history.map((message) => [message.role, message.parts, true]),
  );
  // 이력은 그 turn의 마지막 메시지 자리에 놓여 Compact·숨김이 turn 끝과 같이 덮는다.
  assert.deepStrictEqual(
    rest.map((message) => message.seq),
    [3n, 3n, 3n],
  );
});
