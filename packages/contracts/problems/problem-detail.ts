import { z } from "zod";
import type { Result } from "../../base/mod.ts";
import { atSchema } from "../platform/values.ts";
import type { Sql } from "../platform/mod.ts";
import { definePort, type PortKey } from "../platform/ports.ts";
import { closureReasonSchema } from "./closing.ts";
import { testKindSchema } from "./tests.ts";

// 사용자용 문제 상세(grouping#R12, closing#R13, tests#R5). `GetProblem`의 `problem` field는
// 내부 contract(ticket·version ID)이고, 사람에게 보이는 것은 이 `detail`뿐이다. 이 안에는
// claim·기한·연결 식별자·ticket·version·verification ID가 없다. 문구는 사람이 아는 en이다.
const text = z.string().regex(/\S/);

// 수리 작업의 사람이 아는 상태. none은 지금 수리 작업이 없음, unknown은 읽지 못함이다.
export const WORK_STATES = [
  "needs_confirmation",
  "ready_to_hand_off",
  "in_progress",
  "checking",
] as const;
export const workStateSchema = z.enum(WORK_STATES);
export type WorkState = z.infer<typeof workStateSchema>;
export const repairStateSchema = z.enum([...WORK_STATES, "none", "unknown"]);
export type RepairState = z.infer<typeof repairStateSchema>;

// 테스트 한 건의 지금 상태다. unconfirmed는 끝났지만 확인하지 못한 결과(inconclusive)다.
export const TEST_STATES = [
  "pending",
  "running",
  "pass",
  "fail",
  "unconfirmed",
] as const;
export const testStateSchema = z.enum(TEST_STATES);
export type TestState = z.infer<typeof testStateSchema>;
// 전체 요약은 한 건도 안 돌았음(not_run)과 읽지 못함(unknown)을 성공으로 채우지 않는다.
export const testSummaryStateSchema = z.enum([
  ...TEST_STATES,
  "not_run",
  "unknown",
]);
export type TestSummaryState = z.infer<typeof testSummaryStateSchema>;

export const problemDetailSchema = z.object({
  // 기본 먼저: 진행, 실제 담당, 지금 필요한 사람 조치.
  progress: z.object({
    state: z.enum(["open", "fixing", "closed"]),
    label: text,
  }),
  owner: z.object({
    kind: z.enum(["nobody", "coding_agent", "platform_check", "unknown"]),
    label: text,
  }),
  needed_action: text.nullable(),
  repair: z.object({
    state: repairStateSchema,
    label: text,
    needs: z.array(text),
    last_check_failed: z.boolean(),
  }),
  // 같은 문제 옆에서 고쳤다는 주장과 테스트 결과를 따로 보인다.
  result: z.object({
    fix_report: z.enum(["none", "reported"]),
    fix_report_label: text,
    tests: z.object({
      state: testSummaryStateSchema,
      label: text,
      items: z.array(z.object({
        kind: testKindSchema,
        state: testStateSchema,
        label: text,
        ended_at: atSchema.nullable(),
      })),
    }),
  }),
  closed: z.object({
    // 기본: 닫힌 이유와 지금 필요한 주의.
    reason: closureReasonSchema,
    label: text,
    attention: text,
    // 펼친 상세: 확인 범위·미확인 부분·release·근거.
    expanded: z.object({
      scope: text,
      unconfirmed: z.array(text).min(1),
      release: text.nullable(),
      evidence: z.array(z.object({ text, at: atSchema.nullable() })).min(1),
    }),
  }).nullable(),
}).refine(
  (value) => (value.progress.state === "closed") === (value.closed !== null),
  { message: "closed detail follows progress" },
);
export type ProblemDetail = z.infer<typeof problemDetailSchema>;

// coding-agent getTicket(state, readiness, needs)에서 읽은 사실이다. claim 상세는 싣지 않는다.
// contracts 최상위 사이 순환을 피하려고 coding-agent의 값 집합을 이름으로 따로 적는다
// (ticket-values의 TICKET_STATES·TICKET_READINESS와 같다. problems grouping detail_test가 대조한다).
export type RepairTicketFact = {
  state:
    | "open"
    | "claimed"
    | "reported"
    | "confirmed"
    | "check_failed"
    | "cancelled";
  readiness: "needs_confirmation" | "ready";
  needs: string[];
};

// 문제의 지금 수리 ticket이다(없으면 null). 구현은 coding-agent가 내놓고 core 조립이 reader
// port로 등록한다. 등록되지 않았거나 읽지 못하면 read는 담당을 모름으로 보인다.
export type ProblemWorkLookup = (
  sql: Pick<Sql, "get" | "all">,
  problem: string,
  work: string | null,
) => Result<RepairTicketFact | null>;
export const ProblemWorkPort: PortKey<ProblemWorkLookup> = definePort<
  ProblemWorkLookup
>("problems.ProblemWork");

export type ProblemTestFact = {
  kind: z.infer<typeof testKindSchema>;
  state: TestState;
  ended_at: string | null;
};
// 문제에 걸린 테스트 요청·결과다. 등록되지 않았거나 읽지 못하면 read는 모름으로 보인다.
export type ProblemTestLookup = (
  sql: Pick<Sql, "get" | "all">,
  problem: string,
) => Result<ProblemTestFact[]>;
export const ProblemTestPort: PortKey<ProblemTestLookup> = definePort<
  ProblemTestLookup
>("problems.ProblemTests");
