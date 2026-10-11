import { assertEquals } from "@std/assert";
import { seriesKind } from "./series.ts";
import {
  documentAnchor,
  inlineFiles,
  kindContext,
  loadContract,
  loadFixture,
  typeOf,
  typeWith,
} from "./testing.ts";

const fixtureResult = () =>
  seriesKind(
    typeOf(loadContract("eval-project"), "Experiment", "series"),
    kindContext(loadFixture("eval-project")),
  );

Deno.test("documents/contexts#R11 [ctx-I8]: series entities come in natural number order", () => {
  assertEquals(fixtureResult().anchors, [
    documentAnchor("Experiment", "eval/experiments/exp-001-plan.md", {
      n: "001",
    }),
    documentAnchor("Experiment", "eval/experiments/exp-002-sight.md", {
      n: "002",
    }),
    documentAnchor("Experiment", "eval/experiments/exp-003-paused.md", {
      n: "003",
    }),
    documentAnchor("Experiment", "eval/experiments/exp-004-nostatus.md", {
      n: "004",
    }),
    // 읽을 수 있는지는 run이 본다. kind는 이름이 맞는 파일을 모두 낸다.
    documentAnchor("Experiment", "eval/experiments/exp-005-badyaml.md", {
      n: "005",
    }),
    documentAnchor("Experiment", "eval/experiments/exp-010-tiller.md", {
      n: "010",
    }),
  ]);
});

Deno.test("documents/contexts#R11 [ctx-I8]: a file in the pattern folder with the same extension that misses the pattern is a path_mismatch", () => {
  assertEquals(fixtureResult().violations, [{
    kind: "path_mismatch",
    rule: null,
    type: "Experiment",
    path: "eval/experiments/notes.md",
    section: null,
    target: null,
  }]);
});

const run = (files: Record<string, string>, pattern: string) =>
  seriesKind(
    typeWith("Item", { kind: "series", pattern, order: "natural" }),
    kindContext(inlineFiles(files)),
  );
const empty = "";

Deno.test("documents/contexts#R11 [ctx-I8]: numbers compare as numbers, so 2 < 9 < 10 even when text order differs", () => {
  const result = run({
    "log/e-10.md": empty,
    "log/e-2.md": empty,
    "log/e-9.md": empty,
    "log/e-100.md": empty,
  }, "log/e-{n}.md");
  assertEquals(result.anchors.map((a) => a.captures.n), [
    "2",
    "9",
    "10",
    "100",
  ]);
});

Deno.test("documents/contexts#R11 [ctx-I8]: equal numbers keep leading zeros in the capture and order by path", () => {
  const result = run({
    "log/e-002-b.md": empty,
    "log/e-002-a.md": empty,
    "log/e-001-z.md": empty,
  }, "log/e-{n}-*.md");
  assertEquals(result.anchors.map((a) => [a.captures.n, a.path]), [
    ["001", "log/e-001-z.md"],
    ["002", "log/e-002-a.md"],
    ["002", "log/e-002-b.md"],
  ]);
});

Deno.test("documents/contexts#R11 [ctx-I8]: major, minor and patch captures take dotted numbers and compare part by part", () => {
  const result = run({
    "rel/v0.10.md": empty,
    "rel/v0.2.md": empty,
    "rel/v0.9.md": empty,
  }, "rel/v{major}.md");
  assertEquals(result.anchors.map((a) => a.captures.major), [
    "0.2",
    "0.9",
    "0.10",
  ]);
});

Deno.test("documents/contexts#R11 [ctx-I8]: only files directly in the pattern folder and with the pattern extension can be mismatches", () => {
  const result = run({
    "log/e-1.md": empty,
    "log/readme.md": empty,
    "log/e-1.txt": empty,
    "log/sub/e-x.md": empty,
    "other/readme.md": empty,
  }, "log/e-{n}.md");
  assertEquals(result.anchors.map((a) => a.path), ["log/e-1.md"]);
  assertEquals(result.violations.map((v) => v.path), ["log/readme.md"]);
});
