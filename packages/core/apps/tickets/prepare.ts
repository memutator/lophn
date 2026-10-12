// 사람 화면 repair 준비(coding-agent/tickets#R24, R26).
// 열린 문제 하나의 제목·무엇과 왜·고정 근거·acceptance check를 이미 있는
// 증상·snapshot·채택 자료로만 만든다. ticket.create schema를 그대로 통과해야
// 하고, 없는 reproduction 기준·채택 답은 만들지 않는다. 화면 ticket은
// needs_confirmation이다. priority·requested는 읽지 않는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type RepairPrepareOutcome,
  repairPrepareOutcomeSchema,
  sourceRelativePathSchema,
  ticketCreateInputSchema,
  ticketReferenceInputSchema,
} from "../../../protocol/coding-agent/mod.ts";
import { idSchema, sha256Schema } from "../../../protocol/base/mod.ts";

export const REPAIR_PREPARE_SOURCE = {
  name: "coding-agent.tickets.RepairPrepareSource",
} as const;

export type RepairPrepareVersion = {
  target: string;
  address: {
    place: string;
    document: string;
    section: string | null;
    version: number | null;
  };
  section: string | null;
  adopted_questions: readonly string[];
};

export type RepairPrepareFacts = {
  problem: {
    id: string;
    app: string;
    status: "open" | "fixing" | "closed";
  } | null;
  symptom: string | null;
  snapshot: string | null;
  version: RepairPrepareVersion | null;
  // null이면 reproduction test를 만들 수 없다. hash를 새로 만들지 않는다.
  reproduction_test_hash: string | null;
  app_engineer: { assignment: string } | null;
  inspect: readonly string[];
};

export type RepairPrepareSource = {
  facts(problem: string): Result<RepairPrepareFacts>;
};

export type RepairPrepareRequest = {
  request: "repair" | "implementation";
  priority?: string | null;
  requested?: boolean;
};

const NEED_CONFIRM = "App Engineer confirms the prepared repair";
const NEED_SYMPTOM = "symptom is missing";
const NEED_VERSION = "fixed version is missing";
const NEED_ADOPTION = "adopted answer is missing";
const NEED_REPRODUCTION = "reproduction test cannot be built";

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

function prose(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!/\S/.test(trimmed)) return null;
  return [...trimmed].slice(0, 2000).join("").trim();
}

function titleOf(value: string): string {
  const line = value.replace(/[\r\n]+/g, " ").replace(/[ \t]+/g, " ").trim();
  return [...line].slice(0, 120).join("").trim();
}

function questionsOf(ids: readonly string[]): string[] {
  const kept: string[] = [];
  for (const id of ids) {
    if (kept.length === 20 || kept.includes(id)) continue;
    if (idSchema("qst").safeParse(id).success) kept.push(id);
  }
  return kept;
}

function inspectOf(paths: readonly string[]): string[] {
  const kept: string[] = [];
  for (const path of paths) {
    if (kept.length === 20 || kept.includes(path)) continue;
    if (sourceRelativePathSchema.safeParse(path).success) kept.push(path);
  }
  return kept;
}

function versionReference(version: RepairPrepareVersion | null) {
  if (version === null || version.address.version === null) return null;
  const reference = {
    kind: "version" as const,
    target: version.target,
    address: version.address,
    section: version.section,
  };
  const parsed = ticketReferenceInputSchema.safeParse(reference);
  return parsed.success ? parsed.data : null;
}

function engineerOf(link: { assignment: string } | null) {
  if (link === null || !idSchema("asg").safeParse(link.assignment).success) {
    return null;
  }
  return { assignment: link.assignment, role: "app_engineer" as const };
}

export function prepareRepairTicket(
  facts: RepairPrepareFacts,
  request: RepairPrepareRequest,
): Result<RepairPrepareOutcome> {
  // 요청 표시는 준비 값에 들어가지 않는다(R24).
  void request.priority;
  void request.requested;
  const problem = facts.problem;
  if (problem === null) {
    return err({ code: "not_found", message: "problem not found" });
  }
  if (
    !idSchema("prb").safeParse(problem.id).success ||
    !idSchema("app").safeParse(problem.app).success
  ) {
    return invalid("problem id");
  }
  const engineer = engineerOf(facts.app_engineer);
  if (request.request === "implementation") {
    return parsed({
      kind: "conversation",
      app: problem.app,
      app_engineer: engineer,
      reason: "implementation_request",
      started: false,
      approval: null,
    });
  }
  // 생성과 같은 문제 검사다. 닫힌 문제·이미 열린 수리는 우회하지 않는다.
  if (problem.status === "closed") {
    return invalid("closed problem cannot be repaired");
  }
  if (problem.status !== "open") {
    return err({
      code: "conflict",
      message: "an open repair ticket already reserves this problem",
    });
  }
  const symptom = prose(facts.symptom);
  const observed = prose(facts.snapshot);
  const what = symptom ?? observed ?? problem.id;
  const why = observed ?? symptom ?? problem.id;
  const title = titleOf(symptom ?? observed ?? "") || problem.id;
  const version = versionReference(facts.version);
  const adopted = version === null
    ? []
    : questionsOf(facts.version?.adopted_questions ?? []);
  const hash = sha256Schema.safeParse(facts.reproduction_test_hash);
  const canReproduce = hash.success;
  const gaps: string[] = [];
  if (symptom === null && observed === null) gaps.push(NEED_SYMPTOM);
  if (version === null) gaps.push(NEED_VERSION);
  if (adopted.length === 0) gaps.push(NEED_ADOPTION);
  if (!canReproduce) gaps.push(NEED_REPRODUCTION);
  const needs = gaps.length === 0 ? [NEED_CONFIRM] : gaps;
  const conditions = canReproduce
    ? [
      { kind: "app_test" as const },
      {
        kind: "reproduction_test" as const,
        problem: problem.id,
        test_hash: hash.data,
      },
      { kind: "problems_closed" as const },
    ]
    : [{ kind: "human_confirmation" as const, problem: problem.id }];
  const references = [
    ...(version === null ? [] : [version]),
    {
      kind: "problem" as const,
      target: problem.id,
      address: null,
      section: null,
    },
  ];
  const basisMissing = gaps.some((gap) => gap !== NEED_REPRODUCTION);
  const create = ticketCreateInputSchema.safeParse({
    app: problem.app,
    kind: "repair",
    title,
    what,
    why,
    references,
    adoption_questions: adopted,
    conditions,
    inspect: inspectOf(facts.inspect),
    preserve: [],
    problems: [problem.id],
    readiness: "needs_confirmation",
    needs,
  });
  if (!create.success) {
    return invalid("repair prepare did not pass create checks");
  }
  return parsed({
    kind: "ticket",
    create: create.data,
    app_engineer: basisMissing ? engineer : null,
    started: false,
    approval: null,
  });
}

function parsed(outcome: RepairPrepareOutcome): Result<RepairPrepareOutcome> {
  const checked = repairPrepareOutcomeSchema.safeParse(outcome);
  if (!checked.success) {
    return invalid("repair prepare did not pass create checks");
  }
  return ok(checked.data);
}
