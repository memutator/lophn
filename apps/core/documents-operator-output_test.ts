// documents/versions#R14 (documents#T32): 실제 core에서 실제 assignment의 Operator 자격이 document.save로
// 자기 출력 Document에 새 판만 더한다. lophn-agent가 등록한 OperatorOutput 판정 port가 같은 Tx에서
// 현재 assignment 표를 읽는다. 데이터 root는 temp dir이고 사람 데이터 root는 열지 않는다. provider는
// 부르지 않는다. assignment 행은 ledger에 직접 둔다(Operator 적용 command는 이 시험의 대상이 아니다).
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { type Core, startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";
import { lophnAgentDefinitions } from "./lophn-agent.ts";

const teams: TeamModule[] = [
  { lophnAgentDefinitions },
  { createLedgerRegistration },
];
const HASH = "ab".repeat(32);
const OTHER_MODULE = "cd".repeat(32);
const PRESET = "pst_01arz3ndektsv4rrffq69g5fav";
const ASG = "asg_01arz3ndektsv4rrffq69g5fav";
const OTHER_ASG = "asg_01arz3ndektsv4rrffq69g5faw";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const OUTPUT_DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const OTHER_OUTPUT_DOC = "doc_01arz3ndektsv4rrffq69g5faw";
const PLAIN_DOC = "doc_01arz3ndektsv4rrffq69g5fax";
const ABSENT_DOC = "doc_01arz3ndektsv4rrffq69g5fay";
const NEW_DOC = "doc_01arz3ndektsv4rrffq69g5faz";
const USER_TOKEN = "u".repeat(43);
const OPERATOR_TOKEN = "o".repeat(43);

function content(n: number): string {
  return n.toString(16).padStart(2, "0").repeat(32);
}

function prepared(
  document: string,
  base: string | null,
  key: string,
  over: Record<string, unknown> = {},
) {
  const hash = content(over["n"] === undefined ? 1 : Number(over["n"]));
  return {
    document,
    base_version: base,
    files_hash: HASH,
    file_count: 1,
    primary_path: "a.md",
    content_hash: hash,
    preparation_ref: `prep-${key}`,
    files: [{
      path: "a.md",
      blob_hash: HASH,
      bytes: 10,
      media_type: "text/markdown",
      primary: true,
      preparation_ref: `prep-file-${key}`,
    }],
    idempotency_key: key,
    ...(base === null
      ? { metadata: { title: "Weekly", place: null, name: null } }
      : {}),
    format: { name: "document", module_hash: HASH, explicit: false },
    validation: {
      input_hash: hash,
      module_hash: (over["format"] as { module_hash: string } | undefined)
        ?.module_hash ?? HASH,
      status: "passed",
      error_count: 0,
      warning_count: 0,
      diagnostics: [],
    },
    source: null,
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== "n")),
  };
}

async function note(core: Core, principal: string, key: string) {
  for (
    const [ref, purpose, size] of [
      [`prep-${key}`, "document_files", 0],
      [`prep-file-${key}`, "document_file", 10],
    ] as const
  ) {
    const noted = await core.notePrepared?.(
      {
        preparation: ref,
        principal,
        purpose,
        hash: HASH,
        size_bytes: size,
      },
      Date.UTC(2024, 0, 1),
    );
    assert(noted?.ok, noted?.ok ? "" : noted?.error.message);
  }
}

async function accept(
  core: Core,
  context: AuthenticatedContext,
  token: string,
) {
  const accepted = await core.acceptTestCredential?.(context, token);
  assert(accepted?.ok, accepted?.ok ? "" : accepted?.error.message);
  const recorded = await core.record(context);
  assert(recorded.ok, recorded.ok ? "" : recorded.error.message);
}

async function post(core: Core, token: string, body: unknown) {
  const response = await fetch(
    `http://127.0.0.1:${core.port}/v1/documents/save`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );
  const text = await response.text();
  let json: { error?: { code?: string; message?: string }; version?: string } =
    {};
  try {
    json = JSON.parse(text);
  } catch { /* 본문이 JSON이 아니다 */ }
  return { status: response.status, body: json, text };
}

// 한 저장 요청. 준비 참조를 먼저 알린다.
async function save(
  core: Core,
  token: string,
  principal: string,
  input: ReturnType<typeof prepared>,
) {
  const key = input.idempotency_key;
  await note(core, principal, key);
  return post(core, token, {
    input,
    idempotency_key: key,
    compare: { base_version: input.base_version },
    prepared: [`prep-${key}`, `prep-file-${key}`],
  });
}

// 그 문서를 남길 문서로 선언한 Operator assignment를 ledger에 직접 둔다.
function seedOperator(
  db: DatabaseSync,
  assignment: string,
  document: string,
) {
  const definition = JSON.stringify({
    outputs: [{ document, content: "weekly judgment" }],
  });
  db.prepare(
    `insert into assignments (id, preset_id, preset_revision, role, scope_kind,
       scope_id, state, revision) values (?, ?, 1, 'operator', 'all', null, 'enabled', 1)`,
  ).run(assignment, PRESET);
  db.prepare(
    `insert into assignment_revisions (assignment_id, revision, definition,
       definition_hash, decided_by, reason, created_at)
     values (?, 1, ?, ?, 'user', 'test', '2024-01-01T00:00:00.000Z')`,
  ).run(assignment, definition, HASH);
  db.prepare(
    `insert into assignment_outputs (assignment_id, document_id, content, owns_output)
     values (?, ?, 'weekly judgment', 1)`,
  ).run(assignment, document);
}

// 그 assignment의 진행 중 주기 회차다. 끝난 run의 자격은 새 대상 변경이 거절된다.
function seedRun(db: DatabaseSync, run: string, assignment: string) {
  db.prepare(
    `insert into runs (id, assignment, source, source_kind, source_assignment_revision,
       source_scheduled_at, state, state_seq, accepted_seq)
     values (?, ?, 'schedule', 'schedule', 1, '2024-01-01T00:00:00.000Z', 'accepted', 1, 1)`,
  ).run(run, assignment);
}

function seedPreset(db: DatabaseSync) {
  db.prepare(
    `insert into presets (id, kind, origin, name, name_key, prompt, revision)
     values (?, 'operator', 'user', 'Weekly', 'weekly', 'prompt', 1)`,
  ).run(PRESET);
  db.prepare(
    `insert into preset_revisions (preset_id, revision, definition, definition_hash,
       prompt_hash, decided_by, proposed_by, reason, created_at)
     values (?, 1, '{"instructions":[]}', ?, ?, 'user', 'user', 'test', '2024-01-01T00:00:00.000Z')`,
  ).run(PRESET, HASH, HASH);
}

function count(db: DatabaseSync, query: string, ...params: string[]): number {
  return Number(
    (db.prepare(query).get(...params) as { n: number | bigint }).n,
  );
}

Deno.test("documents/versions#R14: 실제 core에서 Operator 자격은 자기 출력 Document에 새 판만 더하고 새 Document·자리·format 변경·출력 밖 문서는 거절된다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-operator-output-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [
      new URL("./lophn-agent.ts", import.meta.url).href,
      new URL("./documents.ts", import.meta.url).href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(32),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  const db = new DatabaseSync(`${core.dataRoot}/lophn.db`);
  db.exec("PRAGMA busy_timeout = 5000");
  try {
    await accept(core, {
      principal: "user-1",
      actor: "user",
      scope: { operations: ["document.save"], targets: {} },
      conditions: {},
      credential_ref: "cred-user",
    }, USER_TOKEN);
    // 사람이 만든 문서 셋. 출력 둘과 출력이 아닌 하나다.
    const firsts = new Map<string, string>();
    for (const document of [OUTPUT_DOC, OTHER_OUTPUT_DOC, PLAIN_DOC]) {
      const created = await save(
        core,
        USER_TOKEN,
        "user-1",
        prepared(document, null, `seed-${document}`),
      );
      assertEquals(created.status, 200, created.text);
      firsts.set(document, created.body.version!);
    }
    seedPreset(db);
    seedOperator(db, ASG, OUTPUT_DOC);
    seedOperator(db, OTHER_ASG, OTHER_OUTPUT_DOC);
    seedRun(db, RUN, ASG);
    await accept(core, {
      principal: `agent:${ASG}`,
      actor: `agent:${ASG}`,
      scope: {
        operations: ["document.save"],
        targets: { assignment: ASG, run: RUN },
      },
      conditions: { assignment: ASG, run: RUN },
      credential_ref: "cred-operator",
    }, OPERATOR_TOKEN);
    const operator = (input: ReturnType<typeof prepared>) =>
      save(core, OPERATOR_TOKEN, `agent:${ASG}`, input);

    // 회차마다 같은 Document의 새 판이 되고 앞 회차는 고정 판으로 남는다.
    const round1 = await operator(
      prepared(OUTPUT_DOC, firsts.get(OUTPUT_DOC)!, "round-1", { n: 2 }),
    );
    assertEquals(round1.status, 200, round1.text);
    const round2 = await operator(
      prepared(OUTPUT_DOC, round1.body.version!, "round-2", { n: 3 }),
    );
    assertEquals(round2.status, 200, round2.text);
    assert(round2.body.version !== round1.body.version);
    assertEquals(
      count(
        db,
        "select count(*) as n from versions where document = ?",
        OUTPUT_DOC,
      ),
      3,
    );
    assertEquals(
      count(
        db,
        "select count(*) as n from versions where document = ? and saved_by = ?",
        OUTPUT_DOC,
        `agent:${ASG}`,
      ),
      2,
    );
    const documents = count(db, "select count(*) as n from documents");

    // 새 Document(series의 다음 문서도 같은 모양이다)는 forbidden이고 문서를 만들지 않는다.
    const created = await operator(prepared(NEW_DOC, null, "create-new"));
    assertEquals(created.status, 403, created.text);
    // 자리·이름을 정하는 입력과 format 변경은 forbidden이고 판을 더하지 않는다.
    const placed = await operator(
      prepared(OUTPUT_DOC, round2.body.version!, "place", {
        n: 4,
        metadata: {
          title: "Weekly",
          place: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" },
          name: "moved",
        },
      }),
    );
    assertEquals(placed.status, 403, placed.text);
    const formatted = await operator(
      prepared(OUTPUT_DOC, round2.body.version!, "format", {
        n: 4,
        format: {
          name: "document",
          module_hash: OTHER_MODULE,
          explicit: false,
        },
      }),
    );
    assertEquals(formatted.status, 403, formatted.text);
    assertEquals(
      count(
        db,
        "select count(*) as n from versions where document = ?",
        OUTPUT_DOC,
      ),
      3,
    );
    assertEquals(count(db, "select count(*) as n from documents"), documents);

    // 출력이 아닌 문서와 다른 assignment의 출력은 없는 문서와 같은 답이다.
    for (const shape of ["based", "new"] as const) {
      const request = (document: string, base: string | null, key: string) =>
        operator(
          prepared(document, shape === "new" ? null : base, key, { n: 5 }),
        );
      const absent = await request(
        ABSENT_DOC,
        firsts.get(PLAIN_DOC)!,
        `a-${shape}`,
      );
      for (
        const [document, base] of [
          [PLAIN_DOC, firsts.get(PLAIN_DOC)!],
          [OTHER_OUTPUT_DOC, firsts.get(OTHER_OUTPUT_DOC)!],
        ] as const
      ) {
        const refused = await request(document, base, `${document}-${shape}`);
        assertEquals(refused.status, absent.status, refused.text);
        assertEquals(refused.body.error, absent.body.error);
      }
    }
    for (const document of [PLAIN_DOC, OTHER_OUTPUT_DOC]) {
      assertEquals(
        count(
          db,
          "select count(*) as n from versions where document = ?",
          document,
        ),
        1,
      );
    }
    assertEquals(count(db, "select count(*) as n from documents"), documents);
  } finally {
    db.close();
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
