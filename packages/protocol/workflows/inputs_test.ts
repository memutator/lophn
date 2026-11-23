import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateInputWhen,
  resolveInputDefaults,
  validateInputDeclaration,
  validateWorkflowInputs,
  type WorkflowInputsDeclaration,
  workflowInputsSchema,
  workflowOutputsSchema,
} from "./inputs.ts";

test("evaluateInputWhen: equals, in, truthy, AND 배열을 평가한다", () => {
  assert.equal(evaluateInputWhen(undefined, {}), true);
  assert.equal(
    evaluateInputWhen({ field: "mode", equals: "fast" }, { mode: "fast" }),
    true,
  );
  assert.equal(
    evaluateInputWhen({ field: "mode", equals: "fast" }, { mode: "deep" }),
    false,
  );
  assert.equal(
    evaluateInputWhen(
      { field: "env", in: ["staging", "prod"] },
      { env: "prod" },
    ),
    true,
  );
  assert.equal(
    evaluateInputWhen(
      { field: "env", in: ["staging", "prod"] },
      { env: "dev" },
    ),
    false,
  );
  assert.equal(
    evaluateInputWhen({ field: "flag", truthy: true }, { flag: true }),
    true,
  );
  assert.equal(
    evaluateInputWhen({ field: "flag", truthy: true }, { flag: false }),
    false,
  );
  assert.equal(
    evaluateInputWhen({ field: "flag", truthy: false }, { flag: "" }),
    true,
  );
  assert.equal(
    evaluateInputWhen({ field: "items", truthy: true }, { items: [] }),
    false,
  );
  assert.equal(
    evaluateInputWhen({ field: "items", truthy: true }, { items: ["a"] }),
    true,
  );
  assert.equal(
    evaluateInputWhen(
      [
        { field: "mode", equals: "deploy" },
        { field: "confirm", truthy: true },
      ],
      { mode: "deploy", confirm: true },
    ),
    true,
  );
  assert.equal(
    evaluateInputWhen(
      [
        { field: "mode", equals: "deploy" },
        { field: "confirm", truthy: true },
      ],
      { mode: "deploy", confirm: false },
    ),
    false,
  );
});

test("resolveInputDefaults: 빠진 필드에만 기본값을 채우고 배열을 복제한다", () => {
  const decl: WorkflowInputsDeclaration = {
    retries: { type: "number", default: 3 },
    dry_run: { type: "boolean", default: true },
    tags: { type: "multiselect", options: ["a", "b"], default: ["a"] },
  };
  const resolved = resolveInputDefaults(decl, { dry_run: false });
  assert.deepEqual(resolved, { retries: 3, dry_run: false, tags: ["a"] });
  (resolved.tags as string[]).push("b");
  assert.deepEqual(decl.tags.default, ["a"]);
});

test("validateWorkflowInputs: 8종 타입, 기본값, 숨겨진 when 필드 제거를 검증한다", () => {
  const decl: WorkflowInputsDeclaration = {
    title: { type: "string", required: true },
    notes: { type: "text", default: "none" },
    limit: { type: "number", min: 1, max: 10, default: 5 },
    publish: { type: "boolean", required: true, default: false },
    env: {
      type: "select",
      required: true,
      options: ["dev", { value: "prod", label: "Production" }],
      default: "dev",
    },
    targets: {
      type: "multiselect",
      required: true,
      options: ["web", "mobile", { value: "cli", label: "CLI" }],
    },
    reviewer: { type: "agent", required: true },
    spec_path: { type: "path", kind: "file", required: true },
    target_project: { type: "project", required: true },
    prod_ticket: {
      type: "string",
      required: true,
      default: "DEFAULT-TICKET",
      when: { field: "env", equals: "prod" },
    },
    prod_note: {
      type: "text",
      required: true,
      when: { field: "prod_ticket", truthy: true },
    },
  };

  const callableAgents = new Set(["lophn", "coder"]);
  const okRes = validateWorkflowInputs(
    decl,
    {
      title: "Ship phase 3",
      targets: ["web", "cli"],
      reviewer: "coder",
      spec_path: "docs/spec.md",
      target_project: "lophn",
      prod_ticket: "SHOULD-BE-STRIPPED",
      extra_unknown: "ignored",
    },
    { callableAgents },
  );
  assert.equal(okRes.ok, true);
  if (okRes.ok) {
    assert.deepEqual(okRes.value, {
      title: "Ship phase 3",
      notes: "none",
      limit: 5,
      publish: false,
      env: "dev",
      targets: ["web", "cli"],
      reviewer: "coder",
      spec_path: "docs/spec.md",
      target_project: "lophn",
    });
    assert.equal("prod_ticket" in okRes.value, false);
    assert.equal("prod_note" in okRes.value, false);
    assert.equal("extra_unknown" in okRes.value, false);
  }

  // env가 prod면 숨겨졌던 prod_ticket(기본값 적용)과 연쇄 when인 prod_note까지 검사된다.
  const prodMissing = validateWorkflowInputs(
    decl,
    {
      title: "Ship prod",
      env: "prod",
      targets: ["web"],
      reviewer: "coder",
      spec_path: "docs/spec.md",
      target_project: "lophn",
    },
    { callableAgents },
  );
  assert.equal(prodMissing.ok, false);
  if (!prodMissing.ok) {
    assert.ok(prodMissing.errors.prod_note);
    assert.equal(prodMissing.errors.prod_ticket, undefined);
  }

  // 각 타입 오류 검증
  const invalid = validateWorkflowInputs(
    decl,
    {
      title: "   ",
      limit: 99,
      publish: "yes",
      env: "qa",
      targets: ["web", "unknown"],
      reviewer: "ghost",
      spec_path: "  ",
      target_project: "   ",
    },
    { callableAgents },
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.ok(invalid.errors.title);
    assert.ok(invalid.errors.limit);
    assert.ok(invalid.errors.publish);
    assert.ok(invalid.errors.env);
    assert.ok(invalid.errors.targets);
    assert.ok(invalid.errors.reviewer);
    assert.ok(invalid.errors.spec_path);
    assert.ok(invalid.errors.target_project);
  }
});

test("validateInputDeclaration: 없는 when 대상, 자기 참조, cycle, 옵션 없음, default 불일치를 잡는다", () => {
  const valid = workflowInputsSchema.parse({
    mode: { type: "select", options: ["a", "b"], default: "a" },
    detail: { type: "string", when: { field: "mode", equals: "b" } },
  });
  assert.deepEqual(validateInputDeclaration(valid), { ok: true });

  const missingRef = validateInputDeclaration({
    a: { type: "string", when: { field: "ghost", truthy: true } },
  });
  assert.equal(missingRef.ok, false);
  if (!missingRef.ok) assert.match(missingRef.errors.a, /ghost/);

  const selfRef = validateInputDeclaration({
    a: { type: "boolean", when: { field: "a", truthy: true } },
  });
  assert.equal(selfRef.ok, false);
  if (!selfRef.ok) assert.match(selfRef.errors.a, /itself/);

  const cycle = validateInputDeclaration({
    a: { type: "string", when: { field: "b", truthy: true } },
    b: { type: "string", when: { field: "c", truthy: true } },
    c: { type: "string", when: { field: "a", truthy: true } },
  });
  assert.equal(cycle.ok, false);
  if (!cycle.ok) {
    assert.match(cycle.errors.a, /cycle/);
    assert.match(cycle.errors.b, /cycle/);
    assert.match(cycle.errors.c, /cycle/);
  }

  const badOptionsAndDefaults = validateInputDeclaration({
    emptySelect: { type: "select", options: [] },
    dupMulti: { type: "multiselect", options: ["x", { value: "x" }] },
    badRange: { type: "number", min: 10, max: 2 },
    badDefault: { type: "number", min: 1, max: 5, default: 10 },
    badSelectDefault: { type: "select", options: ["a"], default: "z" },
  });
  assert.equal(badOptionsAndDefaults.ok, false);
  if (!badOptionsAndDefaults.ok) {
    assert.ok(badOptionsAndDefaults.errors.emptySelect);
    assert.ok(badOptionsAndDefaults.errors.dupMulti);
    assert.ok(badOptionsAndDefaults.errors.badRange);
    assert.ok(badOptionsAndDefaults.errors.badDefault);
    assert.ok(badOptionsAndDefaults.errors.badSelectDefault);
  }

  const parsedOutputs = workflowOutputsSchema.parse({
    summary: { type: "string", description: "final summary", required: true },
    artifacts: { type: "refs" },
  });
  assert.equal(parsedOutputs.summary.type, "string");
  assert.equal(parsedOutputs.artifacts.type, "refs");
});
