import { assertEquals } from "@std/assert";

import { sendMessage } from "../../../protocol/lophn-agent/inputs.ts";
import { attachedOf } from "./attached-chips.ts";

const context = "ctx_01h455vb4pex5v6nkc6gd5f001";

// 모양이 틀리면 core가 SendMessage를 invalid_input으로 거절해 첫 말이 나가지 않는다.
Deno.test("context chip과 위반 chip은 SendMessage가 받는 attached로 바뀐다", () => {
  const attached = attachedOf([
    { id: "check", context, label: "eval" },
    {
      id: "key",
      context,
      label: "eval",
      violation: { file: "eval/exp-012.md", rule: "about is required" },
    },
  ]);
  assertEquals(attached.map((chip) => chip.kind), ["context", "violation"]);
  const parsed = sendMessage.input.safeParse({
    id: "msg_01h455vb4pex5v6nkc6gd5f002",
    session: "ses_01h455vb4pex5v6nkc6gd5f003",
    content: { schema_version: 1, parts: [{ kind: "text", text: "hi" }] },
    delivery: "next_turn",
    attached,
    refs: [],
  });
  assertEquals(parsed.success, true);
});
