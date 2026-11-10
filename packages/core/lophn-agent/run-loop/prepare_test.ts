import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assembleTurnPrompt,
  type PromptRequest,
} from "../prompt-assembly/mod.ts";
import { createFixedMemory } from "./prepare.ts";

// session 중에 쓴 memory가 다음 turn의 system에 섞이면 prefix cache가 매 turn 깨진다.
test("session 중 memory를 써도 다음 turn의 system prompt bytes가 같고 Compact 뒤에는 새로 읽는다", async () => {
  let disk = { workspace: "decision A", agent: "" };
  const fixed = createFixedMemory();
  const read = () => Promise.resolve({ ...disk });
  const systemOf = async (compaction: string | null) => {
    const memory = await fixed.get("ses_1", compaction, read);
    const result = await assembleTurnPrompt(
      {
        workspace_kind_prompt: "You are in a project workspace.",
        tools: [],
        instructions: {
          global: "",
          home: "",
          project: "",
          app: "",
          agent: "",
          files: {},
        },
        memory,
        skills: [],
        workspace: { text: "# Workspace", agents: [] },
        history: [{ role: "user", parts: [{ kind: "text", text: "hi" }] }],
        limits: {
          context_limit: 100000,
          input_limit: 100000,
          output_limit: 4000,
        },
        reserved_output: 1000,
      },
      {
        pack: (request: PromptRequest) => ({ body: request, opaque_bytes: 0 }),
      },
    );
    assert.ok(result.status === "ready");
    return JSON.stringify(result.request.system);
  };

  const first = await systemOf(null);
  assert.ok(first.includes("decision A"));
  disk = { workspace: "decision A\nand B", agent: "mine" };
  assert.deepStrictEqual(await systemOf(null), first);

  const compacted = await systemOf("12");
  assert.ok(compacted.includes("and B"));
  assert.ok(compacted.includes("mine"));
});
