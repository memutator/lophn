import { assertEquals } from "@std/assert";

import { sendMessage } from "../../../protocol/lophn-agent/inputs.ts";
import {
  attachedOf,
  attachedOfParts,
  attachedPartsOf,
} from "./attached-chips.ts";

const context = "ctx_01h455vb4pex5v6nkc6gd5f001";

// 모양이 틀리면 core가 SendMessage를 invalid_input으로 거절해 첫 말이 나가지 않는다. 본문 part에서 chip을
// 되살리지 못하면 다시 보내기가 위반(파일·규칙)을 잃는다.
Deno.test("chip을 본문 part로 쓰고 다시 읽으면 같은 attached가 되어 SendMessage가 받는다", () => {
  const chips = [
    { id: "check", context, label: "eval" },
    {
      id: "key",
      context,
      label: "eval",
      violation: { file: "eval/exp-012.md", rule: "about is required" },
    },
  ];
  const attached = attachedOf(chips);
  assertEquals(attached.map((chip) => chip.kind), ["context", "violation"]);
  const parts = attachedPartsOf(chips);
  assertEquals(attachedOfParts(parts), attached);
  const parsed = sendMessage.input.safeParse({
    id: "msg_01h455vb4pex5v6nkc6gd5f002",
    session: "ses_01h455vb4pex5v6nkc6gd5f003",
    content: {
      schema_version: 1,
      parts: [...parts, { kind: "text", text: "hi" }],
    },
    delivery: "next_turn",
    attached,
    refs: [],
  });
  assertEquals(parsed.success, true);
});
