import { assertEquals } from "@std/assert";
import type { AgentRef, Role } from "../../../protocol/lophn-agent/mod.ts";
import { ROLE_TABLE } from "./role-table.ts";

const PROJECT = "prj_00000000000000000000000001";
const OPERATOR = "agt_00000000000000000000000001";

// 자리가 어긋나면 사람이 만든 정의와 지침이 읽히지 않아 사라진 것처럼 보인다.
Deno.test("role 3개의 정의 file 자리와 built-in 이름은 전과 같다", () => {
  const refs: [AgentRef, string | undefined, string][] = [
    [{ role: "lophn" }, undefined, "/r/agents/lophn.md"],
    [
      { role: "project_manager", project: PROJECT as never },
      undefined,
      `/r/projects/${PROJECT}/agents/project-manager.md`,
    ],
    [
      { role: "operator", agent: OPERATOR as never },
      "project",
      `/r/projects/${PROJECT}/agents/${OPERATOR}.md`,
    ],
  ];
  for (const [ref, operatorIn, path] of refs) {
    const slot = ROLE_TABLE.slotOf(
      "/r",
      ref,
      operatorIn === undefined
        ? undefined
        : { kind: "project", id: PROJECT as never },
    )!;
    assertEquals(`${slot.folder}/${slot.file}`, path);
  }
  assertEquals(
    ROLE_TABLE.slotOf("/r", { role: "operator", agent: OPERATOR as never }),
    null,
  );

  const names: [Role, string | null][] = [
    ["lophn", "lophn"],
    ["project_manager", "Project Manager"],
    ["operator", null],
  ];
  for (const [role, name] of names) {
    assertEquals(ROLE_TABLE.builtinName(role), name);
  }
  assertEquals(ROLE_TABLE.isReservedName("Operator"), false);
});
