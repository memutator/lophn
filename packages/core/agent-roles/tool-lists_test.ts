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

// 앱 진단 tool은 사람이 lophn과 App Engineer로만 좁혔다. job tool은 lophn, Project Manager, App Engineer만 받는다.
// Operator는 job이 부르는 쪽이고 credential 상한이 tool의 route에서 나오므로 목록에 없으면 job route에도 닿지 못한다.
Deno.test("app diagnosis tools are only in the lophn and App Engineer lists, job tools only in the lophn, Project Manager and App Engineer lists", () => {
  const table: [string[], string[]][] = [
    [["app.tools", "app.status", "app.logs", "app.invocations"], [
      "lophn",
      "app_engineer",
    ]],
    [["job.create", "job.update", "job.delete", "job.list"], [
      "lophn",
      "project_manager",
      "app_engineer",
    ]],
  ];
  for (const [names, roles] of table) {
    for (const role of ROLES) {
      for (const name of names) {
        assertEquals(
          builtinToolNames(role).includes(name),
          roles.includes(role),
          `${role} ${name}`,
        );
      }
    }
  }
});
