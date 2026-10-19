import { assertEquals } from "@std/assert";
import type { Place } from "../../../protocol/lophn-agent/places.ts";
import type { ToolContext } from "../../lophn-agent/tools/spi.ts";
import { KIND_TOOLS } from "./kind.ts";

// project place가 아닌 곳에서는 core를 부르지 않고 거절한다. 다른 project를 읽을 길이 없어야 한다.
Deno.test("kind tools refuse outside a project place without calling core", async () => {
  const places: [string, Place | null][] = [
    ["lophn", null],
    ["app", { kind: "app", id: "app_a", project: null } as unknown as Place],
  ];
  for (const [role, place] of places) {
    const ctx = {
      role,
      place,
      core: () => {
        throw new Error("core must not be called");
      },
    } as unknown as ToolContext;
    for (const tool of KIND_TOOLS) {
      const input = tool.name === "kind.list" ? { kind: "receipt" } : {};
      const result = await tool.handler!(input, ctx);
      assertEquals(result.ok ? null : result.error.code, "invalid_input");
    }
  }
});
