// 문제 상세 detail을 T20·T21의 실제 닫힘·결정 data로 읽는다(problems#T22). 실제 임시
// ledger 위에서 제품과 같은 RecordReport·CloseProblemVerified·ApplyProblemDecision으로
// 닫고 다시 연 뒤 GetProblem을 읽는다. 닫힘 행을 직접 심지 않는다.
import { assert, assertEquals } from "@std/assert";
import {
  canonicalize,
  formatAt,
  type Result,
  sha256Hex,
} from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../apps/core/testing/ledger.ts";
import { MACHINE_TEST } from "../closing/testing/mod.ts";
import { APP_A, COLLECTOR, reportInput } from "./testing/mod.ts";

const registration = [
  new URL("./testing/mod.ts", import.meta.url),
  new URL("../closing/testing/mod.ts", import.meta.url),
];
const NOW_MS = Date.parse("2026-10-04T12:00:00.000Z");
const REL_AFTER = "rel_01arz3ndektsv4rrffq69g5fa2";
const REL_BEFORE = "rel_01arz3ndektsv4rrffq69g5fa1";
const LATER = "2026-10-19T12:00:00.000Z";

const USER: AuthenticatedContext = {
  principal: "user-1",
  actor: "user",
  scope: { operations: ["ApplyProblemDecision", "GetProblem"], targets: {} },
  conditions: {},
  credential_ref: "cred-user",
};

let serial = 500;
const key = (name: string) => `${name}-${++serial}`;

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

async function open(): Promise<LedgerHarness> {
  return value(
    await createLedgerHarness({
      registrationModules: registration,
      credentials: [COLLECTOR, MACHINE_TEST, USER],
      nowMs: NOW_MS,
    }),
  );
}

async function machine(
  h: LedgerHarness,
  command: string,
  input: unknown,
  compare: unknown = {},
) {
  return value(
    await h.command(MACHINE_TEST, {
      command,
      input,
      compare,
      idempotency_key: key(command),
      prepared: [],
    } as never),
  );
}

async function activate(h: LedgerHarness, release: string): Promise<void> {
  await machine(h, "problems.testing.activate", { app: APP_A, release });
}

async function seqOf(h: LedgerHarness, problem: string): Promise<string> {
  const rows = value(
    await h.inspect(
      "select cast(max(seq) as text) as seq from events where subject = ?",
      [problem],
    ),
  );
  return String(rows[0]!["seq"]);
}

async function closedAt(h: LedgerHarness, problem: string): Promise<string> {
  const rows = value(
    await h.inspect(
      `select at from events where type = 'ProblemClosed' and subject = ?
        order by seq desc limit 1`,
      [problem],
    ),
  );
  return String(rows[0]!["at"]);
}

async function report(
  h: LedgerHarness,
  options: { problem?: string; observedAt?: string; release?: string } = {},
): Promise<{ problem: string; report: string }> {
  serial++;
  const spec = reportInput({
    serial,
    release: options.release ?? REL_AFTER,
    observedAt: options.observedAt,
  });
  let input = spec;
  let problemSeq: string | null = null;
  if (options.problem !== undefined) {
    const rows = value(
      await h.inspect("select group_key from problems where id = ?", [
        options.problem,
      ]),
    );
    input = { ...spec, group_key: JSON.parse(String(rows[0]!["group_key"])) };
    problemSeq = await seqOf(h, options.problem);
  }
  const sent = value(
    await h.command(COLLECTOR, {
      command: "RecordReport",
      input,
      compare: { active_release: null, problem_seq: problemSeq },
      idempotency_key: key("record"),
      prepared: [],
    } as never),
  );
  return {
    problem: (sent.result as { problem: string }).problem,
    report: spec.report.id,
  };
}

type Choice = "fixed" | "not_fixed" | "not_visible" | "dismiss";

// 사람이 결정 화면에서 본 내용 그대로 handle을 발급해 결정을 낸다.
async function decide(
  h: LedgerHarness,
  problem: string,
  choice: Choice,
  patch: { last_report?: string; note?: string } = {},
): Promise<void> {
  const decision = {
    choice,
    problem,
    basis_seq: await seqOf(h, problem),
    release: REL_AFTER,
    last_report: patch.last_report ?? null,
    note: patch.note ?? null,
  };
  const issued = value(
    await h.confirmation({
      action: "issue",
      request: {
        type: "confirmation_handle_register",
        window_id: "win-1",
        target_ref: choice,
        content_hash: await sha256Hex(canonicalize(decision)),
        allowed_decisions: ["ApplyProblemDecision"],
        expires_at: formatAt(NOW_MS + 600_000),
      },
    }),
  ) as { confirmation: string };
  value(
    await h.command(USER, {
      command: "ApplyProblemDecision",
      input: decision,
      compare: { problem_seq: decision.basis_seq, release: decision.release },
      idempotency_key: key("decide"),
      prepared: [],
      confirmation: issued.confirmation,
    } as never),
  );
}

type Detail = {
  progress: { state: string };
  closed: {
    reason: string;
    label: string;
    expanded: { evidence: { text: string; at: string | null }[] };
  } | null;
  decision: {
    offer_fixed: boolean;
    last: { kind: string; label: string; at: string } | null;
  };
};

async function detailOf(h: LedgerHarness, problem: string): Promise<Detail> {
  const read = value(
    await h.read({ resource: "problems", method: "get" }, USER, { problem }),
  ) as Record<string, unknown>;
  return read["detail"] as Detail;
}

Deno.test("problems/closing#R13 tests#R5: detail reads the four closures made by the real close and decision commands", async () => {
  const h = await open();
  try {
    await activate(h, REL_AFTER);
    // 테스트로 확인됨: reproduction pass 근거로 machine 판정기가 닫는다.
    const verified = await report(h);
    const basis = await seqOf(h, verified.problem);
    const vrf = "vrf_01arz3ndektsv4rrffq69g5fa9";
    await machine(h, "problems.testing.verify", {
      id: vrf,
      problem: verified.problem,
      basis_seq: basis,
      after_release: REL_AFTER,
    });
    await machine(h, "CloseProblemVerified", {
      problem: verified.problem,
      verification: vrf,
      problem_seq: basis,
      release: REL_AFTER,
    }, { problem_seq: basis, release: REL_AFTER });

    const confirmed = await report(h);
    await decide(h, confirmed.problem, "fixed");
    const quiet = await report(h);
    await decide(h, quiet.problem, "not_visible", {
      last_report: quiet.report,
    });
    const dismissed = await report(h);
    await decide(h, dismissed.problem, "dismiss", { note: "known outage" });

    const cases = [
      [verified.problem, "verified"],
      [confirmed.problem, "user_confirmed"],
      [quiet.problem, "recovered"],
      [dismissed.problem, "dismissed"],
    ] as const;
    const labels = new Set<string>();
    for (const [problem, reason] of cases) {
      const detail = await detailOf(h, problem);
      assertEquals(detail.progress.state, "closed");
      assertEquals(detail.closed?.reason, reason);
      labels.add(detail.closed!.label);
      // 닫힌 문제는 고쳐짐 확인을 제안하지 않는다.
      assertEquals(detail.decision, { offer_fixed: false, last: null });
      const evidence = detail.closed!.expanded.evidence;
      if (reason === "verified") {
        // 테스트 결과 port가 없으면 통과로 채우지 않는다.
        assertEquals(evidence[0]!.at, null);
        assert(evidence[0]!.text.includes("could not be read"));
      } else {
        // 사람 결정의 근거 시각은 실제 ProblemClosed의 시각이다.
        assertEquals(evidence[0]!.at, await closedAt(h, problem));
      }
      const text = JSON.stringify(detail);
      for (const hidden of ["rel_", "vrf_", "rpt_", "ApplyProblemDecision@"]) {
        assert(!text.includes(hidden), hidden);
      }
    }
    assertEquals(labels.size, 4);
    const reasonText = await detailOf(h, dismissed.problem);
    assertEquals(
      reasonText.closed!.expanded.evidence[0]!.text,
      "Your reason: known outage",
    );
  } finally {
    await h.close();
  }
});

Deno.test("problems/closing#R10 R11 grouping#R10: detail shows not_fixed and reopen and offers fixed again only on a new release or new evidence", async () => {
  const h = await open();
  try {
    // 활성 release를 모르면 fixed 결정을 낼 수 없으므로 제안하지 않는다.
    const { problem } = await report(h);
    assertEquals((await detailOf(h, problem)).decision, {
      offer_fixed: false,
      last: null,
    });
    await activate(h, REL_AFTER);
    assertEquals((await detailOf(h, problem)).decision.offer_fixed, true);

    // 열린 문제의 "아직입니다"는 열린 채로 보이고 같은 release로는 다시 제안하지 않는다.
    await decide(h, problem, "not_fixed");
    const still = await detailOf(h, problem);
    assertEquals(still.progress.state, "open");
    assertEquals(still.decision.offer_fixed, false);
    assertEquals(still.decision.last?.kind, "not_fixed");
    assertEquals(still.decision.last?.label, "You said this is not fixed yet.");
    // 활성 release가 바뀌면 다시 제안한다.
    await activate(h, REL_BEFORE);
    assertEquals((await detailOf(h, problem)).decision.offer_fixed, true);
    await activate(h, REL_AFTER);

    // 닫힌 문제의 "아직입니다"는 같은 ID로 다시 열리고 그 사실이 보인다.
    await decide(h, problem, "fixed");
    await decide(h, problem, "not_fixed");
    const reopened = await detailOf(h, problem);
    assertEquals(reopened.progress.state, "open");
    assertEquals(reopened.closed, null);
    assertEquals(reopened.decision.last?.kind, "reopened_by_you");
    assertEquals(reopened.decision.offer_fixed, false);

    // 지금 release의 새 보고가 닫힌 문제를 다시 열면 보고로 열렸다고 보인다.
    const other = await report(h);
    await decide(h, other.problem, "dismiss", { note: "flaky network" });
    await report(h, { problem: other.problem, observedAt: LATER });
    const byReport = await detailOf(h, other.problem);
    assertEquals(byReport.progress.state, "open");
    assertEquals(byReport.decision.last?.kind, "reopened_by_report");
    assert(typeof byReport.decision.last?.at === "string");
    // 새 보고는 "아직입니다"가 아니라서 고쳐짐 확인을 제안한다.
    assertEquals(byReport.decision.offer_fixed, true);
  } finally {
    await h.close();
  }
});
