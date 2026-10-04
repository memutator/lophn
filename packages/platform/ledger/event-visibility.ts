import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  authenticatedContextSchema,
  errorBodySchema,
  type EventDefinition,
  type EventEnvelope,
  eventEnvelopeSchema,
  type EventVisibilityDefinition,
  idSchema,
  type ReadSnapshot,
  type RequestContext,
  type Subject,
} from "../../contracts/platform/mod.ts";
import { validateOutput } from "./output.ts";

export type EventReadGate = (
  snapshot: ReadSnapshot,
  credentialRef: string,
) => Result<RequestContext>;
export type SubjectScopeGate = (
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  subjects: readonly Subject[],
) => Result<boolean>;
export type EventVisibilityRegistry = {
  has(type: string): boolean;
  visible(
    snapshot: ReadSnapshot,
    ctx: RequestContext,
    raw: unknown,
  ): Result<EventEnvelope | null>;
};

export const eventUnavailable = () =>
  err({
    code: "unavailable" as const,
    message: "event 조회를 사용할 수 없다",
  });

// unknown hook 결과는 omission으로 바꾸지 않는다. extra field도 허용하지 않는다.
export function exactResult(value: unknown): Result<unknown> {
  if (value instanceof Promise) void value.catch(() => undefined);
  if (
    !value || typeof value !== "object" || "then" in value ||
    Object.getOwnPropertySymbols(value).length ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) return eventUnavailable();
  const keys = Object.keys(value).sort().join(",");
  const result = value as Record<string, unknown>;
  if (result.ok === true && keys === "ok,value") return ok(result.value);
  if (result.ok === false && keys === "error,ok") {
    const parsed = validateOutput(errorBodySchema, { error: result.error });
    if (parsed.ok) return err(parsed.value.error);
  }
  return eventUnavailable();
}

export function currentEventContext(
  snapshot: ReadSnapshot,
  claimed: RequestContext,
  gate?: EventReadGate,
): Result<RequestContext> {
  if (!gate) return eventUnavailable();
  try {
    const result = exactResult(gate(snapshot, claimed.credential_ref));
    if (!result.ok) return eventUnavailable();
    const parsed = validateOutput(
      authenticatedContextSchema.extend({ run: idSchema("run").optional() }),
      result.value,
    );
    if (
      !parsed.ok || parsed.value.credential_ref !== claimed.credential_ref ||
      parsed.value.principal !== claimed.principal ||
      parsed.value.actor !== claimed.actor
    ) {
      return eventUnavailable();
    }
    return ok(parsed.value);
  } catch (error) {
    if (error instanceof Promise) void error.catch(() => undefined);
    return eventUnavailable();
  }
}

export function createEventVisibilityRegistry(
  events: readonly EventDefinition[],
  policies: readonly EventVisibilityDefinition[],
): Result<EventVisibilityRegistry> {
  const registered = new Map<string, EventDefinition>();
  const owners = new Map<string, EventVisibilityDefinition>();
  for (const event of events) {
    if (registered.has(event.type)) return eventUnavailable();
    registered.set(event.type, event);
  }
  for (const policy of policies) {
    if (owners.has(policy.event.type)) return eventUnavailable();
    owners.set(policy.event.type, policy);
  }
  return ok({
    has: (type) => registered.has(type) && owners.has(type),
    visible(snapshot, ctx, raw) {
      try {
        const safe = validateOutput(z.json(), raw);
        if (
          !safe.ok || !safe.value || typeof safe.value !== "object" ||
          Array.isArray(safe.value)
        ) {
          return eventUnavailable();
        }
        const type = safe.value.type;
        if (typeof type !== "string") return eventUnavailable();
        const definition = registered.get(type);
        const owner = owners.get(type);
        if (!definition || !owner) return ok(null);
        const envelope = validateOutput(eventEnvelopeSchema(definition), raw);
        if (!envelope.ok) return eventUnavailable();
        // 정책의 선언도 등록 schema와 맞아야 한다. owner가 다른 shape를 믿게 하지 않는다.
        const ownerEnvelope = validateOutput(
          eventEnvelopeSchema(owner.event),
          envelope.value,
        );
        if (!ownerEnvelope.ok) return eventUnavailable();
        const result = exactResult(
          owner.handle(snapshot, ctx, ownerEnvelope.value),
        );
        if (!result.ok) {
          return result.error.code === "not_found" ||
              result.error.code === "forbidden"
            ? ok(null)
            : eventUnavailable();
        }
        if (typeof result.value !== "boolean") return eventUnavailable();
        return ok(result.value ? envelope.value as EventEnvelope : null);
      } catch (error) {
        if (error instanceof Promise) void error.catch(() => undefined);
        return eventUnavailable();
      }
    },
  });
}
