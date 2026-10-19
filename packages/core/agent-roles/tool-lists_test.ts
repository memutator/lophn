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

// 모든 앱의 app-api 목록은 사람이 lophn과 Project Manager로만 좁혔다.
Deno.test("app.app_api is only in the lophn and Project Manager lists", () => {
  for (const role of ROLES) {
    assertEquals(
      builtinToolNames(role).includes("app.app_api"),
      role === "lophn" || role === "project_manager",
      role,
    );
  }
});
