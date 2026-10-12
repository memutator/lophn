// lophn-agent/revert#R10: 앱 command tool의 호출 기록이 원래 호출 계약(app_command)과 앱의 선언된 revert
// command를 싣는다. runtime이 만드는 값(appCommandOf)이 RecordToolRequest의 계약 모양이고, 되돌리기를
// 선언하지 않은 command는 revert_command를 싣지 않는다(그 호출은 revert가 되돌릴 수 없는 사실로 남는다).
import { assert, assertEquals } from "@std/assert";
import { recordToolRequestInputSchema } from "../../../protocol/lophn-agent/mod.ts";
import type { AppTool } from "../tools/mod.ts";
import { appCommandOf } from "./prepare.ts";

const HASH = "a".repeat(64);

function toolOf(revertCommand: string | null): AppTool {
  return {
    definition: { name: "todo_add_todo" } as AppTool["definition"],
    app: "app_01arz3ndektsv4rrffq69g5fav",
    appName: "todo",
    release: "rel_01arz3ndektsv4rrffq69g5fav",
    blueprintHash: HASH,
    command: "add_todo",
    effect: "write",
    confirm: false,
    revertCommand,
    reversible: revertCommand !== null,
    definitionHash: "b".repeat(64),
    schema: null,
    permissionBasis: {
      grant: "grt_01arz3ndektsv4rrffq69g5fav",
      scope: '["add_todo"]',
      basis_seq: "12",
    },
  };
}

function request(appCommand: unknown) {
  return {
    id: "tcl_01arz3ndektsv4rrffq69g5fav",
    run: "run_01arz3ndektsv4rrffq69g5fav",
    model_call: "mcl_01arz3ndektsv4rrffq69g5fav",
    response_key: "call-1",
    response_order: 0,
    tool: "todo_add_todo",
    definition_revision: "1",
    effect: "write",
    confirm: false,
    extension: null,
    input: HASH,
    retry_of: null,
    attempt: 0,
    app_command: appCommand,
  };
}

Deno.test("lophn-agent/revert#R10: 되돌리기를 선언한 앱 command의 기록은 원래 호출 계약과 revert command를 싣고 RecordToolRequest 계약을 지난다", () => {
  const bound = appCommandOf(toolOf("revert_todo"));
  assertEquals(bound, {
    app: "app_01arz3ndektsv4rrffq69g5fav",
    release: "rel_01arz3ndektsv4rrffq69g5fav",
    command: "add_todo",
    blueprint_hash: HASH,
    definition_hash: "b".repeat(64),
    permission_basis: {
      grant: "grt_01arz3ndektsv4rrffq69g5fav",
      scope: '["add_todo"]',
      basis_seq: "12",
    },
    context_binding: null,
    revert_command: "revert_todo",
  });
  assert(recordToolRequestInputSchema.safeParse(request(bound)).success);
});

Deno.test("lophn-agent/revert#R10: 되돌리기를 선언하지 않은 앱 command는 revert_command 없이 기록된다", () => {
  const bound = appCommandOf(toolOf(null));
  assertEquals("revert_command" in bound, false);
  assert(recordToolRequestInputSchema.safeParse(request(bound)).success);
});
