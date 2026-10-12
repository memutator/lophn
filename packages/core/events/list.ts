import { err, ok, type Result } from "../../base/mod.ts";
import {
  EVENT_BATCH_LIMITS,
  type EventEnvelope,
  eventsList,
  type Input,
  type Output,
  type ReadDefinition,
  type ReadSnapshot,
  type RequestContext,
  type Subject,
} from "../../protocol/server/mod.ts";
import {
  currentEventContext,
  type EventReadGate,
  eventUnavailable,
  type EventVisibilityRegistry,
  exactResult,
  type SubjectScopeGate,
} from "./visibility.ts";
import { validateOutput } from "../storage/ledger/output.ts";

export type EventBatch = {
  events: EventEnvelope[];
  scanned_through_seq: string;
  head_seq: string;
};
export type EventScan = {
  position: string;
  inclusive: boolean;
  types?: readonly string[];
  subjects?: readonly Subject[];
  limit?: number;
};
export type EventReadDeps = {
  registry: EventVisibilityRegistry;
  current?: EventReadGate;
  subjects?: SubjectScopeGate;
};

export function frameBytes(batch: EventBatch): number {
  return new TextEncoder().encode(JSON.stringify({ type: "events", ...batch }))
    .length;
}

export function scanEvents(
  snapshot: ReadSnapshot,
  claimed: RequestContext,
  input: EventScan,
  deps: EventReadDeps,
): Result<EventBatch> {
  const current = currentEventContext(snapshot, claimed, deps.current);
  if (!current.ok) return current;
  const ctx = current.value;
  const types = input.types ?? [];
  const subjects = input.subjects ?? [];
  if (types.some((type) => !deps.registry.has(type))) {
    return err({
      code: "invalid_input",
      message: "등록되지 않은 event 필터다",
    });
  }
  try {
    if (subjects.length) {
      if (!deps.subjects) return eventUnavailable();
      const allowed = exactResult(deps.subjects(snapshot, ctx, subjects));
      if (!allowed.ok) return eventUnavailable();
      if (allowed.value === false) {
        return err({ code: "forbidden", message: "event 필터 범위가 아니다" });
      }
      if (allowed.value !== true) return eventUnavailable();
    }
    const previous = input.inclusive && BigInt(input.position) > 0n
      ? BigInt(input.position) - 1n
      : BigInt(input.position);
    const initial = previous > BigInt(snapshot.as_of_seq)
      ? snapshot.as_of_seq
      : previous.toString();
    const batch: EventBatch = {
      events: [],
      scanned_through_seq: initial,
      head_seq: snapshot.as_of_seq,
    };
    const rows = snapshot.sql.all(
      `select cast(seq as text) as seq, type, subject, actor, run, payload, at from events
       where seq ${input.inclusive ? ">=" : ">"} ? order by events.seq limit ?`,
      [
        BigInt(input.position),
        Math.min(
          input.limit ?? EVENT_BATCH_LIMITS.count,
          EVENT_BATCH_LIMITS.count,
        ),
      ],
    );
    for (const row of rows) {
      const raw = {
        ...row,
        payload: deps.registry.has(String(row.type))
          ? JSON.parse(String(row.payload))
          : {},
      };
      const ownerContext = currentEventContext(snapshot, claimed, deps.current);
      if (!ownerContext.ok) {
        return ownerContext;
      }
      const visible = deps.registry.visible(snapshot, ownerContext.value, raw);
      if (!visible.ok) {
        return visible;
      }
      const event = visible.value;
      const matches = event && (!types.length || types.includes(event.type)) &&
        (!subjects.length || subjects.includes(event.subject));
      const candidate: EventBatch = {
        ...batch,
        events: matches ? [...batch.events, event] : batch.events,
        scanned_through_seq: String(row.seq),
      };
      if (frameBytes(candidate) > EVENT_BATCH_LIMITS.bytes) {
        if (
          !batch.events.length && batch.scanned_through_seq === initial
        ) {
          return eventUnavailable();
        }
        break;
      }
      batch.events = candidate.events;
      batch.scanned_through_seq = candidate.scanned_through_seq;
    }
    return ok(batch);
  } catch (error) {
    if (error instanceof Promise) void error.catch(() => undefined);
    return eventUnavailable();
  }
}

export function createListEventsRead(
  deps: EventReadDeps,
): ReadDefinition<typeof eventsList> {
  return {
    route: eventsList,
    handle(
      snapshot,
      ctx,
      input: Input<typeof eventsList>,
    ): Result<Output<typeof eventsList>> {
      const scanned = scanEvents(snapshot, ctx, {
        position: input.after_seq,
        inclusive: false,
        types: input.types,
        subjects: input.subjects,
        limit: input.limit,
      }, deps);
      if (!scanned.ok) return scanned;
      return validateOutput(eventsList.output, {
        ...scanned.value,
        as_of_seq: snapshot.as_of_seq,
        next_cursor:
          BigInt(scanned.value.scanned_through_seq) < BigInt(snapshot.as_of_seq)
            ? scanned.value.scanned_through_seq
            : null,
      });
    },
  };
}
