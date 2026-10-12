import { assert, assertEquals } from "@std/assert";
import { Palette } from "@lophn/design/components";
import { workspaceIcons } from "../../icons/mod.ts";
import {
  click,
  one,
  render,
  settle,
  unmountSettled,
} from "../../../../design/components/testing.ts";

import {
  CONTEXT_PALETTE_PREFIX,
  contextPaletteItems,
} from "./context-palette-group.ts";
import {
  createFakeContextsSource,
  EVAL,
  HARNESS,
  PROJECT,
  RELEASE_NOTES,
} from "./fake-source.ts";
import { all, norm, typeInto } from "./testing.tsx";

async function items() {
  const listed = await createFakeContextsSource({ drafting: true }).list(
    PROJECT,
  );
  if (!listed.ok) throw new Error(listed.message);
  return contextPaletteItems(listed.value);
}

Deno.test("shell/workspace#R31 [ctx-I52]: context마다 'Contexts' 묶음의 항목 하나이고 id는 context: 접두사에 ID, 보조 글은 Context다", async () => {
  assertEquals(CONTEXT_PALETTE_PREFIX, "context:");
  const found = await items();
  assertEquals(
    found.map((item) => [item.id, item.label, item.group, item.detail]),
    [
      [`context:${EVAL}`, "eval", "Contexts", "Context"],
      [`context:${HARNESS}`, "harness", "Contexts", "Context"],
      [`context:${RELEASE_NOTES}`, "release-notes", "Contexts", "Context"],
    ],
  );
  assert(found.every((item) => item.icon === workspaceIcons.context));
});

Deno.test("shell/workspace#R31 [ctx-I52]: 팔레트에서 이름을 치면 맞는 context만 남고 고르면 그 항목 id를 돌려준다", async () => {
  const chosen: string[] = [];
  using view = render(
    <Palette
      open
      onOpenChange={() => {}}
      title="Command palette"
      items={await items()}
      onSelect={(id) => chosen.push(id)}
    />,
  );
  await settle();
  const dialog = one(document, "[role=dialog]");
  assert(
    all(dialog, "div").some((node) =>
      node.children.length === 0 && norm(node) === "Contexts"
    ),
    "the Contexts group heading is missing",
  );
  typeInto(one(dialog, "input"), "eval");
  const options = all(dialog, "[role=option]");
  assertEquals(options.length, 1);
  assert(norm(options[0]).startsWith("eval"));
  click(options[0]!);
  assertEquals(chosen, [`context:${EVAL}`]);
  await unmountSettled(view);
});
