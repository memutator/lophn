// Issues 탭의 가짜 통로. core를 부르지 않고 부른 것을 기록한다. Orders 앱의 문제 넷(열림 둘 가운데
// 하나는 해결됨이던 것이 다시 열림, 해결됨, 무시)이 들어 있다.
import type {
  IssueFilter,
  IssueRow,
  IssuesSource,
  IssueStatus,
  IssueView,
  SourceResult,
} from "../source.ts";

export const PRB_SHIP = "prb_01h455vb4pex5v6nkc6gd5fd01";
export const PRB_TOTAL = "prb_01h455vb4pex5v6nkc6gd5fd02";
export const PRB_LIST = "prb_01h455vb4pex5v6nkc6gd5fd03";
export const PRB_SLIP = "prb_01h455vb4pex5v6nkc6gd5fd04";

const COMMIT = "3f9a1c2";

export const ISSUES: readonly IssueView[] = [
  {
    id: PRB_SHIP,
    status: "open",
    impact:
      "Marking an order as shipped fails when the address has no postal code.",
    count: 14,
    firstAt: "2026-10-12T09:14:00",
    lastAt: "2026-10-15T14:32:00",
    recurred: null,
    occurrences: [
      {
        report: "rpt_1",
        at: "2026-10-15T14:32:00",
        releaseNumber: 7,
        kind: "app_error",
      },
      {
        report: "rpt_2",
        at: "2026-10-15T11:50:00",
        releaseNumber: 7,
        kind: "report",
      },
      {
        report: "rpt_3",
        at: "2026-10-14T16:03:00",
        releaseNumber: 6,
        kind: "app_error",
      },
    ],
    evidence: {
      stack:
        "TypeError: Cannot read properties of undefined (reading 'trim')\n  at normalizeAddress (src/orders/address.ts:27:31)\n  at markShipped (src/orders/ship.ts:48:11)",
      log:
        "14:32:07 orders.markShipped order=1042\n14:32:07 carrier lookup skipped: no postal code",
      release: { number: 7, commit: COMMIT },
      reports: ["Shipping order 1042 just shows a red error."],
    },
  },
  {
    id: PRB_TOTAL,
    status: "open",
    impact: "Order totals are one cent off after a percentage discount.",
    count: 5,
    firstAt: "2026-10-08T10:02:00",
    lastAt: "2026-10-15T14:21:00",
    recurred: { resolvedAt: "2026-10-09T16:20:00", releaseNumber: 7 },
    occurrences: [
      {
        report: "rpt_4",
        at: "2026-10-15T14:21:00",
        releaseNumber: 7,
        kind: "report",
      },
      {
        report: "rpt_5",
        at: "2026-10-15T11:05:00",
        releaseNumber: 7,
        kind: "app_error",
      },
      {
        report: "rpt_6",
        at: "2026-10-09T09:12:00",
        releaseNumber: 5,
        kind: "report",
      },
    ],
    evidence: {
      stack:
        "RangeError: total mismatch (expected 4200, got 4199)\n  at roundTotal (src/orders/totals.ts:31:18)\n  at applyDiscount (src/orders/discount.ts:12:5)",
      log:
        "11:05:44 orders.create order=1038 discount=10%\n11:05:44 total check failed: 4199 != 4200",
      release: { number: 7, commit: COMMIT },
      reports: ["The total says 41.99 but the 10% discount should give 42.00."],
    },
  },
  {
    id: PRB_LIST,
    status: "resolved",
    impact: "The order list is empty when two filters are applied together.",
    count: 3,
    firstAt: "2026-10-09T13:30:00",
    lastAt: "2026-10-10T08:45:00",
    recurred: null,
    occurrences: [
      {
        report: "rpt_7",
        at: "2026-10-10T08:45:00",
        releaseNumber: 5,
        kind: "report",
      },
    ],
    evidence: {
      stack: "Error: empty result\n  at listOrders (src/orders/list.ts:64:9)",
      log: "08:45:10 orders.list filters=status,carrier rows=0",
      release: { number: 5, commit: "b81e7d0" },
      reports: ["Filtering by status and carrier shows nothing."],
    },
  },
  {
    id: PRB_SLIP,
    status: "ignored",
    impact: "A packing slip shows the customer's old address.",
    count: 1,
    firstAt: "2026-10-13T15:12:00",
    lastAt: "2026-10-13T15:12:00",
    recurred: null,
    occurrences: [
      {
        report: "rpt_8",
        at: "2026-10-13T15:12:00",
        releaseNumber: 6,
        kind: "report",
      },
    ],
    evidence: {
      stack: null,
      log: null,
      release: { number: 6, commit: "9d04ac1" },
      reports: ["The slip printed my old street."],
    },
  },
];

interface FakeOptions {
  /** 이 이름의 읽기·쓰기는 실패한다. */
  failing?: readonly string[];
}

export function fakeIssues(options: FakeOptions = {}) {
  const calls: unknown[][] = [];
  const failing = new Set(options.failing ?? []);
  const states = new Map<string, IssueStatus>(
    ISSUES.map((issue) => [issue.id, issue.status]),
  );
  const viewOf = (issue: IssueView): IssueView => ({
    ...issue,
    status: states.get(issue.id) ?? issue.status,
  });
  const reply = <T>(name: string, value: T): Promise<SourceResult<T>> => {
    calls.push([name]);
    return Promise.resolve(
      failing.has(name)
        ? { ok: false, code: "unavailable" }
        : { ok: true, value },
    );
  };
  const source: IssuesSource = {
    list: (_app, filter: IssueFilter) => {
      const rows: IssueRow[] = ISSUES.map(viewOf)
        .filter((issue) =>
          (filter.status === null || issue.status === filter.status) &&
          (filter.since === null ||
            new Date(issue.lastAt) >= new Date(filter.since))
        )
        .map((issue) => ({
          id: issue.id,
          status: issue.status,
          impact: issue.impact,
          count: issue.count,
          lastAt: issue.lastAt,
          recurredRelease: issue.recurred?.releaseNumber ?? null,
        }));
      return reply("list", rows);
    },
    get: (problem) => {
      const found = ISSUES.find((issue) => issue.id === problem);
      calls.push(["get", problem]);
      return Promise.resolve(
        found === undefined || failing.has("get")
          ? {
            ok: false,
            code: found === undefined ? "not_found" : "unavailable",
          }
          : { ok: true, value: viewOf(found) },
      );
    },
    setState: (problem, state) => {
      calls.push(["setState", problem, state]);
      if (failing.has("setState")) {
        return Promise.resolve({ ok: false, code: "unavailable" });
      }
      states.set(problem, state);
      return Promise.resolve({ ok: true, value: true });
    },
  };
  return { source, calls };
}
