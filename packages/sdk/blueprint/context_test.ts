import { assertEquals, assertThrows } from "@std/assert";
import { defineAgentContext } from "./define.ts";
import { command, screen } from "./fixture.ts";
import type {
  AgentContextDeclaration,
  CommandDeclaration,
  ScreenDeclaration,
} from "./mod.ts";

const home = screen();
const lookup = command("lookup", "read");
const note = command("note", "write");
const undo = command("undo", "write", { revert: { supported: false } });
const references = {
  screens: [home],
  commands: [lookup, note, undo],
};
const declaration: AgentContextDeclaration = {
  screen: "home",
  read_command: "lookup",
  sensitive_paths: ["/secret"],
  annotation_targets: [{
    key: "hint",
    label: "Hint",
    write_command: "note",
  }],
};

function authored(
  value: AgentContextDeclaration,
  refs: { screens: ScreenDeclaration[]; commands: CommandDeclaration[] },
) {
  return defineAgentContext(value, refs);
}

Deno.test("apps/blueprint#R22: defineAgentContext는 supported write와 다른 undo를 받고 잘못된 참조를 거절한다", () => {
  const before = structuredClone(declaration);
  const refsBefore = structuredClone(references);
  const defined = authored(declaration, references);
  assertEquals(defined, declaration);
  assertEquals(declaration, before);
  assertEquals(references, refsBefore);

  assertThrows(
    () =>
      authored(declaration, {
        screens: references.screens,
        commands: [note, undo],
      }),
    TypeError,
  );
  assertThrows(
    () =>
      authored({
        ...declaration,
        annotation_targets: [{
          key: "hint",
          label: "Hint",
          write_command: "missing",
        }],
      }, references),
    TypeError,
  );
  assertThrows(
    () =>
      authored(declaration, {
        screens: references.screens,
        commands: [
          command("lookup", "read", { confirm: true }),
          note,
          undo,
        ],
      }),
    TypeError,
  );
  assertThrows(
    () => authored({ ...declaration, sensitive_paths: ["secret"] }, references),
    TypeError,
  );
  assertThrows(
    () =>
      authored({
        ...declaration,
        annotation_targets: [
          declaration.annotation_targets[0]!,
          { ...declaration.annotation_targets[0]! },
        ],
      }, references),
    TypeError,
  );
  assertThrows(
    () =>
      authored(declaration, {
        screens: [{ ...home, sizes: [] }],
        commands: references.commands,
      }),
    TypeError,
  );
});
