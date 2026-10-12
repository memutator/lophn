import { assert, assertEquals } from "@std/assert";
import {
  messageBody,
  rewindList,
  sessionSummary,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { routePath } from "../../packages/protocol/platform/mod.ts";
import { sessionMaterial } from "../../packages/lophn-agent/harness/prompt-assemble/mod.ts";
import { readSessionConversation } from "./session-history.ts";
import { err } from "../../packages/base/mod.ts";
import {
  MSG,
  MSGS,
  openWorld,
  SES,
  type WorldOptions,
} from "./testing/world.ts";

// 숨긴 구간과 접힌 구간은 이후 call의 입력에 들지 않는다(prompt-assemble#R31, revert R15·R16; agent-RW3d).
// 숨긴 구간의 원문은 읽지도 않고 접힌 구간은 요약이 그 자리를 맡는다.

const TALK = [
  { id: MSGS(0), seq: "10", actor: "user", text: "first ask" },
  { id: MSGS(1), seq: "11", actor: "agent", text: "first answer" },
  { id: MSGS(2), seq: "12", actor: "user", text: "second ask" },
  { id: MSGS(3), seq: "13", actor: "agent", text: "second answer" },
  { id: MSGS(4), seq: "20", actor: "user", text: "after the rewind" },
  { id: MSG, seq: "30", actor: "user", text: "CURRENT", run: null },
] as const;

const RVT_HIDE = "rvt_01arz3ndektsv4rrffq69g5fa1";
const RVT_FOLD = "rvt_01arz3ndektsv4rrffq69g5fa2";

async function history(options: WorldOptions) {
  const world = openWorld({ sessionMessages: [...TALK], ...options });
  const read = await readSessionConversation(world.calls.machine, {
    session: SES,
    request: MSG,
  });
  assert(read.ok, read.ok ? "" : JSON.stringify(read.error));
  return { world, conversation: read.value };
}

const bodiesRead = (world: ReturnType<typeof openWorld>) =>
  world.bodiesOf(routePath(messageBody)).map((body) =>
    (body as { message: string }).message
  );

const textsOf = (
  conversation: Awaited<ReturnType<typeof history>>["conversation"],
) =>
  sessionMaterial(conversation).history.flatMap((message) =>
    message.parts.flatMap((part) => part.kind === "text" ? [part.text] : [])
  );

Deno.test("lophn-agent/harness/prompt-assemble#R31 [agent-RW3d]: a hidden range is not read and not in the history, while the messages after the rewind are", async () => {
  const { world, conversation } = await history({
    reverts: [{
      id: RVT_HIDE,
      choice: "messages_only",
      checkpoint: MSGS(2),
      boundary_seq: "12",
      result_seq: "15",
    }],
  });
  assertEquals(textsOf(conversation), [
    "first ask",
    "first answer",
    "after the rewind",
  ]);
  const read = bodiesRead(world);
  assert(!read.includes(MSGS(2)) && !read.includes(MSGS(3)));
  assert(read.includes(MSGS(4)));
});

Deno.test("lophn-agent/harness/prompt-assemble#R31 [agent-RW3d]: a redone rewind hides nothing, a blocked one never did", async () => {
  for (
    const over of [{ redo: "done" }, {
      outcome: "blocked",
      redo: "none",
    }] as const
  ) {
    const { conversation } = await history({
      reverts: [{
        id: RVT_HIDE,
        choice: "restore_all",
        checkpoint: MSGS(2),
        boundary_seq: "12",
        result_seq: "15",
        ...over,
      }],
    });
    assertEquals(textsOf(conversation).length, 5, JSON.stringify(over));
  }
});

Deno.test("lophn-agent/harness/prompt-assemble#R31 [agent-RW3d]: a folded range is read as its summary and its messages are not read", async () => {
  const { world, conversation } = await history({
    reverts: [{
      id: RVT_FOLD,
      choice: "summarize",
      checkpoint: MSGS(2),
      boundary_seq: "12",
      result_seq: "15",
      summary_call: "mcl_01arz3ndektsv4rrffq69g5fa3",
    }],
    foldTexts: { [RVT_FOLD]: "FOLD-SUMMARY" },
  });
  const texts = textsOf(conversation);
  assertEquals(texts.length, 4);
  assertEquals(texts[0], "first ask");
  assertEquals(texts[1], "first answer");
  assert(texts[2]!.includes("FOLD-SUMMARY"));
  assertEquals(texts[3], "after the rewind");
  const read = bodiesRead(world);
  assert(!read.includes(MSGS(2)) && !read.includes(MSGS(3)));
  assertEquals(
    world.bodiesOf(routePath(sessionSummary)),
    [{ session: SES, revert: RVT_FOLD }],
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R31 [agent-RW3d]: a session that was never rewound reads the rewind list once and puts nothing extra in the history", async () => {
  const { world, conversation } = await history({});
  assertEquals(world.bodiesOf(routePath(rewindList)).length, 1);
  assertEquals("hidden" in conversation, false);
  assertEquals("folds" in conversation, false);
  assertEquals(textsOf(conversation).length, 5);
});

Deno.test("lophn-agent/harness/prompt-assemble#R31 [agent-RW3d]: when the rewind records cannot be read, the history is not read at all", async () => {
  const world = openWorld({ sessionMessages: [...TALK] });
  const machine: typeof world.calls.machine = (path, body) =>
    path === routePath(rewindList)
      ? Promise.resolve(err({ code: "unavailable", message: "down" }))
      : world.calls.machine(path, body);
  const read = await readSessionConversation(machine, {
    session: SES,
    request: MSG,
  });
  assertEquals(read.ok, false);
  assertEquals(bodiesRead(world), []);
});
