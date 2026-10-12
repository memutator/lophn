// lophn-agent/agents#R16: core가 agents에 내는 "이 자리의 agent가 읽을 active context" 조회다. project 자리는
// 그 project의 active context 전부이고, App Engineer가 앱 자리에 있으면 그 앱을 app-data source로 읽는
// active context 전부다(runtime의 agent-layers와 같은 규칙). 그 밖의 앱 자리는 없다. 실제 sqlite(메모리)에
// context 표와 context_app_data·apps 표만 만들어 조회를 직접 부른다.
import { DatabaseSync } from "node:sqlite";
import { assertEquals } from "@std/assert";
import { agentLookups } from "./lophn-agent.ts";

const P1 = "prj_01arz3ndektsv4rrffq69g5fa1";
const P2 = "prj_01arz3ndektsv4rrffq69g5fa9";
const NOTES = "app_01arz3ndektsv4rrffq69g5fa2";
const OTHER = "app_01arz3ndektsv4rrffq69g5fa3";
const ctx = (n: number) => `ctx_01arz3ndektsv4rrffq69g5fb${n}`;

function lookups() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table contexts (id text primary key, project text not null, status text not null);
    create table context_app_data (context text not null, app text not null);
    create table apps (id text primary key, slug text not null);
    insert into apps values ('${NOTES}', 'notes'), ('${OTHER}', 'other');
    insert into contexts values
      ('${ctx(1)}', '${P1}', 'active'),
      ('${ctx(2)}', '${P2}', 'active'),
      ('${ctx(3)}', '${P1}', 'archived'),
      ('${ctx(4)}', '${P1}', 'drafting'),
      ('${ctx(5)}', '${P1}', 'active'),
      ('${ctx(6)}', '${P1}', 'active');
    insert into context_app_data values
      ('${ctx(1)}', 'notes'),
      ('${ctx(2)}', 'notes'),
      ('${ctx(3)}', 'notes'),
      ('${ctx(4)}', 'notes'),
      ('${ctx(5)}', 'other'),
      ('${ctx(2)}', 'other');
  `);
  const sql = {
    get: (query: string, params: readonly unknown[] = []) =>
      db.prepare(query).get(...(params as never[])) as
        | Record<string, unknown>
        | undefined,
    all: (query: string, params: readonly unknown[] = []) =>
      db.prepare(query).all(...(params as never[])) as Record<
        string,
        unknown
      >[],
  };
  return { db, lookups: agentLookups(sql) };
}

Deno.test("lophn-agent/agents#R16 [agent-I54]: App Engineer in an app gets the active contexts that read the app, across projects, without archived or drafting ones", () => {
  const { db, lookups: found } = lookups();
  try {
    const place = { kind: "app", id: NOTES } as const;
    assertEquals(found.activeContexts(place, "app_engineer"), [
      ctx(1),
      ctx(2),
    ]);
    assertEquals(
      found.activeContexts({ kind: "app", id: OTHER }, "app_engineer"),
      [ctx(2), ctx(5)],
    );
  } finally {
    db.close();
  }
});

Deno.test("lophn-agent/agents#R16 [agent-I54]: lophn and an Operator in an app get no contexts, and a project gives its own active contexts for any role", () => {
  const { db, lookups: found } = lookups();
  try {
    const app = { kind: "app", id: NOTES } as const;
    assertEquals(found.activeContexts(app, "lophn"), []);
    assertEquals(found.activeContexts(app, "operator"), []);
    const project = { kind: "project", id: P1 } as const;
    for (const role of ["lophn", "operator", "context_engineer"] as const) {
      assertEquals(found.activeContexts(project, role), [
        ctx(1),
        ctx(5),
        ctx(6),
      ]);
    }
  } finally {
    db.close();
  }
});
