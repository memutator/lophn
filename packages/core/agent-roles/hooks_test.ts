import { assert, assertEquals } from "@std/assert";
import type { ToolContext } from "../lophn-agent/tools/mod.ts";
import { FILE_HOOKS } from "./hooks.ts";

// 빠지면 agent가 사람의 지침 파일을 Gate 없이 고친다.
Deno.test("writeGate는 어느 폴더의 LOPHN.md에만 settings_edit Gate 요청을 낸다", () => {
  const ctx = {
    session: "ses_a",
    turn: "trn_a",
    tool_call: "tcl_a",
    agent: { role: "lophn" },
  } as unknown as ToolContext;
  for (const path of ["LOPHN.md", "notes/LOPHN.md", "/place/sub/LOPHN.md"]) {
    const request = FILE_HOOKS.writeGate(path, ctx);
    assert(request !== null, path);
    assertEquals(request.kind, "settings_edit");
    assertEquals(request.target, {
      kind: "settings_edit",
      what: "instructions",
      id: null,
    });
  }
  for (const path of ["README.md", "notes/lophn.md", "LOPHN.md.bak"]) {
    assertEquals(FILE_HOOKS.writeGate(path, ctx), null, path);
  }
});
