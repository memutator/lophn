// context.preview 순수 함수의 acceptance 시험이다. 구현 전이라 모두 실패해야 한다(spec 단계).
// draft는 eval-project의 계약이고 파일은 eval-project fixture다. 정답 개체 수는 expected/에서 센다.
import { assert, assertEquals } from "@std/assert";
import { runCheck } from "../check/mod.ts";
import {
  filesWith,
  FIXTURE_EXPECTED_VIOLATIONS,
  fixtureExpected,
  fixtureRaw,
  inputOf,
} from "../check/testing.ts";
import { loadAppData, loadFixture } from "../extract/testing.ts";
import { sampleEnv } from "../validate/sample.ts";
import { previewDraft } from "./run.ts";
import type { PreviewInput } from "./types.ts";

// 격리 검사 입력과 같은 fixture에서 preview 입력을 만든다.
function previewOf(
  // deno-lint-ignore no-explicit-any
  edit: (raw: any) => void = () => {},
  files = loadFixture("eval-project"),
  appData = loadAppData("eval-project"),
): PreviewInput {
  const input = inputOf(edit, files);
  return { draft: input.bundle, files, appData, env: sampleEnv() };
}

const expectedEntities = (): { type: string }[] =>
  JSON.parse(
    Deno.readTextFileSync(
      new URL(
        "../testdata/expected/eval-project.entities.json",
        import.meta.url,
      ),
    ),
  );

// 정답 개체를 계약의 type 순서로 센 것. 앱 데이터를 읽지 않으면 app-data kind type은 0이다.
function expectedCounts(withAppData: boolean) {
  const entities = expectedEntities();
  return fixtureRaw().contract.types.map((type: {
    name: string;
    source: { kind: string };
  }) => ({
    type: type.name,
    count: type.source.kind === "app-data" && !withAppData
      ? 0
      : entities.filter((entity) => entity.type === type.name).length,
  }));
}

Deno.test("documents/contexts#R19 [ctx-I64p]: previewing the fixture contract over the fixture files counts the expected entities per type in contract order", () => {
  const outcome = previewDraft(previewOf());
  assertEquals(outcome.types, expectedCounts(true));
  assertEquals(outcome.types.map((t) => t.type), [
    "Experiment",
    "Scenario",
    "Finding",
    "Decision",
    "Guide",
    "GuideHeading",
    "Event",
  ]);
  assertEquals(outcome.types.map((t) => t.count), [5, 2, 3, 2, 2, 6, 2]);
});

Deno.test("documents/contexts#R24 [ctx-I64p]: the preview finds the same seven violations as the check, in path, kind, rule, section order", () => {
  const outcome = previewDraft(previewOf());
  assertEquals(outcome.violation_count, FIXTURE_EXPECTED_VIOLATIONS);
  assertEquals(outcome.violations.length, outcome.violation_count);
  assertEquals(outcome.findings, []);
  const check = runCheck(inputOf());
  assertEquals(outcome.violations, check.violations);
  assertEquals(
    outcome.violations.map((v) => v.path),
    [...fixtureExpected() as { path: string }[]].map((v) => v.path).sort(),
  );
});

Deno.test("documents/contexts#R19 [ctx-I64p]: the findings are the check's, so a failing example is shown before the draft is submitted and the counts stay", () => {
  const edit = (
    // deno-lint-ignore no-explicit-any
    raw: any,
  ) => raw.examples[1].expect.fields.status = "done";
  const outcome = previewDraft(previewOf(edit));
  const check = runCheck(inputOf(edit));
  assertEquals(outcome.findings, check.findings);
  assertEquals(outcome.findings.map((f) => [f.kind, f.target]), [
    ["example_mismatch", "examples.1"],
  ]);
  assertEquals(outcome.types, expectedCounts(true));
  assertEquals(outcome.violations, check.violations);
});

Deno.test("documents/contexts#R19 [ctx-I64p]: a draft that fails the shape or the meaning stops with those findings, no counts and no violations", () => {
  const shape = previewDraft(previewOf((raw) => raw.schema = 2));
  assertEquals(shape.findings.map((f) => f.kind), ["contract_invalid"]);
  assertEquals(shape.types, []);
  assertEquals(shape.violation_count, 0);
  assertEquals(shape.violations, []);

  const meaning = previewDraft(
    previewOf((raw) => raw.contract.types[0].relations[0].to = "Scenarios"),
  );
  assertEquals(meaning.findings, [
    {
      kind: "contract_invalid",
      target: "contract.types.0.relations.0.to",
      detail: "relation_target_unknown",
    },
    {
      kind: "contract_invalid",
      target: "searches.2.query.follow.0.relation",
      detail: "search_follow_relation_unknown",
    },
  ]);
  assertEquals(meaning.types, []);
  assertEquals(meaning.violations, []);

  const cross = previewDraft(
    previewOf((raw) => raw.contract.types[1].source.paths = ["../other/*.md"]),
  );
  assertEquals(cross.findings.map((f) => f.kind), ["cross_project_path"]);

  const notObject = previewDraft({ ...previewOf(), draft: "nope" });
  assertEquals(notObject.findings.map((f) => [f.kind, f.target]), [
    ["contract_invalid", null],
  ]);
});

Deno.test("documents/contexts#R19 [ctx-I64p]: the preview reads the files as they are now, so a new file shows as a new entity and its violation", () => {
  const nostatus = Deno.readTextFileSync(
    new URL(
      "../testdata/eval-project/eval/experiments/exp-004-nostatus.md",
      import.meta.url,
    ),
  );
  const files = filesWith({ "eval/experiments/exp-011-new.md": nostatus });
  const outcome = previewDraft(previewOf(() => {}, files));
  assertEquals(outcome.types[0], { type: "Experiment", count: 6 });
  assertEquals(outcome.violation_count, FIXTURE_EXPECTED_VIOLATIONS + 1);
  assert(
    outcome.violations.some((v) =>
      v.path === "eval/experiments/exp-011-new.md" &&
      v.rule === "Experiment.status-required"
    ),
  );
  // the same draft over the old files still counts five
  assertEquals(previewDraft(previewOf()).types[0], {
    type: "Experiment",
    count: 5,
  });
});

Deno.test("documents/contexts#R12 [ctx-I64p]: the preview does not read app data, so an app-data type counts zero and nothing else changes", () => {
  const outcome = previewDraft(
    previewOf(() => {}, undefined, () => undefined),
  );
  assertEquals(outcome.types, expectedCounts(false));
  assertEquals(outcome.types[6], { type: "Event", count: 0 });
  assertEquals(
    outcome.violations,
    runCheck({ ...inputOf(), appData: () => undefined }).violations,
  );
});

Deno.test("documents/contexts#R3 [ctx-I64p]: previewing is a pure read: the same input gives the same result and the draft is left as it was", () => {
  const input = previewOf();
  const draft = JSON.stringify(input.draft);
  const paths = input.files.paths().length;
  const a = previewDraft(input);
  const b = previewDraft(input);
  assertEquals(a, b);
  assertEquals(JSON.stringify(input.draft), draft);
  assertEquals(input.files.paths().length, paths);
});

Deno.test("documents/contexts#R19 [ctx-I64p]: a saved view of the draft whose inputs do not fit its search is a saved_view_broken finding while the counts stay", () => {
  const outcome = previewDraft(
    previewOf((raw) => raw.saved_views[0].inputs = { status: 5 }),
  );
  assertEquals(outcome.findings, [{
    kind: "saved_view_broken",
    target: "saved_views.Running experiments",
    detail: "input_invalid: status",
  }]);
  assertEquals(outcome.types, expectedCounts(true));
});
