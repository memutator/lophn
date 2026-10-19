import { err, ok, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import type { PortKey } from "../../../protocol/base/ports.ts";
import { CodingSessionLookup } from "../../../protocol/coding-agent/token.ts";
import type { RequestContext } from "../../../protocol/server/mod.ts";

export const forbidden = (message: string): Result<never> =>
  err({ code: "forbidden", message });
export const conflict = (message: string): Result<never> =>
  err({ code: "conflict", message });
export const invalid = (message: string): Result<never> =>
  err({ code: "invalid_input", message });
export const notFound = (message: string): Result<never> =>
  err({ code: "not_found", message });
const unavailable = (message: string): Result<never> =>
  err({ code: "unavailable", message });

// ticket을 만들고 고치고 확인하는 주체는 App Engineer(agent)다. 취소는 사람도 한다.
export function agentActor(actor: string): boolean {
  return parseActor(actor)?.kind === "agent";
}
export function cancelActorAllowed(actor: string): boolean {
  const kind = parseActor(actor)?.kind;
  return kind === "user" || kind === "agent";
}

export function codingSessionOf(actor: string): string | undefined {
  const parts = parseActor(actor);
  return parts?.kind === "coding_agent" ? parts.id : undefined;
}

type PortOf = <T>(key: PortKey<T>) => T;

// 호출자가 묶인 앱. coding session은 token의 앱 하나(CodingSessionLookup), App Engineer는
// 자격 조건의 앱이다. 묶이지 않은 호출자(사람, machine)는 null이다.
export function boundApp(
  port: PortOf,
  ctx: Pick<RequestContext, "actor" | "conditions">,
): Result<string | null> {
  const session = codingSessionOf(ctx.actor);
  if (session !== undefined) {
    let app: string | null;
    try {
      app = port(CodingSessionLookup).appOf(session);
    } catch {
      return unavailable("coding session lookup is not available");
    }
    return app === null ? forbidden("unknown coding session") : ok(app);
  }
  if (parseActor(ctx.actor)?.kind === "agent") {
    return ok(ctx.conditions.app ?? null);
  }
  return ok(null);
}

// token은 앱 하나만 연다. 묶인 앱이 아니면 forbidden이다.
export function checkApp(
  port: PortOf,
  ctx: Pick<RequestContext, "actor" | "conditions">,
  app: string,
): Result<void> {
  const bound = boundApp(port, ctx);
  if (!bound.ok) return bound;
  return bound.value === null || bound.value === app
    ? ok(undefined)
    : forbidden("ticket belongs to another app");
}

// revision은 ticket마다 1에서 시작해 바뀔 때마다 하나 오른다. claim_seq는 claim 때의 revision이다.
export const nextRevision = (current: string): string =>
  (BigInt(current) + 1n).toString(10);

export function revisionAgrees(
  stored: string,
  base: string,
  compare: string,
): boolean {
  return stored === base && base === compare;
}

// release 역조회. releases.ticket_source는 claim 출처의 사본이 아니라 원 seq다.
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
