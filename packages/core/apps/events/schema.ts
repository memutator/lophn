import type { SchemaStep } from "../../../protocol/server/mod.ts";

// 발행 기록. 누가 어느 event를 언제 냈고 켜져 있던 구독자(reachable), 닿지 못한 구독자(unreachable), 고리·깊이 한도로 넘기지 않은 구독자(refused)가 몇이었는지다.
// payload 본문은 남기지 않는다. publisher는 앱 id이거나 core가 내는 event의 `lophn`이라 FK를 두지 않는다.
// 낸 때 step 목록의 끝에 붙어야 해서(schema-steps.lock.json) WIRINGS 맨 뒤 wiring(domains-retire)의 schemaStepsAfterTeams에서 잇는다.
export const eventPublicationSchemaSteps: readonly SchemaStep[] = [
  {
    id: "apps.events.publications",
    sql: `
    CREATE TABLE app_event_publications (
      id TEXT PRIMARY KEY NOT NULL,
      publisher TEXT NOT NULL,
      release TEXT,
      event TEXT NOT NULL,
      trace_id TEXT NOT NULL CHECK (length(trace_id) = 32),
      at TEXT NOT NULL,
      reachable INTEGER NOT NULL CHECK (reachable >= 0),
      unreachable INTEGER NOT NULL CHECK (unreachable >= 0),
      refused INTEGER NOT NULL CHECK (refused >= 0 AND refused <= reachable)
    ) STRICT;
    CREATE INDEX app_event_publications_publisher_id ON app_event_publications (publisher, id);
  `,
  },
];
