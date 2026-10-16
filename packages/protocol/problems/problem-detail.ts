import { z } from "zod";
import type { Result } from "../../base/mod.ts";
import { atSchema } from "../base/values.ts";
import type { Sql } from "../server/registration.ts";
import { definePort, type PortKey } from "../base/ports.ts";
import { closureReasonSchema } from "./closing.ts";
import { testKindSchema } from "./tests.ts";

// 사용자용 문제 상세. `GetProblem`의 `problem` field는
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
// 기록으로 남긴 한 건. not_run은 준비 실패·미실행이고 통과가 아니다.
export const RECORDED_TEST_STATES = [...TEST_STATES, "not_run"] as const;
export const recordedTestStateSchema = z.enum(RECORDED_TEST_STATES);
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
    // 종류마다 지금 값과 따로, 이 문제에 남은 실제 결과와 미실행이다.
    // 이전 응답에는 없다.
    recorded: z.array(z.object({
      kind: testKindSchema,
      state: recordedTestStateSchema,
      label: text,
      ended_at: atSchema.nullable(),
    })).optional(),
    // 고친 release가 운영에 적용되지 않아 문제가 열린 채 남는 한 문장이다.
    remaining: text.optional(),
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
  // 사람 결정의 뒤. 열린 문제에서 마지막 "아직입니다"·
  // 다시 열림을 사람이 아는 en으로 보이고, 결정 window가 "고쳐졌다"를 다시 제안할지 읽는다.
  // 같은 release·같은 근거로 "아직입니다" 뒤에는 제안하지 않고, 활성 release를 모르면 제안하지
  // 않는다. 닫힌 문제는 늘 false·null이다. 이전 소비자 fixture를 깨지 않도록 optional이다.
  decision: z.object({
    offer_fixed: z.boolean(),
    last: z.object({
      kind: z.enum(["not_fixed", "reopened_by_report", "reopened_by_you"]),
      label: text,
      at: atSchema,
    }).nullable(),
  }).optional(),
}).refine(
  (value) => (value.progress.state === "closed") === (value.closed !== null),
  { message: "closed detail follows progress" },
);
export type ProblemDetail = z.infer<typeof problemDetailSchema>;

// coding-agent ticket의 상태와 준비 상태에서 읽은 사실이다. claim 상세는 싣지 않는다.
// contracts 최상위 사이 순환을 피하려고 coding-agent의 값 집합을 이름으로 따로 적는다
// (coding-agent/ticket/values.ts의 TICKET_STATES와 같다. problems grouping detail_test가 대조한다).
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
