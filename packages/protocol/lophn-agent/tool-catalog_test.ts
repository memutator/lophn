import { assert, assertEquals } from "@std/assert";
import { ROLES } from "./places.ts";
import {
  builtinToolNames,
  TOOL_INPUTS,
  toWireToolName,
  WIRE_TOOL_NAME_PATTERN,
} from "./tool-catalog.ts";

// 이름이 겹치면 tool 실행이 다른 tool로 간다.
Deno.test("builtin tool wire names fit the provider rule and never collide", () => {
  for (const role of ROLES) {
    const names = builtinToolNames(role);
    const wire = names.map(toWireToolName);
    for (const name of wire) assert(WIRE_TOOL_NAME_PATTERN.test(name), name);
    assertEquals(new Set(wire).size, wire.length, `${role} has a collision`);
    assertEquals(new Set(names).size, names.length, `${role} lists twice`);
    for (const name of names) assert(name in TOOL_INPUTS, name);
  }
});
