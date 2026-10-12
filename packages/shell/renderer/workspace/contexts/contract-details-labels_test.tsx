import { assertEquals } from "@std/assert";
import { render, settle } from "../../../../design/components/testing.ts";

import { ContractDetails } from "./contract-details.tsx";
import { createFakeContextsSource, EVAL } from "./fake-source.ts";
import { all, norm } from "./testing.tsx";

function details() {
  return render(
    <ContractDetails source={createFakeContextsSource()} context={EVAL} />,
  );
}

Deno.test("shell/workspace#R21 [ctx-I46]: 관계 선마다 그 관계의 label이 선 위에 적힌다", async () => {
  using view = details();
  await settle();
  assertEquals(
    all(view.container, "[data-edge]").map((edge) =>
      `${edge.dataset.from}>${edge.dataset.to} ${norm(edge)}`
    ),
    [
      "Experiment>Change checks",
      "Experiment>Scenario runs on",
      "Experiment>Finding produces",
      "Scenario>Rubric graded by",
      "Finding>Change about",
      "Finding>Scenario from",
    ],
  );
});

Deno.test("shell/workspace#R21 [ctx-I46]: 선언된 검색은 입력의 label을 이름 옆에 쉼표로 잇는다", async () => {
  using view = details();
  await settle();
  assertEquals(
    all(view.container, "[data-declared-search]").map((row) => [
      norm(row.querySelector("[data-search-name]")),
      norm(row.querySelector("[data-search-inputs]")),
    ]),
    [
      ["findings_about_change", "Change, Kind, Metric"],
      ["experiments_by_status", "Scenario, Status"],
      ["scenarios_by_rubric", "Rubric"],
    ],
  );
});
