import { assertEquals } from "@std/assert";
import { type SessionConversation, sessionMaterial } from "./summary.ts";

// 숨긴 구간은 이후 model 입력에 들지 않고 접힌 구간은 요약이 맡는다(conversation#R25,
// prompt-assemble#R31; agent-RW3d). 원문은 session에 그대로 있고 이 함수는 입력만 만든다.

type Message = SessionConversation["messages"][number];

// 사람(user)과 agent(assistant)가 번갈아 말한 여섯 메시지다. seq는 1부터다.
const messages: Message[] = [1n, 2n, 3n, 4n, 5n, 6n].map((seq) => ({
  seq,
  role: seq % 2n === 1n ? "user" as const : "assistant" as const,
  text: `m${seq}`,
}));

function texts(conversation: SessionConversation): string[] {
  return sessionMaterial(conversation).history.flatMap((message) =>
    message.parts.flatMap((part) => part.kind === "text" ? [part.text] : [])
  );
}

const base: SessionConversation = { compaction: null, messages };

Deno.test("lophn-agent/harness/prompt-assemble#R31 [agent-RW3d]: with no hidden range every message is in the history", () => {
  assertEquals(texts({ ...base, hidden_from: null }), [
    "m1",
    "m2",
    "m3",
    "m4",
    "m5",
    "m6",
  ]);
  assertEquals(texts(base), texts({ ...base, hidden_from: null }));
});

Deno.test("lophn-agent/harness/prompt-assemble#R31 [agent-RW3d]: the messages from the hidden start on are left out of the model input", () => {
  assertEquals(texts({ ...base, hidden_from: 4n }), ["m1", "m2", "m3"]);
  // 숨김 시작 메시지 자신도 빠진다.
  assertEquals(texts({ ...base, hidden_from: 1n }), []);
});

Deno.test("lophn-agent/harness/prompt-assemble#R31 [agent-RW3d]: the Compact summary and the hidden range work together", () => {
  const material = sessionMaterial({
    compaction: { through_seq: 2n, text: "compact summary" },
    hidden_from: 5n,
    messages,
  });
  assertEquals(material.compact_summary, "compact summary");
  assertEquals(
    material.history.flatMap((message) =>
      message.parts.map((part) => part.kind === "text" ? part.text : "")
    ),
    ["m3", "m4"],
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R31 [agent-RW3d]: a folded range is replaced by its summary in place and its original messages are left out", () => {
  const folded = texts({
    ...base,
    folds: [{ from_seq: 3n, through_seq: 4n, text: "FOLD-SUMMARY" }],
  });
  assertEquals(
    folded.map((text) => text.includes("FOLD-SUMMARY") ? "summary" : text),
    ["m1", "m2", "summary", "m5", "m6"],
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R31 [agent-RW3d]: a fold before the hidden start keeps its summary while the hidden messages stay out", () => {
  const out = texts({
    ...base,
    hidden_from: 6n,
    folds: [{ from_seq: 2n, through_seq: 3n, text: "FOLD-SUMMARY" }],
  });
  assertEquals(
    out.map((text) => text.includes("FOLD-SUMMARY") ? "summary" : text),
    ["m1", "summary", "m4", "m5"],
  );
});
