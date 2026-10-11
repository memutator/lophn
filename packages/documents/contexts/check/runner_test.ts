import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { loadFixture } from "../extract/testing.ts";
import type { ProjectFiles } from "../extract/types.ts";
import { runCheck } from "./runner.ts";
import { snapshotHash } from "./snapshot.ts";
import {
  filesWith,
  FIXTURE_EXPECTED_VIOLATIONS,
  fixtureExpected,
  inputOf,
} from "./testing.ts";
import type { CheckViolation } from "./types.ts";

const SHA256 = /^[0-9a-f]{64}$/;
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// 위반 순서: path, kind, rule(null은 ""), section(null이 먼저)의 code unit 순
function sorted(violations: readonly CheckViolation[]): CheckViolation[] {
  return [...violations].sort((a, b) =>
    compare(a.path, b.path) || compare(a.kind, b.kind) ||
    compare(a.rule ?? "", b.rule ?? "") ||
    compare(a.section ?? "", b.section ?? "")
  );
}

Deno.test("documents/contexts#R20 [ctx-I23]: the fixture contract over the fixture files passes and records its seven violations in order", () => {
  const input = inputOf();
  const outcome = runCheck(input);
  assertEquals(outcome.status, "passed");
  assertEquals(outcome.findings, []);
  assertEquals(outcome.violation_count, FIXTURE_EXPECTED_VIOLATIONS);
  // 3 extract + 4 rule, merged by path, kind, rule, section
  assertEquals(outcome.violations, sorted(fixtureExpected() as never));
  assertEquals(outcome.violations.map((v) => v.path), [
    "docs/README.md",
    "eval/experiments/exp-003-paused.md",
    "eval/experiments/exp-004-nostatus.md",
    "eval/experiments/exp-005-badyaml.md",
    "eval/experiments/exp-010-tiller.md",
    "eval/experiments/notes.md",
    "loop/findings/F-003.md",
  ]);
  assertEquals(outcome.violation_count, outcome.violations.length);
  assert(SHA256.test(outcome.snapshot_hash));
  assertEquals(outcome.snapshot_hash, snapshotHash(input.files));
});

Deno.test("documents/contexts#R20 [ctx-I23]: a bundle that fails the schema fails with a contract_invalid finding at the bad place", () => {
  const input = inputOf((raw) => raw.schema = 2);
  const outcome = runCheck(input);
  assertEquals(outcome.status, "failed");
  assertEquals(outcome.findings.length, 1);
  assertEquals(outcome.findings[0].kind, "contract_invalid");
  assertEquals(outcome.findings[0].target, "schema");
  assertNotEquals(outcome.findings[0].detail.trim(), "");
  // 계약이 읽히지 않으면 위반은 세지 않지만 snapshot은 떴다
  assertEquals(outcome.violation_count, 0);
  assertEquals(outcome.violations, []);
  assertEquals(outcome.snapshot_hash, snapshotHash(input.files));
});

Deno.test("documents/contexts#R20 [ctx-I23]: a bundle that is not even an object fails with a finding that has no target", () => {
  const outcome = runCheck({ ...inputOf(), bundle: "nope" });
  assertEquals(outcome.status, "failed");
  assertEquals(outcome.findings.map((f) => [f.kind, f.target]), [
    ["contract_invalid", null],
  ]);
});

Deno.test("documents/contexts#R20 [ctx-I23]: a path that leaves the project is a cross_project_path finding", () => {
  const outcome = runCheck(
    inputOf((raw) => raw.contract.types[1].source.paths = ["../other/*.md"]),
  );
  assertEquals(outcome.status, "failed");
  assertEquals(
    outcome.findings.map((f) => [f.kind, f.target]),
    [["cross_project_path", "contract.types.1.source.paths.0"]],
  );
  const example = runCheck(
    inputOf((raw) => raw.examples[1].path = "/abs/exp.md"),
  );
  assertEquals(
    example.findings.map((f) => [f.kind, f.target]),
    [["cross_project_path", "examples.1.path"]],
  );
});

Deno.test("documents/contexts#R20 [ctx-I23]: a meaning issue fails with that issue, one finding per issue in issue order", () => {
  // runs_on이 없는 type을 가리키면 그 관계와, 그 관계를 따르던 검색이 함께 깨진다
  const outcome = runCheck(
    inputOf((raw) => raw.contract.types[0].relations[0].to = "Scenarios"),
  );
  assertEquals(outcome.status, "failed");
  assertEquals(outcome.findings, [
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
  // 계약이 깨졌으면 개체를 계산하지 않는다
  assertEquals(outcome.violation_count, 0);
  assertEquals(outcome.violations, []);
});

Deno.test("documents/contexts#R20 [ctx-I23]: pointing at another context's private type is a private_reference finding", () => {
  const outcome = runCheck(
    inputOf((raw) => raw.contract.types[0].relations[1].to = "rubrics/Draft"),
  );
  assertEquals(outcome.status, "failed");
  assertEquals(outcome.findings, [{
    kind: "private_reference",
    target: "contract.types.0.relations.1.to",
    detail: "relation_target_private",
  }]);
});

Deno.test("documents/contexts#R20 [ctx-I23]: an entity example that does not match fails with an example_mismatch naming its index", () => {
  const wrongField = runCheck(
    inputOf((raw) => raw.examples[1].expect.fields.status = "done"),
  );
  assertEquals(wrongField.status, "failed");
  assertEquals(wrongField.findings.length, 1);
  assertEquals(wrongField.findings[0].kind, "example_mismatch");
  assertEquals(wrongField.findings[0].target, "examples.1");
  assert(wrongField.findings[0].detail.startsWith("field_differs"));

  const missing = runCheck(
    inputOf((raw) => raw.examples[1].expect.key = "999"),
  );
  assertEquals(
    missing.findings.map((f) => [f.kind, f.target]),
    [["example_mismatch", "examples.1"]],
  );
  assert(missing.findings[0].detail.startsWith("entity_not_found"));

  // 같은 개체라도 path가 다르면 그 자리의 예가 아니다
  const elsewhere = runCheck(
    inputOf((raw) => raw.examples[1].path = "eval/experiments/exp-001-plan.md"),
  );
  assertEquals(
    elsewhere.findings.map((f) => [f.kind, f.target]),
    [["example_mismatch", "examples.1"]],
  );
});

Deno.test("documents/contexts#R20 [ctx-I23]: an example that lists no fields only needs the entity to exist there", () => {
  const outcome = runCheck(
    inputOf((raw) => delete raw.examples[1].expect.fields),
  );
  assertEquals(outcome.status, "passed");
});

Deno.test("documents/contexts#R20 [ctx-I23]: a search example whose expected keys differ fails, and every failing example is reported", () => {
  const outcome = runCheck(
    inputOf((raw) => {
      raw.examples[0].expect_keys = ["002"];
      raw.examples[1].expect.fields.status = "done";
    }),
  );
  assertEquals(outcome.status, "failed");
  assertEquals(
    outcome.findings.map((f) => [f.kind, f.target]),
    [["example_mismatch", "examples.0"], ["example_mismatch", "examples.1"]],
  );
  assert(outcome.findings[0].detail.startsWith("keys_differ"));
  // 위반은 예가 틀려도 센다
  assertEquals(outcome.violation_count, FIXTURE_EXPECTED_VIOLATIONS);
});

Deno.test("documents/contexts#R20 [ctx-I23]: a search example must return the keys in the expected order, no more and no fewer", () => {
  const keys = (expect: string[]) =>
    runCheck(
      inputOf((raw) => {
        // 정렬이 없는 table: 시작 type이 series이므로 번호 순
        raw.searches[1].result = {
          kind: "table",
          columns: [{ label: "Key", path: "key" }],
          page_size: 30,
        };
        raw.examples[0] = {
          kind: "search",
          search: "experiments_by_status",
          inputs: { status: ["running", "done"] },
          expect_keys: expect,
        };
      }),
    ).status;
  assertEquals(keys(["001", "002"]), "passed");
  assertEquals(keys(["002", "001"]), "failed");
  assertEquals(keys(["001"]), "failed");
  assertEquals(keys(["001", "002", "003"]), "failed");
});

Deno.test("documents/contexts#R20 [ctx-I23]: a board example lists its keys lane by lane in the declared enum order", () => {
  const status = (expect: string[]) =>
    runCheck(
      inputOf((raw) => {
        raw.examples[0] = {
          kind: "search",
          search: "experiments_by_status",
          inputs: { status: ["running", "done"] },
          expect_keys: expect,
        };
      }),
    ).status;
  // enum은 planned, running, done 순이므로 running 칸(002)이 done 칸(001)보다 앞이다
  assertEquals(status(["002", "001"]), "passed");
  assertEquals(status(["001", "002"]), "failed");
});

Deno.test("documents/contexts#R20 [ctx-I23]: a search example whose inputs the search rejects fails as a search_error", () => {
  const outcome = runCheck(
    inputOf((raw) => raw.examples[0].inputs = { experiment: ["001", "002"] }),
  );
  assertEquals(outcome.status, "failed");
  assertEquals(outcome.findings[0].kind, "example_mismatch");
  assertEquals(outcome.findings[0].target, "examples.0");
  assert(outcome.findings[0].detail.startsWith("search_error"));
});

Deno.test("documents/contexts#R20 [ctx-I23]: a saved view whose inputs no longer fit its search fails the check", () => {
  // status는 값을 고르는 입력이라 숫자는 받지 못한다. 모양 검사와 의미 검사는 지나간다.
  const outcome = runCheck(
    inputOf((raw) => raw.saved_views[0].inputs = { status: 5 }),
  );
  assertEquals(outcome.status, "failed");
  assertEquals(outcome.findings, [{
    kind: "saved_view_broken",
    target: "saved_views.Running experiments",
    detail: "input_invalid: status",
  }]);
  assertEquals(outcome.violation_count, FIXTURE_EXPECTED_VIOLATIONS);
});

Deno.test("documents/contexts#R20 [ctx-I23]: a saved view that names a search the bundle no longer has is a meaning issue, not a run", () => {
  const outcome = runCheck(
    inputOf((raw) => raw.saved_views[0].search = "gone"),
  );
  assertEquals(outcome.status, "failed");
  assertEquals(outcome.findings.map((f) => [f.kind, f.detail]), [
    ["contract_invalid", "saved_view_search_unknown"],
  ]);
});

Deno.test("documents/contexts#R20 [ctx-I23]: a crash while extracting is an aborted finding, never a throw", () => {
  // 앱 명령이 던지면 app-data type을 뽑는 extract가 멈춘다
  const input = inputOf();
  const outcome = runCheck({
    ...input,
    appData: () => {
      throw new Error("disk went away");
    },
  });
  assertEquals(outcome.status, "failed");
  assertEquals(outcome.findings.length, 1);
  assertEquals(outcome.findings[0].kind, "aborted");
  assertEquals(outcome.findings[0].target, null);
  assert(outcome.findings[0].detail.includes("disk went away"));
});

Deno.test("documents/contexts#R20 [ctx-I23]: extra rule-breaking files still pass and only raise the violation count", () => {
  const base = runCheck(inputOf());
  const input = inputOf(
    undefined,
    filesWith({
      "eval/experiments/exp-020-wild.md":
        "---\nstatus: wild\nscenarios: []\n---\n# Wild arm\n",
      "loop/findings/F-004.md":
        '---\nexperiment: "098"\n---\n# Another orphan\n',
    }),
  );
  const outcome = runCheck(input);
  assertEquals(outcome.status, "passed");
  assertEquals(outcome.findings, []);
  assertEquals(outcome.violation_count, FIXTURE_EXPECTED_VIOLATIONS + 2);
  assertEquals(outcome.violations, sorted(outcome.violations));
  for (const violation of base.violations) {
    assert(outcome.violations.some((v) => same(v, violation)));
  }
  const added = outcome.violations.filter((v) =>
    !base.violations.some((b) => same(b, v))
  );
  assertEquals(
    added.map((v) => [v.kind, v.rule, v.path, v.target]),
    [
      [
        "rule",
        "Experiment.status-known",
        "eval/experiments/exp-020-wild.md",
        null,
      ],
      ["rule", "Finding.about-exists", "loop/findings/F-004.md", "098"],
    ],
  );
  // 다른 파일 상태이므로 다른 snapshot이다
  assertNotEquals(outcome.snapshot_hash, base.snapshot_hash);
});

const same = (a: CheckViolation, b: CheckViolation) =>
  JSON.stringify(a) === JSON.stringify(b);

Deno.test("documents/contexts#R20 [ctx-I23]: the same snapshot and bundle give a byte-identical outcome", () => {
  const first = runCheck(inputOf());
  const second = runCheck(inputOf());
  assertEquals(second, first);
  assertEquals(JSON.stringify(second), JSON.stringify(first));
  const failed = (): string =>
    JSON.stringify(
      runCheck(inputOf((raw) => raw.examples[0].expect_keys = [])),
    );
  assertEquals(failed(), failed());
});

Deno.test("documents/contexts#R20 [ctx-I23]: snapshot_hash changes when one byte of one file changes", () => {
  const base = runCheck(inputOf());
  const files = loadFixture("eval-project");
  const path = "eval/experiments/exp-001-plan.md";
  const text = files.read(path) ?? "";
  const changed: ProjectFiles = {
    paths: () => files.paths(),
    read: (p) => p === path ? text + "\n" : files.read(p),
  };
  const outcome = runCheck(inputOf(undefined, changed));
  assertNotEquals(outcome.snapshot_hash, base.snapshot_hash);
  assert(SHA256.test(outcome.snapshot_hash));
});

Deno.test("documents/contexts#R20 [ctx-I23]: snapshot_hash does not change when only the order of paths() changes", () => {
  const base = runCheck(inputOf());
  const files = loadFixture("eval-project");
  const reversed: ProjectFiles = {
    paths: () => [...files.paths()].reverse(),
    read: (p) => files.read(p),
  };
  assertEquals(
    runCheck(inputOf(undefined, reversed)).snapshot_hash,
    base.snapshot_hash,
  );
  assertEquals(snapshotHash(reversed), snapshotHash(files));
});
