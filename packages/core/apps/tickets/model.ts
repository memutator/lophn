import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import {
  type AcceptanceCheck,
  acceptanceCheckInputSchema,
  type TicketKind,
  type TicketReadiness,
} from "../../../protocol/coding-agent/mod.ts";
import type { RequestContext } from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";

// ticket.create actor는 user·lophn·담당 App Engineer agent다. coding_agent·
// app·machine은 생성하지 않는다(R5).
export function createActorAllowed(actor: string): boolean {
  const parts = parseActor(actor);
  if (!parts) return false;
  return parts.kind === "user" || parts.kind === "agent";
}

// command의 앱 조건 검사다. 자격이 앱 하나에 묶여 있으면(담당 App Engineer agent) 그 앱 밖
// ticket은 없는 ticket과 같은 답이다. read는 같은 조건을 platform의 TargetAuthorization
// (reads.ts의 inCodingScope)로 판정하고, command에는 그 port가 없어 이 검사를 쓴다.
export function outsideAppCondition(
  ctx: RequestContext,
  app: string,
): boolean {
  const bound = ctx.conditions.app;
  return bound !== undefined && bound !== app;
}

// readiness는 needs의 유무와 짝이다. needs_confirmation은 필요한 확인 1개 이상,
// ready는 needs가 비어 있다(Q11).
export function readinessOf(
  readiness: TicketReadiness,
  needs: readonly string[],
): Result<TicketReadiness> {
  if (readiness === "needs_confirmation" && needs.length === 0) {
    return err({
      code: "invalid_input",
      message: "needs_confirmation needs at least one entry",
    });
  }
  if (readiness === "ready" && needs.length !== 0) {
    return err({
      code: "invalid_input",
      message: "ready ticket has no needs",
    });
  }
  return ok(readiness);
}

// R3: ready 근거의 고정 판과 그 판을 채택한 질문 답의 adoption이 같은
// document·version이어야 한다. adoption이 없는 답으로는 ready가 되지 않는다.
export function adoptionMatches(
  references: readonly { kind: string; target: string }[],
  adopted: ReadonlyMap<string, { document: string; version: string }>,
): Result<void> {
  // 맵은 질문 id가 키이고 값이 그 답의 adoption이다. 참조 target(고정 판)과
  // 같은 version을 채택한 답이 하나는 있어야 한다.
  for (const reference of references) {
    if (reference.kind !== "version") continue;
    const match = [...adopted.values()].some((adoption) =>
      adoption.document !== "" && adoption.version === reference.target
    );
    if (!match) {
      return err({
        code: "invalid_input",
        message: "no answered question adopts this fixed version",
      });
    }
  }
  return ok(undefined);
}

// R7: 조건 kind는 여섯 가지뿐이다. 자유 산문은 입력 schema가 거절하고,
// human_confirmation은 어느 문제의 reproduction을 대신하는지 problem을 갖는다(Q18).
export const HUMAN_CONFIRMATION_KIND = "human_confirmation";

// R8: 구현 ready는 app_test와 실행 가능한 test_command를 각각 하나 이상 요구한다.
// R9: 수리 ready는 app_test, 대상 문제 각각의 reproduction_test 또는
// human_confirmation, problems_closed를 요구한다.
export function readyKindsComplete(
  kind: TicketKind,
  problems: readonly string[],
  conditions: readonly AcceptanceCheck[],
): Result<void> {
  const kinds = conditions.map((condition) => condition.kind);
  if (!kinds.includes("app_test")) {
    return err({ code: "invalid_input", message: "app_test is required" });
  }
  if (!kinds.includes("test_command")) {
    return err({
      code: "invalid_input",
      message: "test_command is required",
    });
  }
  if (kind === "implementation") return ok(undefined);
  if (!kinds.includes("problems_closed")) {
    return err({
      code: "invalid_input",
      message: "problems_closed is required",
    });
  }
  for (const problem of problems) {
    const covered = conditions.some((condition) =>
      condition.kind === "reproduction_test" && condition.problem === problem
    ) ||
      conditions.some(
        (condition) =>
          condition.kind === HUMAN_CONFIRMATION_KIND &&
          condition.problem === problem,
      );
    if (!covered) {
      return err({
        code: "invalid_input",
        message: "each problem needs reproduction_test or human_confirmation",
      });
    }
  }
  return ok(undefined);
}

// human_confirmation은 그 문제의 reproduction_test가 함께 없을 때만 유효하다.
// 둘 다 있으면 사람 확인이 test를 대신하지 않는다(R7).
export function humanConfirmationCoupled(
  conditions: readonly AcceptanceCheck[],
): Result<void> {
  const problems = new Set(
    conditions.flatMap((condition) =>
      condition.kind === HUMAN_CONFIRMATION_KIND ? [condition.problem] : []
    ),
  );
  for (const problem of problems) {
    const reproduces = conditions.some(
      (condition) =>
        condition.kind === "reproduction_test" && condition.problem === problem,
    );
    if (reproduces) {
      return err({
        code: "invalid_input",
        message: "human_confirmation replaces a missing reproduction_test",
      });
    }
  }
  return ok(undefined);
}

// 조건 입력은 저장 전에 contract input schema로 다시 검사한다. create input은
// renewal에도 불변으로 남으므로 kind별 입력 shape만 다시 본다.
export function conditionInputsValid(
  conditions: readonly { kind: string }[],
): Result<AcceptanceCheck[]> {
  const parsed: AcceptanceCheck[] = [];
  for (const condition of conditions) {
    const result = acceptanceCheckInputSchema.safeParse(condition);
    if (!result.success) {
      return err({ code: "invalid_input", message: "condition input" });
    }
    parsed.push(result.data);
  }
  return ok(parsed);
}

// 같은 조건 입력은 한 번만 둔다. 중복 조건은 check 결과를 모호하게 한다.
export function uniqueConditions(
  conditions: readonly AcceptanceCheck[],
): Result<void> {
  const seen = new Set(conditions.map((condition) => canonicalize(condition)));
  if (seen.size !== conditions.length) {
    return err({ code: "invalid_input", message: "duplicate condition" });
  }
  return ok(undefined);
}

// inspect·preserve는 볼 곳·지킬 것일 뿐 권한이 아니다. R25의 권한 해석 금지는
// 여기 남긴다: 이 값으로 scope를 넓히는 path는 없다.
export function wantsNoGrant(
  input: { inspect: readonly string[]; preserve: readonly string[] },
): Result<void> {
  if (input.inspect.includes("") || input.preserve.includes("")) {
    return err({ code: "invalid_input", message: "blank entry" });
  }
  return ok(undefined);
}

// ticket.cancel actor는 user라면 종료 전 어느 상태나 된다(R22). machine은 App
// Engineer 생성의 revert 적용 분이라 외부 claim·보고·결과가 한 번도 없을 때만
// 허용한다(R22). machine의 이력 검사는 handler가 현재 표로 본다.
export function cancelActorAllowed(actor: string): boolean {
  const parts = parseActor(actor);
  if (!parts) return false;
  return parts.kind === "user" || parts.kind === "machine";
}

// R15 release 역조회. releases.ticket_source는 claim 출처의 사본이 아니라 원 seq다.
// 같은 앱이면서 이 ticket·이 claim seq로 준비된 release만 완료 보고가 받는다.
export function releaseSourceMatches(
  source: { ticket: string; claim_seq: string } | null,
  app: string,
  ticketApp: string,
  ticket: string,
  claimSeq: string,
): boolean {
  return app === ticketApp && source !== null &&
    source.ticket === ticket && source.claim_seq === claimSeq;
}

// JSON 열의 ticket_source. null이거나 모양이 다르면 출처 없는 과거 release다.
export function parseTicketSource(
  raw: string | null,
): { ticket: string; claim_seq: string } | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const ticket = record["ticket"];
  const claimSeq = record["claim_seq"];
  if (
    typeof ticket !== "string" || typeof claimSeq !== "string" ||
    ticket === "" || claimSeq === "" || claimSeq === "0"
  ) {
    return null;
  }
  return { ticket, claim_seq: claimSeq };
}
