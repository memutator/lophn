import { assert, assertEquals } from "@std/assert";
import {
  click,
  one,
  render,
  settle,
} from "../../../../../packages/design/components/testing.ts";

import { ContextViolations } from "./context-violations.tsx";
import { createFakeContextsSource, EVAL, HARNESS } from "./fake-source.ts";
import { all, buttonNamed, buttonsNamed, norm } from "./testing.tsx";

function violations(
  context = EVAL,
  source = createFakeContextsSource(),
  onOpenDocument: (path: string) => void = () => {},
) {
  return render(
    <ContextViolations
      source={source}
      context={context}
      onOpenDocument={onOpenDocument}
    />,
  );
}

Deno.test("shell/workspace#R19 [ctx-I44]: 위반은 줄마다 파일 이름·무엇이 어긋났는지·규칙 한 줄을 경로 순으로 보인다", async () => {
  using view = violations();
  await settle();
  const rows = all(view.container, "[data-violation]");
  assertEquals(rows.map((row) => row.dataset.path), [
    "eval/experiments/exp-012-ftb-quests-021-q8.md",
    "loop/findings/F-014.md",
  ]);
  const first = rows[0]!;
  assertEquals(
    norm(first.querySelector("[data-violation-file]")),
    "exp-012-ftb-quests-021-q8.md",
  );
  assertEquals(
    norm(first.querySelector("[data-violation-message]")),
    "about is missing",
  );
  assertEquals(
    norm(first.querySelector("[data-violation-rule]")),
    "rule: Experiment.about-required",
  );
  assertEquals(
    norm(rows[1]!.querySelector("[data-violation-file]")),
    "F-014.md",
  );
  assertEquals(
    norm(rows[1]!.querySelector("[data-violation-message]")),
    "scenario sched-x doesn't exist",
  );
});

Deno.test("shell/workspace#R19 [ctx-I44]: 위에 [Send all to Context Engineer]가 있고 이미 넘긴 줄은 단추 대신 상태 글이 보인다", async () => {
  using view = violations();
  await settle();
  const all_ = buttonNamed(view.container, "Send all to Context Engineer")!;
  assert(all_, "[Send all] is missing");
  const rows = all(view.container, "[data-violation]");
  assert(
    all_.compareDocumentPosition(rows[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    "[Send all] must come before the rows",
  );
  assertEquals(
    all(rows[0]!, "button").map(norm),
    ["Send to Context Engineer"],
  );
  assertEquals(all(rows[1]!, "button").length, 0);
  assertEquals(
    norm(rows[1]!.querySelector("[data-violation-status]")),
    "Context Engineer is on it",
  );
});

Deno.test("shell/workspace#R19 [ctx-I44]: 한 줄을 넘기면 그 줄의 키만 보내고 그 줄만 상태 글로 바뀐다", async () => {
  const source = createFakeContextsSource();
  using view = violations(EVAL, source);
  await settle();
  const row = all(view.container, "[data-violation]")[0]!;
  click(buttonNamed(row, "Send to Context Engineer")!);
  await settle();
  assertEquals(source.calls, [{
    command: "handOffViolations",
    request: {
      context: EVAL,
      violations: [{
        kind: "rule",
        rule: "Experiment.about-required",
        path: "eval/experiments/exp-012-ftb-quests-021-q8.md",
        section: null,
      }],
    },
  }]);
  const after = all(view.container, "[data-violation]")[0]!;
  assertEquals(all(after, "button").length, 0);
  assertEquals(
    norm(after.querySelector("[data-violation-status]")),
    "Context Engineer is on it",
  );
});

Deno.test("shell/workspace#R19 [ctx-I44]: [Send all]은 위반 목록 없이 context만 보내고 모든 줄이 상태 글이 된다", async () => {
  const source = createFakeContextsSource();
  using view = violations(EVAL, source);
  await settle();
  click(buttonNamed(view.container, "Send all to Context Engineer")!);
  await settle();
  assertEquals(source.calls, [{
    command: "handOffViolations",
    request: { context: EVAL },
  }]);
  assertEquals(
    buttonsNamed(view.container, "Send to Context Engineer").length,
    0,
  );
  assertEquals(all(view.container, "[data-violation-status]").length, 2);
});

Deno.test("shell/workspace#R19 [ctx-I44]: 파일 이름을 누르면 그 문서 경로로 문서 탭을 연다", async () => {
  const opened: string[] = [];
  using view = violations(
    EVAL,
    createFakeContextsSource(),
    (path) => opened.push(path),
  );
  await settle();
  // data-violation-file 요소가 눌리는 링크(또는 단추) 자체다.
  click(one(view.container, "[data-violation] [data-violation-file]"));
  assertEquals(opened, ["eval/experiments/exp-012-ftb-quests-021-q8.md"]);
});

Deno.test("shell/workspace#R19 [ctx-I44]: 위반이 없으면 'No violations.'만 보이고 단추가 없다", async () => {
  using view = violations(HARNESS);
  await settle();
  assertEquals(norm(view.container), "No violations.");
  assertEquals(all(view.container, "button").length, 0);
});
