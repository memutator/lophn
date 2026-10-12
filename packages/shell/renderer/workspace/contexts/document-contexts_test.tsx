import { assertEquals } from "@std/assert";
import {
  click,
  one,
  render,
  settle,
} from "../../../../design/components/testing.ts";

import { DocumentContexts } from "./document-contexts.tsx";
import {
  createFakeContextsSource,
  EVAL,
  HARNESS,
  PROJECT,
} from "./fake-source.ts";
import { all, buttonNamed, norm } from "./testing.tsx";

function contexts(
  path: string,
  onOpenContext: (context: string) => void = () => {},
) {
  return render(
    <DocumentContexts
      source={createFakeContextsSource()}
      project={PROJECT}
      path={path}
      onOpenContext={onOpenContext}
    />,
  );
}

Deno.test("shell/workspace#R28 [ctx-I50]: 문서가 든 context를 이름과 그 안에서의 종류로 나열하고 [Open]이 그 Context 탭을 연다", async () => {
  const opened: string[] = [];
  using view = contexts(
    "eval/experiments/exp-008-query-tools.md",
    (context) => opened.push(context),
  );
  await settle();
  const rows = all(view.container, "[data-containing]");
  assertEquals(rows.map((row) => row.dataset.containing), [EVAL]);
  assertEquals(norm(rows[0]!.querySelector("[data-containing-name]")), "eval");
  assertEquals(
    norm(rows[0]!.querySelector("[data-containing-role]")),
    "as an Experiment",
  );
  click(buttonNamed(rows[0]!, "Open")!);
  assertEquals(opened, [EVAL]);
});

Deno.test("shell/workspace#R28 [ctx-I50]: 두 context에 든 문서는 둘을 모두 나열하고 관사는 종류 이름에 맞춘다", async () => {
  using view = contexts("docs/shared-overview.md");
  await settle();
  assertEquals(
    all(view.container, "[data-containing]").map((row) => [
      row.dataset.containing,
      norm(row.querySelector("[data-containing-name]")),
      norm(row.querySelector("[data-containing-role]")),
    ]),
    [[EVAL, "eval", "as a Finding"], [HARNESS, "harness", "as a Change"]],
  );
});

Deno.test("shell/workspace#R28 [ctx-I50]: 든 context가 하나도 없으면 단추 없이 비었음 글만 보인다", async () => {
  using view = contexts("docs/notes.md");
  await settle();
  assertEquals(
    norm(one(view.container, "[data-empty]")),
    "No context includes this document.",
  );
  assertEquals(all(view.container, "[data-containing]").length, 0);
  assertEquals(all(view.container, "button").length, 0);
});
