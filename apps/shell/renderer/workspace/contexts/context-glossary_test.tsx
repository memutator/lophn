import { assert, assertEquals } from "@std/assert";
import {
  click,
  one,
  render,
  settle,
} from "../../../../../packages/design/components/testing.ts";

import { ContextGlossary } from "./context-glossary.tsx";
import {
  createFakeContextsSource,
  EVAL,
  fakeId,
  HARNESS,
} from "./fake-source.ts";
import type { ContextsSource } from "./source.ts";
import {
  all,
  buttonNamed,
  fieldLabeled,
  norm,
  NOW,
  typeInto,
} from "./testing.tsx";

const SCENARIO = fakeId("trm", "g2");
const NEW_ID = fakeId("trm", "new1");

function glossary(
  context = EVAL,
  source: ContextsSource = createFakeContextsSource(),
) {
  return render(
    <ContextGlossary
      source={source}
      context={context}
      newId={() => NEW_ID}
      now={NOW}
    />,
  );
}

const termRows = (root: ParentNode) =>
  all(root, "[data-term]").map((row) => [
    norm(row.querySelector("[data-term-name]")),
    norm(row.querySelector("[data-term-by]")),
    norm(row.querySelector("[data-term-when]")),
  ]);

Deno.test("shell/workspace#R20 [ctx-I45]: 용어집은 agent가 사람 말을 알아듣는 자료라는 한 줄과 용어·뜻·누가·언제를 용어 순으로 보인다", async () => {
  using view = glossary();
  await settle();
  assertEquals(
    norm(one(view.container, "[data-glossary-note]")),
    "Agents use these words and meanings to understand what you say.",
  );
  assertEquals(termRows(view.container), [
    ["rubric", "Context Engineer", "3 days ago"],
    ["scenario", "You", "2 days ago"],
    ["world action", "Context Engineer", "1 hour ago"],
  ]);
  assertEquals(
    norm(all(view.container, "[data-term-meaning]")[1]),
    "One task the agent is asked to do.",
  );
});

Deno.test("shell/workspace#R20 [ctx-I45]: 뜻을 고치면 바뀐 field만 base_revision과 함께 보내고 목록에 반영되며 정한 쪽이 You가 된다", async () => {
  const source = createFakeContextsSource();
  using view = glossary(EVAL, source);
  await settle();
  const row = () =>
    one(view.container, `[data-term][data-entry="${SCENARIO}"]`);
  click(buttonNamed(row(), "Edit")!);
  const meaning = fieldLabeled(row(), "Meaning") as HTMLInputElement;
  assertEquals(meaning.value, "One task the agent is asked to do.");
  typeInto(meaning, "One task given to the agent.");
  click(buttonNamed(row(), "Save")!);
  await settle();
  assertEquals(source.calls, [{
    command: "glossarySet",
    request: { entry: SCENARIO, meaning: "One task given to the agent." },
    compare: { base_revision: "51" },
  }]);
  assertEquals(
    norm(row().querySelector("[data-term-meaning]")),
    "One task given to the agent.",
  );
  assertEquals(norm(row().querySelector("[data-term-by]")), "You");
  assert(buttonNamed(row(), "Edit"), "the row did not leave edit mode");
});

Deno.test("shell/workspace#R20 [ctx-I45]: [Add term]은 용어와 뜻을 받아 새 ID로 보내고 용어 순 자리에 줄이 생긴다", async () => {
  const source = createFakeContextsSource();
  using view = glossary(EVAL, source);
  await settle();
  click(buttonNamed(view.container, "Add term")!);
  typeInto(fieldLabeled(view.container, "Term"), "finding");
  typeInto(
    fieldLabeled(view.container, "Meaning"),
    "What an experiment showed.",
  );
  click(buttonNamed(view.container, "Add")!);
  await settle();
  assertEquals(source.calls, [{
    command: "glossarySet",
    request: {
      id: NEW_ID,
      context: EVAL,
      term: "finding",
      meaning: "What an experiment showed.",
    },
  }]);
  assertEquals(
    termRows(view.container).map(([term]) => term),
    ["finding", "rubric", "scenario", "world action"],
  );
});

Deno.test("shell/workspace#R20 [ctx-I45]: [Delete]는 항목을 base_revision과 함께 지우고 줄이 사라진다", async () => {
  const source = createFakeContextsSource();
  using view = glossary(EVAL, source);
  await settle();
  const row = one(view.container, `[data-term][data-entry="${SCENARIO}"]`);
  click(buttonNamed(row, "Delete")!);
  await settle();
  assertEquals(source.calls, [{
    command: "glossaryRemove",
    request: { entry: SCENARIO },
    compare: { base_revision: "51" },
  }]);
  assertEquals(
    termRows(view.container).map(([term]) => term),
    ["rubric", "world action"],
  );
});

Deno.test("shell/workspace#R20 [ctx-I45]: 명령이 실패하면 줄을 그대로 두고 이유를 alert로 보인다", async () => {
  const source: ContextsSource = {
    ...createFakeContextsSource(),
    glossaryRemove: () =>
      Promise.resolve({ ok: false, message: "changed elsewhere" }),
  };
  using view = glossary(EVAL, source);
  await settle();
  click(buttonNamed(all(view.container, "[data-term]")[0]!, "Delete")!);
  await settle();
  assertEquals(norm(one(view.container, "[role=alert]")), "changed elsewhere");
  assertEquals(all(view.container, "[data-term]").length, 3);
});

Deno.test("shell/workspace#R20 [ctx-I45]: 용어가 없으면 비었음 상태와 [Add term]만 보인다", async () => {
  using view = glossary(HARNESS);
  await settle();
  one(view.container, "[data-state=empty]");
  assertEquals(all(view.container, "[data-term]").length, 0);
  assert(buttonNamed(view.container, "Add term"));
});
