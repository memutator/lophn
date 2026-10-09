import { assert, assertEquals } from "@std/assert";

import type { CoreCall } from "../../../../ipc/core.ts";
import type { CoreSource } from "../../../desktop/connection/connection.ts";
import { withReportAgain } from "./report-again.ts";
import { coreIssuesSource, type OpenIssueDecision } from "./core-source.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fd01";
const PRB = "prb_01h455vb4pex5v6nkc6gd5fd02";

function core(values: Record<string, unknown>) {
  const calls: CoreCall[] = [];
  const source: CoreSource = {
    subscribe: () => () => {},
    call(input) {
      calls.push(input);
      const key = `${input.resource}/${input.method}`;
      return Promise.resolve(
        key in values
          ? { ok: true, value: values[key] }
          : { ok: false, error: { code: "not_found", message: "x" } },
      );
    },
  };
  return { source, calls };
}

const DETAIL = {
  progress: { state: "open", label: "Waiting for a fix" },
  owner: { kind: "nobody", label: "Nobody yet" },
  needed_action: null,
  repair: {
    state: "none",
    label: "No repair",
    needs: [],
    last_check_failed: false,
  },
  result: {
    fix_report: "reported",
    fix_report_label: "Said it was fixed",
    tests: {
      state: "pass",
      label: "Tests passed",
      items: [{
        kind: "app",
        state: "pass",
        label: "App test",
        ended_at: "2026-10-01T09:00:00Z",
      }],
    },
  },
  closed: null,
};

Deno.test("shell#T53: core 문제 목록·상세를 Issues 모양으로 옮기고 결정 근거를 앱 Version·보고로 정한다", async () => {
  const fake = core({
    "problems/list": {
      problems: [{
        id: PRB,
        app: APP,
        status: "open",
        symptom: "Saving does nothing.",
        next_action: "Try again",
        seq: 3,
      }],
      next_cursor: null,
    },
    "problems/get": {
      problem: { id: PRB, app: APP, status: "open" },
      detail: DETAIL,
      text: "Saving does nothing.",
      report_count: 2,
      first_observed_at: "2026-10-01T08:00:00Z",
      last_observed_at: "2026-10-01T09:00:00Z",
    },
    "apps/get": { app: { active_release: null } },
  });
  const source = coreIssuesSource(fake.source);
  const list = await source.list(APP);
  assert(list.ok);
  assertEquals(list.value, [{
    id: PRB,
    status: "open",
    impact: "Saving does nothing.",
    nextAction: "Try again",
  }]);
  assertEquals(fake.calls[0]!.body, { app: APP });
  const view = await source.get(PRB);
  assert(view.ok);
  assertEquals(view.value.seen, 2);
  assertEquals(view.value.result.claimed, true);
  assertEquals(
    view.value.result.tests.items[0]!.endedAt,
    "2026-10-01T09:00:00Z",
  );
  // 실행 중인 Version이 없으면 고쳐짐·안 보임 결정의 근거가 없다.
  assertEquals(view.value.basis, {
    versionKnown: false,
    observationKnown: true,
  });
});

Deno.test("shell/confirmation-window#R4: 결정은 보호 창을 열기만 하고 dismiss만 한 줄 이유를 싣는다", async () => {
  const opened: Parameters<OpenIssueDecision>[0][] = [];
  const source = coreIssuesSource(core({}).source, (intent) => {
    opened.push(intent);
    return Promise.resolve();
  });
  assert(
    (await source.decide({
      problem: PRB,
      choice: "dismiss",
      note: "Not needed",
    })).ok,
  );
  assert(
    (await source.decide({ problem: PRB, choice: "fixed", note: null })).ok,
  );
  assertEquals(opened[0]!.request, {
    kind: "owner_decision",
    concern: "problems/closing",
    decision: "problem_decision",
    targets: [PRB],
    choice: "dismiss",
    note: "Not needed",
  });
  assertEquals(opened[1]!.request.note, undefined);
  assertEquals(opened[1]!.parentWindow, "requesting-window");
  // 창을 열 수 없으면 결정하지 못한다.
  const none = await coreIssuesSource(core({}).source).decide({
    problem: PRB,
    choice: "fixed",
    note: null,
  });
  assertEquals(none, { ok: false, code: "unavailable" });
});

Deno.test("shell#T53: 다시 보고는 지금 보기 세션으로 그 문제를 고른 report-problem dialog를 연다", async () => {
  const begun: [string, string | undefined][] = [];
  const feedback = {
    beginFeedback(view: string, problem?: string) {
      begun.push([view, problem]);
      return Promise.resolve({ draftRef: "draft-1" });
    },
  };
  const base = coreIssuesSource(core({}).source);
  assertEquals(await base.reportAgain(APP, PRB), {
    ok: false,
    code: "unavailable",
  });
  const wired = withReportAgain(base, feedback, "view-1");
  assertEquals(await wired.reportAgain(APP, PRB), { ok: true, value: true });
  assertEquals(begun, [["view-1", PRB]]);
  const hidden = withReportAgain(base, feedback, null);
  assertEquals(await hidden.reportAgain(APP, PRB), {
    ok: false,
    code: "unavailable",
  });
});
