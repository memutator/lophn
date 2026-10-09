import assert from "node:assert/strict";
import { test } from "node:test";

import { createKinds } from "./mod.ts";
import {
  APPLY_PROBLEM_DECISION,
  PROBLEM_CONCERN,
  PROBLEM_DECISION,
  readProblemDecision,
  submitProblemDecision,
} from "./problem-decision.ts";
import { fakeCore, handle, id, ok } from "./kinds_fixture.ts";

const PRB = id("prb", 1);
const APP = id("app", 1);
const REL = id("rel", 1);
const RPT = id("rpt", 1);

type Choice = "fixed" | "not_fixed" | "not_visible" | "dismiss";

function intent(choice: Choice, note?: string) {
  return {
    kind: "owner_decision" as const,
    concern: PROBLEM_CONCERN,
    decision: PROBLEM_DECISION,
    targets: [PRB],
    choice,
    ...(note === undefined ? {} : { note }),
  };
}

function core(
  over: { status?: string; release?: string | null; reports?: string[] } = {},
) {
  return fakeCore({
    "read:problems/get": () =>
      ok({
        problem: {
          id: PRB,
          app: APP,
          status: over.status ?? "open",
          seq: "41",
        },
        text: "Some bank files can't be read.",
        report_count: 3,
      }),
    "read:apps/get": () =>
      ok({
        app: {
          id: APP,
          active_release: over.release === undefined ? REL : over.release,
        },
      }),
    "read:releases/get": () => ok({ release: { id: REL, number: 4 } }),
    "read:problems/list-reports": () =>
      ok({ reports: (over.reports ?? [RPT]).map((report) => ({ id: report })) }),
  });
}

test("problems/closing#R7, shell/confirmation-window#R2: 문제 결정 정본은 문제 seq·활성 release·마지막 보고를 독립 read해 고른 결정에 묶는다", async () => {
  const fake = core();
  const read = await readProblemDecision(fake, intent("not_visible"));
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const content = {
    choice: "not_visible",
    problem: PRB,
    basis_seq: "41",
    release: REL,
    last_report: RPT,
    note: null,
  };
  // route binding이 [choice, problem, …]이라 handle 대상은 고른 결정이다(contract는 그대로).
  assert.equal(read.value.targetRef, "not_visible");
  assert.deepEqual(read.value.content, content);
  assert.deepEqual(read.value.allowed, [APPLY_PROBLEM_DECISION]);
  assert.deepEqual(read.value.request, {
    kind: "owner_decision",
    concern: PROBLEM_CONCERN,
    decision: PROBLEM_DECISION,
    targets: [PRB],
    input: { kind: "inline", value: content },
    comparison: { problem_seq: "41", release: REL },
  });
  assert.deepEqual(read.value.view, {
    kind: "problem_decision",
    choice: "not_visible",
    symptom: "Some bank files can't be read.",
    seen: 3,
    version: 4,
    note: null,
  });
});

test("problems/closing#R8, R10: dismiss는 한 줄 이유를 묶고, 이유가 없거나 닫힌 문제의 닫기·release 없는 fixed는 고를 결정이 없다", async () => {
  const dismissed = await readProblemDecision(
    core(),
    intent("dismiss", "Not needed anymore"),
  );
  assert.equal(dismissed.ok && dismissed.value.allowed.length, 1);
  assert.equal(
    dismissed.ok && record(dismissed.value.content).note,
    "Not needed anymore",
  );
  assert.equal(dismissed.ok && record(dismissed.value.content).last_report, null);
  const noReason = await readProblemDecision(core(), intent("dismiss"));
  assert.equal(noReason.ok && noReason.value.allowed.length, 0);
  const closedFixed = await readProblemDecision(
    core({ status: "closed" }),
    intent("fixed"),
  );
  assert.equal(closedFixed.ok && closedFixed.value.allowed.length, 0);
  const reopen = await readProblemDecision(
    core({ status: "closed" }),
    intent("not_fixed"),
  );
  assert.deepEqual(reopen.ok && reopen.value.allowed, [APPLY_PROBLEM_DECISION]);
  const noRelease = await readProblemDecision(
    core({ release: null }),
    intent("fixed"),
  );
  assert.equal(noRelease.ok && noRelease.value.allowed.length, 0);
  const noReport = await readProblemDecision(
    core({ reports: [] }),
    intent("not_visible"),
  );
  assert.equal(noReport.ok && noReport.value.allowed.length, 0);
  const missing = await readProblemDecision(fakeCore({}), intent("fixed"));
  assert.equal(missing.ok, false);
});

test("problems/closing#R6, shell/confirmation-window#R4: 제출은 정본 그대로 ApplyProblemDecision을 compare·handle과 함께 보낸다", async () => {
  const fake = fakeCore({
    "command:problems/apply-decision": () =>
      ok({ status: "closed", closure: null }),
  });
  const content = {
    choice: "fixed",
    problem: PRB,
    basis_seq: "41",
    release: REL,
    last_report: null,
    note: null,
  };
  const given = handle();
  const sent = await submitProblemDecision(fake, { handle: given, content });
  assert.deepEqual(sent, {
    ok: true,
    value: { receipt: { kind: "entity", id: PRB }, result: "applied" },
  });
  assert.deepEqual(fake.calls, [{
    kind: "command",
    resource: "problems",
    method: "apply-decision",
    body: {
      input: content,
      idempotency_key: `confirmation:${given.ref}`,
      compare: { problem_seq: "41", release: REL },
      prepared: [],
      confirmation: given.ref,
    },
  }]);
});

test("shell/confirmation-window#R4: kinds는 problems/closing 결정을 이 종류로 읽고 ApplyProblemDecision만 보낸다", async () => {
  const fake = core();
  const kinds = createKinds({
    core: () => fake,
    clock: { now: () => 0 },
    random: (bytes) => bytes,
  });
  const read = await kinds.canon.read(intent("fixed"), "cfw_1");
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.value.view?.kind, "problem_decision");
  const refused = await kinds.submit.submit({
    handle: handle(),
    decision: PROBLEM_DECISION,
    commandInput: {},
    canonical: read.value,
  });
  assert.equal(refused.ok, false);
});

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}
