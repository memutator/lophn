// 시험 전용 읽기 port. 정본 read 응답을 메모리에서 흉내 낸다. mod.ts에서 내보내지 않는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  BlobText,
  FixesOut,
  InvocationGetOut,
  ProblemListOut,
  ProblemOut,
  ReleaseGetOut,
  ReleaseListOut,
  RepairReadPort,
  ReportListOut,
  ReportOut,
  TicketOut,
  VerificationsOut,
} from "../model.ts";

export const APP = "app_01arz3ndektsv4rrffq69g5fav";
export const OTHER_APP = "app_01arz3ndektsv4rrffq69g5fb9";
export const P1 = "prb_01arz3ndektsv4rrffq69g5fa1";
export const P2 = "prb_01arz3ndektsv4rrffq69g5fa2";
export const HIDDEN = "prb_01arz3ndektsv4rrffq69g5fa3";
export const TICKET = "tkt_01arz3ndektsv4rrffq69g5fav";
export const NOW = "2026-10-07T12:00:00.000Z";
export const COMMIT = "a".repeat(40);

export const rid = (n: number) =>
  `rpt_01arz3ndektsv4rrffq69g5f${String(n).padStart(2, "0")}`;
export const sid = (n: number) =>
  `snp_01arz3ndektsv4rrffq69g5f${String(n).padStart(2, "0")}`;
export const vid = (n: number) =>
  `inv_01arz3ndektsv4rrffq69g5f${String(n).padStart(2, "0")}`;
export const relId = (n: number) =>
  `rel_01arz3ndektsv4rrffq69g5f${String(n).padStart(2, "0")}`;

export type FakeReport = {
  n: number;
  release: string | null;
  command: string;
  frame: string;
  message: string;
  text?: string;
  logs?: string;
  withInvocation?: boolean;
};

export type FakeWorld = {
  problems: Map<string, { app: string; text: string; reports: FakeReport[] }>;
  blobs: Map<string, BlobText>;
  tickets: Map<string, TicketOut["ticket"]>;
  releases: { n: number; created_at: string }[];
  fixes: Map<string, FixesOut["fixes"]>;
  hidden: Set<string>;
  calls: string[];
  redact: (text: string) => Promise<string | null>;
};

export function newWorld(): FakeWorld {
  return {
    problems: new Map(),
    blobs: new Map(),
    tickets: new Map(),
    releases: [],
    fixes: new Map(),
    hidden: new Set(),
    calls: [],
    redact: (text) => Promise.resolve(text),
  };
}

const gone = () =>
  err({
    code: "not_found",
    message: "x",
  }) as Result<never>;

function reportOf(r: FakeReport, problem: string, app: string) {
  return {
    id: rid(r.n),
    app,
    problem,
    source: r.text === undefined ? "exception" : "feedback",
    mode: "live",
    code: r.text === undefined ? "_exception" : "_feedback",
    snapshot: sid(r.n),
    observed_at: new Date(Date.UTC(2026, 9, 1) + r.n * 3_600_000).toISOString(),
    release: r.release,
    release_missing_reason: r.release === null ? "unknown" : null,
    diagnostic_scope: null,
    bundle_hash: "b".repeat(64),
    text: r.text === undefined ? null : "c".repeat(64),
    details: null,
    principal: "collector",
    content_hash: "d".repeat(64),
  };
}

export function fakePort(world: FakeWorld): RepairReadPort {
  const visible = (id: string) =>
    world.problems.has(id) && !world.hidden.has(id);
  const read = <T>(name: string, value: T): Promise<Result<T>> => {
    world.calls.push(name);
    return Promise.resolve(ok(value));
  };
  return {
    now: () => NOW,
    redact: (text) => world.redact(text),
    problem(id) {
      world.calls.push("problem");
      if (!visible(id)) return Promise.resolve(gone() as Result<ProblemOut>);
      const entry = world.problems.get(id)!;
      const reports = entry.reports;
      return Promise.resolve(ok({
        problem: {
          id,
          app: entry.app,
          group_key: {
            kind: "declared",
            code: "no_such",
            discriminator: null,
          },
          status: "open",
          work: null,
          interpretation: null,
          closure: null,
          seq: "7",
        },
        text: entry.text,
        report_count: reports.length,
        first_observed_at: reports.length === 0
          ? null
          : reportOf(reports[0], id, entry.app).observed_at,
        last_observed_at: reports.length === 0
          ? null
          : reportOf(reports[reports.length - 1], id, entry.app).observed_at,
        first_release: reports[0]?.release ?? null,
        last_release: reports[reports.length - 1]?.release ?? null,
        as_of_seq: "9",
        next_cursor: null,
      } as unknown as ProblemOut));
    },
    reports(problem, cursor) {
      world.calls.push("reports");
      if (!visible(problem)) {
        return Promise.resolve(gone() as Result<ReportListOut>);
      }
      void cursor;
      const entry = world.problems.get(problem)!;
      const list = [...entry.reports].reverse().map((r) =>
        reportOf(r, problem, entry.app)
      );
      return Promise.resolve(ok({
        reports: list,
        as_of_seq: "9",
        next_cursor: null,
      } as unknown as ReportListOut));
    },
    report(id) {
      world.calls.push("report");
      for (const [problem, entry] of world.problems) {
        const found = entry.reports.find((r) => rid(r.n) === id);
        if (found === undefined) continue;
        return Promise.resolve(ok({
          report: reportOf(found, problem, entry.app),
          snapshot: {
            id: sid(found.n),
            captured_at: NOW,
            invocation: found.withInvocation === false ? null : {
              id: vid(found.n),
              binding: "sdk_context",
              record_missing_reason: null,
            },
            invocation_missing_reason: found.withInvocation === false
              ? { reason: "not recorded" }
              : null,
            error: {
              name: "TypeError",
              message: found.message,
              message_missing_reason: null,
              frames: [{
                path: found.frame,
                function: "run",
                line: 10,
                column: 1,
              }],
              source_missing_reason: null,
              stack: null,
              stack_missing_reason: { reason: "stack unavailable" },
              truncation_notes: [],
            },
            error_missing_reason: null,
            logs: found.logs === undefined ? null : {
              blob: "e".repeat(64),
              line_count: found.logs.split("\n").length,
              truncated: false,
              scope: "process",
              from_at: null,
              to_at: null,
              collected_at: NOW,
            },
            logs_missing_reason: found.logs === undefined
              ? { reason: "log not collected" }
              : null,
            screen: null,
            screen_missing_reason: { reason: "no screen" },
          },
          missing: {
            invocation: found.withInvocation === false
              ? { reason: "not recorded" }
              : null,
            error: null,
            logs: found.logs === undefined
              ? { reason: "log not collected" }
              : null,
            screen: { reason: "no screen" },
          },
          as_of_seq: "9",
          next_cursor: null,
        } as unknown as ReportOut));
      }
      return Promise.resolve(gone() as Result<ReportOut>);
    },
    ticket(id) {
      world.calls.push("ticket");
      const ticket = world.tickets.get(id);
      return Promise.resolve(
        ticket === undefined
          ? gone() as Result<TicketOut>
          : ok({ ticket, as_of_seq: "9", next_cursor: null } as TicketOut),
      );
    },
    fixes(problem) {
      return read("fixes", {
        fixes: world.fixes.get(problem) ?? [],
        as_of_seq: "9",
        next_cursor: null,
      } as FixesOut);
    },
    verifications(_app, _problem) {
      return read("verifications", {
        verifications: [],
        as_of_seq: "9",
        next_cursor: null,
      } as unknown as VerificationsOut);
    },
    problems(app) {
      return read("problems", {
        problems: [...world.problems].filter(([id, entry]) =>
          entry.app === app && visible(id)
        ).map(([id]) => ({
          id,
          app,
          status: "open",
          symptom: "s",
          next_action: null,
          seq: "7",
        })),
        as_of_seq: "9",
        next_cursor: null,
      } as unknown as ProblemListOut);
    },
    releases(_app) {
      return read("releases", {
        releases: world.releases.map((r) => releaseOf(r.n, r.created_at)),
        as_of_seq: "9",
        next_cursor: null,
      } as unknown as ReleaseListOut);
    },
    release(id) {
      const found = world.releases.find((r) => relId(r.n) === id);
      return read("release", {
        release: found === undefined
          ? null
          : releaseOf(found.n, found.created_at),
        as_of_seq: "9",
        next_cursor: null,
      } as unknown as ReleaseGetOut);
    },
    invocation(id) {
      const command = commandOf(world, id);
      return read("invocation", {
        invocation: {
          id,
          app: APP,
          release: relId(1),
          operation: { kind: "command", command },
          trigger: { kind: "direct" },
          mode: "live",
          actor: "app",
          caller: { kind: "app" },
          approval: null,
          input_hash: null,
          status: "failed",
          started_at: NOW,
          finished_at: NOW,
          summary: { error: "boom" },
          detail_hash: null,
        },
        as_of_seq: "9",
        next_cursor: null,
      } as unknown as InvocationGetOut);
    },
    blob(ref) {
      world.calls.push("blob");
      const text = ref.field === "report_text"
        ? textOf(world, ref.owner_key)
        : logsOf(world, ref.owner_key);
      return Promise.resolve(
        text ?? { kind: "unavailable", reason: "blob missing" },
      );
    },
  };
}

function releaseOf(n: number, created_at: string) {
  return {
    id: relId(n),
    app: APP,
    number: n,
    code_commit: COMMIT,
    bundle_hash: "b".repeat(64),
    blueprint_hash: "c".repeat(64),
    data_schema: 1,
    data_changes: [],
    tests: ["vrf_01arz3ndektsv4rrffq69g5fav"],
    ticket_source: null,
    created_by: "machine",
    created_at,
    status: "active",
    activation: null,
    failure: null,
  };
}

function commandOf(world: FakeWorld, invocation: string): string {
  for (const entry of world.problems.values()) {
    for (const r of entry.reports) {
      if (vid(r.n) === invocation) return r.command;
    }
  }
  return "unknown";
}

function textOf(world: FakeWorld, report: string): BlobText | undefined {
  for (const entry of world.problems.values()) {
    for (const r of entry.reports) {
      if (rid(r.n) === report && r.text !== undefined) {
        return { kind: "text", text: r.text, truncated: false };
      }
    }
  }
  return undefined;
}

function logsOf(world: FakeWorld, report: string): BlobText | undefined {
  for (const entry of world.problems.values()) {
    for (const r of entry.reports) {
      if (rid(r.n) === report && r.logs !== undefined) {
        return { kind: "text", text: r.logs, truncated: false };
      }
    }
  }
  return undefined;
}

export function ticketOf(
  problems: string[],
  overrides: Partial<TicketOut["ticket"]> = {},
): TicketOut["ticket"] {
  return {
    id: TICKET,
    state: "open",
    readiness: "ready",
    needs: [],
    app: APP,
    kind: "repair",
    title: "Fix the crash",
    what: "w",
    why: "y",
    problems,
    claim: null,
    completion_seq: null,
    conditions: [{
      position: 0,
      kind: "app_test",
      input: { kind: "app_test" },
      condition_hash: "f".repeat(64),
    }, {
      position: 1,
      kind: "problems_closed",
      input: { kind: "problems_closed" },
      condition_hash: "f".repeat(64),
    }],
    references: [],
    adoption_questions: [],
    inspect: ["src/main.ts"],
    preserve: ["src/keep.ts"],
    revision: "5",
    ...overrides,
  };
}
