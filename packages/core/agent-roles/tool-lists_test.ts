import { assert, assertEquals } from "@std/assert";
import {
  ROLES,
  toWireToolName,
  WIRE_TOOL_NAME_PATTERN,
} from "../../protocol/lophn-agent/mod.ts";
import { builtinToolNames } from "./tool-lists.ts";

// 이름이 겹치면 tool 실행이 다른 tool로 간다.
Deno.test("builtin tool wire names fit the provider rule and never collide", () => {
  for (const role of ROLES) {
    const names = builtinToolNames(role);
    const wire = names.map(toWireToolName);
    for (const name of wire) assert(WIRE_TOOL_NAME_PATTERN.test(name), name);
    assertEquals(new Set(wire).size, wire.length, `${role} has a collision`);
    assertEquals(new Set(names).size, names.length, `${role} lists twice`);
  }
});

// 모든 앱의 tool 목록과 앱 상태·log·invocation 읽기는 사람이 lophn과 App Engineer로만 좁혔다.
Deno.test("app.tools and the app status, log and invocation reads are only in the lophn and App Engineer lists", () => {
  for (const role of ROLES) {
    for (
      const name of ["app.tools", "app.status", "app.logs", "app.invocations"]
    ) {
      assertEquals(
        builtinToolNames(role).includes(name),
        role === "lophn" || role === "app_engineer",
        `${role} ${name}`,
      );
    }
  }
});
