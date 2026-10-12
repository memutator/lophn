import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  authenticatedContextSchema,
  type EventVisibilityDefinition,
  type ReadSnapshot,
  type RequestContext,
} from "../../protocol/server/mod.ts";
import { errorBodySchema, idSchema } from "../../protocol/base/mod.ts";
import {
  type EventDefinition,
  type EventEnvelope,
  eventEnvelopeSchema,
  type Subject,
} from "../../protocol/events/mod.ts";
import { validateOutput } from "../storage/ledger/output.ts";

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

function observe(value: unknown): void {
  try {
    void Promise.resolve(value).then(() => undefined, () => undefined);
  } catch {
    // 잘못된 then inspection도 hook 성공으로 바꾸지 않는다.
  }
}

// hook 결과 inspection도 경계 안에서 거절한다. getter·extra field로 검사를 바꾸지 못한다.
export function exactResult(value: unknown): Result<unknown> {
  try {
    if (value instanceof Promise || (value && "then" in Object(value))) {
      observe(value);
      return eventUnavailable();
    }
    if (!value || typeof value !== "object") return eventUnavailable();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return eventUnavailable();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some((key) =>
        typeof key !== "string" || !descriptors[key].enumerable ||
        !("value" in descriptors[key])
      )
    ) return eventUnavailable();
    const shape = (keys as string[]).sort().join(",");
    if (shape === "ok,value" && descriptors.ok.value === true) {
      return ok(descriptors.value.value);
    }
    if (shape === "error,ok" && descriptors.ok.value === false) {
      const parsed = validateOutput(errorBodySchema, {
        error: descriptors.error.value,
      });
      if (parsed.ok) return err(parsed.value.error);
    }
  } catch (thrown) {
    observe(thrown);
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

// 팀 등록 파일이 싣는 event 정의와 공개 정책. 정책이 가리키는 event는 따로 적지 않아도 등록된다.
// 정책이 없는 event는 등록돼도 숨김이다(fail-closed).
export type EventRegistration = {
  events?: readonly EventDefinition[];
  visibility?: readonly EventVisibilityDefinition[];
};

// 여러 팀 등록을 한 registry로 모은다. 같은 type에 서로 다른 정의나 정책이 둘이면 거절한다.
// 같은 정의 객체를 둘 이상의 등록이 싣는 것은 한 번으로 센다.
export function collectEventRegistrations(
  parts: readonly (EventRegistration | undefined)[],
): Result<EventVisibilityRegistry> {
  const events: EventDefinition[] = [];
  const policies: EventVisibilityDefinition[] = [];
  const add = (event: EventDefinition) => {
    if (!events.includes(event)) events.push(event);
  };
  for (const part of parts) {
    for (const event of part?.events ?? []) add(event);
    for (const policy of part?.visibility ?? []) {
      add(policy.event);
      policies.push(policy);
    }
  }
  return createEventVisibilityRegistry(events, policies);
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
