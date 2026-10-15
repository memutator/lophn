import { DOMAIN_EVENTS } from "../../../protocol/events/mod.ts";

const DOMAIN_TYPES: ReadonlySet<string> = new Set(
  DOMAIN_EVENTS.map((event) => event.type),
);

// Ledger의 events 표에는 domain event 10개만 쓴다.
export function isDomainEvent(type: string): boolean {
  return DOMAIN_TYPES.has(type);
}
