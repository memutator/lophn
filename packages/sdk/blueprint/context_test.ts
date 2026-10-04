import { assertEquals, assertThrows } from "@std/assert";
import { defineAgentContext } from "./define.ts";
import { command, screen } from "./fixture.ts";
import type {
  AgentContextDeclaration,
  CommandDeclaration,
  ScreenDeclaration,
} from "./mod.ts";
import { validateBlueprint } from "./mod.ts";

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

function host(
  value: AgentContextDeclaration,
  refs: { screens: ScreenDeclaration[]; commands: CommandDeclaration[] },
) {
  return {
    name: "agent context",
    description: "agent context declaration",
    screens: refs.screens,
    commands: refs.commands,
    automatic_tasks: [],
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [value],
    app_connections: [],
    sdk_dependencies: [],
  };
}

Deno.test("apps/blueprint#R22: defineAgentContext는 supported write와 다른 undo를 받고 잘못된 참조를 거절한다", () => {
  const before = structuredClone(declaration);
  const refsBefore = structuredClone(references);
  const accepted = validateBlueprint(host(declaration, references));
  assertEquals(accepted.ok, true);
  const defined = authored(declaration, references);
  assertEquals(defined, declaration);
  assertEquals(declaration, before);
  assertEquals(references, refsBefore);

  const cases: Array<[
    AgentContextDeclaration,
    { screens: ScreenDeclaration[]; commands: CommandDeclaration[] },
    string,
  ]> = [
    [
      declaration,
      { screens: references.screens, commands: [note, undo] },
      "agent context read command must be read and confirm false",
    ],
    [
      {
        ...declaration,
        annotation_targets: [{
          key: "hint",
          label: "Hint",
          write_command: "missing",
        }],
      },
      references,
      "annotation target command must be write",
    ],
    [
      declaration,
      {
        screens: references.screens,
        commands: [
          command("lookup", "read", { confirm: true }),
          note,
          undo,
        ],
      },
      "agent context read command must be read and confirm false",
    ],
    [
      { ...declaration, sensitive_paths: ["secret"] },
      references,
      "sensitive path must be a JSON Pointer",
    ],
    [
      {
        ...declaration,
        annotation_targets: [
          declaration.annotation_targets[0]!,
          { ...declaration.annotation_targets[0]! },
        ],
      },
      references,
      "duplicate annotation target",
    ],
    [
      declaration,
      {
        screens: [{ ...home, sizes: [] }],
        commands: references.commands,
      },
      "screen sizes must be nonempty",
    ],
  ];
  for (const [value, refs, message] of cases) {
    const result = validateBlueprint(host(value, refs));
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.error.message, message);
    assertThrows(() => authored(value, refs), TypeError, message);
  }
});
