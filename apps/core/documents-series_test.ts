// documents/series#R1 #R2 #R10 #R11 #R13: 실제 core에서 가족을 만들고 멤버를 가입하고
// 보관한다. 데이터 root는 harness가 만든 temp dir다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { type CoreHarness, createCoreHarness } from "./testing/core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";

const TEAM: TeamModule[] = [{ createLedgerRegistration }];
const HASH = "ab".repeat(32);
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const DOC2 = "doc_01arz3ndektsv4rrffq69g5fax";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const SERIES = "ser_01arz3ndektsv4rrffq69g5fav";
const PREPARE = Date.UTC(2024, 0, 1);

function prepared(
  document: string,
  key: string,
  place: unknown,
  name: string,
) {
  return {
    document,
    base_version: null,
    files_hash: HASH,
    file_count: 1,
    primary_path: "a.md",
    content_hash: HASH,
    preparation_ref: `prep-${key}`,
    idempotency_key: key,
    metadata: { title: "Notes", place, name },
    format: { name: "document", module_hash: HASH, explicit: false },
    validation: {
      input_hash: HASH,
      module_hash: HASH,
      status: "passed",
      error_count: 0,
      warning_count: 0,
      diagnostics: [],
    },
    source: null,
  };
}

async function open(): Promise<{ harness: CoreHarness; token: string }> {
  const opened = await createCoreHarness({
    teams: TEAM,
    teamModules: [new URL("./documents.ts", import.meta.url).href],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  const issued = await harness.credential({
    actor: "user",
    principal: "user-1",
    scope: {
      operations: [
        "project.create",
        "document.save",
        "document.history",
        "series.create",
        "series.update",
        "series.set_draft",
        "series.clear_draft",
        "series.add_instance",
        "series.update_instance",
        "series.remove_instance",
        "series.archive",
        "series.unarchive",
      ],
      targets: {},
    },
    conditions: {},
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  for (const key of ["one", "two"]) {
    const noted = await harness.notePrepared(
      {
        preparation: `prep-${key}`,
        principal: "user-1",
        purpose: "document_files",
        hash: HASH,
        size_bytes: 0,
      },
      PREPARE,
    );
    assert(noted.ok, noted.ok ? "" : noted.error.message);
  }
  return { harness, token: issued.value.token };
}

function post(
  harness: CoreHarness,
  path: string,
  body: unknown,
  token: string,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function okPage(
  harness: CoreHarness,
  path: string,
  body: unknown,
  token: string,
) {
  const reply = await post(harness, path, body, token);
  const text = await reply.text();
  assertEquals(reply.status, 200, `${path}: ${text}`);
  return JSON.parse(text) as {
    status?: string;
    revision?: string;
    version?: string;
    error?: { code: string; message: string };
  };
}

Deno.test(
  "documents/series#R1 #R2 #R10 #R11 #R13: core에서 가족을 만들고 멤버를 가입하고 보관한다",
  async () => {
    const { harness, token } = await open();
    try {
      // 프로젝트를 만든다.
      const project = await okPage(harness, "projects/create", {
        input: {
          id: PROJECT,
          name: "mahas",
          title: "Notes",
          purpose: "",
          folders: [{ path: "/tmp/lophn-test-series", description: "" }],
          tracking: { enabled: false, patterns: [], use_gitignore: false },
        },
        idempotency_key: "project-1",
        compare: {},
        prepared: [],
      }, token);
      assert(project.revision !== undefined);

      // 멤버 문서 두 개를 만든다. place·이름은 같은 project다.
      for (
        const [key, document] of [
          ["one", DOC],
          ["two", DOC2],
        ] as const
      ) {
        await okPage(harness, "documents/save", {
          input: prepared(
            document,
            key,
            { kind: "project" as const, id: PROJECT },
            `report-${key}`,
          ),
          idempotency_key: key,
          compare: { base_version: null },
          prepared: [`prep-${key}`],
        }, token);
      }

      // lophn agent 등록은 forbidden으로 거절이다.
      const agentIssued = await harness.credential({
        actor: "agent",
        principal: "agent-1",
        scope: {
          operations: [
            "series.create",
            "series.update",
            "series.set_draft",
            "series.clear_draft",
            "series.add_instance",
            "series.update_instance",
            "series.remove_instance",
            "series.archive",
            "series.unarchive",
          ],
          targets: {},
        },
        conditions: {},
      });
      assert(agentIssued.ok, agentIssued.ok ? "" : agentIssued.error.message);
      const agent = await post(harness, "series/create", {
        input: {
          id: SERIES,
          place: { kind: "project", id: PROJECT },
          name: "weekly",
          title: "주간 보고",
          format: "document",
          order: { kind: "key", direction: "ascending" },
          next_rule: "{n+1}",
        },
        idempotency_key: "agent-1",
        compare: {},
        prepared: [],
      }, agentIssued.value.token);
      const agentText = await agent.text();
      assertEquals(agent.status, 403, agentText);

      // 가족을 만든다. 멤버 key는 주소 이름과 별개다(R2).
      const created = await okPage(harness, "series/create", {
        input: {
          id: SERIES,
          place: { kind: "project", id: PROJECT },
          name: "weekly",
          title: "주간 보고",
          format: "document",
          order: { kind: "key", direction: "ascending" },
          next_rule: "{n+1}",
        },
        idempotency_key: "series-1",
        compare: {},
        prepared: [],
      }, token);
      assert(created.revision !== undefined);

      // 가족 draft를 남긴다(key·예정 문서). 멤버가 아닌 문서다(R11).
      const drafted = await okPage(harness, "series/set_draft", {
        input: {
          series: SERIES,
          draft: {
            document: DOC,
            key: "2026-40",
            base_version: null,
            format: { name: "document", module_hash: HASH, explicit: false },
            content: null,
          },
        },
        idempotency_key: "draft-1",
        compare: { base_revision: created.revision },
        prepared: [],
      }, token);
      assert(drafted.revision !== undefined);

      // 첫 멤버를 가입한다. draft와 document·key가 같으므로 가입이 draft를 비운다(R11).
      const joined = await okPage(harness, "series/add_instance", {
        input: {
          series: SERIES,
          document: DOC,
          key: "2026-40",
        },
        idempotency_key: "join-1",
        compare: { base_revision: drafted.revision },
        prepared: [],
      }, token);
      assert(joined.revision !== undefined);

      // 둘째 멤버를 가입한다.
      const joined2 = await okPage(harness, "series/add_instance", {
        input: {
          series: SERIES,
          document: DOC2,
          key: "2026-41",
        },
        idempotency_key: "join-2",
        compare: { base_revision: joined.revision },
        prepared: [],
      }, token);
      assert(joined2.revision !== undefined);

      // 가족을 보관한다(R10).
      const archived = await okPage(harness, "series/archive", {
        input: { series: SERIES },
        idempotency_key: "archive-1",
        compare: { base_revision: joined2.revision },
        prepared: [],
      }, token);
      assert(archived.revision !== undefined);

      // 보�� 뒤에도 구성을 읽는다(R13). 읽기는 event를 만들지 않는다(R14).
      // events route가 이 번들의 scope에 없으므로 ledger로 구성 변경 기록을 본다.
      const { DatabaseSync } = await import("node:sqlite");
      const ledger = new DatabaseSync(`${harness.dataRoot}/lophn.db`, {
        readOnly: true,
      });
      const rows = ledger
        .prepare("SELECT type FROM events WHERE subject = ? ORDER BY seq")
        .all(SERIES) as { type: string }[];
      assertEquals(rows.map((entry) => entry.type), [
        "SeriesCreated",
        "SeriesDraftSet",
        "SeriesDraftCleared",
        "SeriesInstanceAdded",
        "SeriesInstanceAdded",
        "SeriesArchived",
      ]);
      ledger.close();
    } finally {
      await harness.close();
    }
  },
);
