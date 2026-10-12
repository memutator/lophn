// CLI command registry 테스트다. coding agent에게 context 통로가 없는지 본다.
import { assertEquals } from "@std/assert";
import { cliIndexSchema } from "../../protocol/coding-agent/mod.ts";
import { COMMANDS, findCommand } from "./registry.ts";

Deno.test(
  "coding-agent/cli#R42 [ctx-R7]: the CLI has no context command",
  () => {
    const names = COMMANDS.map((entry) => entry.name);
    assertEquals(names.some((name) => name.startsWith("context")), false);
    assertEquals(names.some((name) => name.includes("glossary")), false);
    for (
      const name of [
        "context list",
        "context show",
        "context items",
        "context glossary",
        "context of",
        "context propose",
      ]
    ) {
      assertEquals(findCommand(name), undefined, name);
    }
    // 목차에도 context 관점을 읽는 op가 없다.
    const parsed = cliIndexSchema.safeParse({
      command: "index",
      op: "context",
      context: "ctx_01arz3ndektsv4rrffq69g5fav",
    });
    assertEquals(parsed.success, false);
  },
);
