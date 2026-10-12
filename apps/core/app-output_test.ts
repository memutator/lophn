// documents#T31 끝에서 끝까지: broker의 DocumentsSave port를 실제 앱 자격 저장에 잇는 어댑터가
// 실제 core·documents worker·I/O worker를 지나 앱 place의 고정 문서 판을 남긴다. 앱은 app
// credential(`app:<id>`, 발급과 같은 조건)로만 부르고, 데이터 root는 temp dir다. 사람 데이터
// root는 열지 않는다. broker 서버·supervisor 조립(apps#T19)은 이 시험의 범위 밖이다.
import { assert, assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/protocol/platform/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import {
  type AppOutputFile,
  createAppDocumentsSave,
  type DocumentsSave,
} from "../../packages/apps/permissions/mod.ts";
import { BUILTIN_MODULE_HASH } from "../../packages/documents/formats/guest/module-hash.ts";
import { type Core, startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "./documents.ts";
import { createLedgerRegistration as createAppsRegistration } from "./apps.ts";
import { lophnAgentDefinitions } from "./lophn-agent.ts";

// lophn-agent 정의와 documents·apps를 제품 기동처럼 함께 띄운다.
const teams: TeamModule[] = [
  { lophnAgentDefinitions },
  { createLedgerRegistration: createDocumentsRegistration },
  { createLedgerRegistration: createAppsRegistration },
];
const REL = "rel_01arz3ndektsv4rrffq69g5fav";
const FAKE_CONNECTION = "cac_01arz3ndektsv4rrffq69g5fav";
const USER_TOKEN = "u".repeat(43);
const FORMAT = {
  name: "document",
  module_hash: BUILTIN_MODULE_HASH,
  explicit: true,
};

type Opened = {
  core: Core;
  home: string;
  dispose(): Promise<void>;
};

type AppWorld = {
  id: string;
  token: string;
  // 앱이 남기려는 출력. 시험이 내용을 바꾼다.
  output: { files: Map<string, string> };
  save: DocumentsSave;
};

async function accept(
  core: Core,
  context: AuthenticatedContext,
  token: string,
) {
  const accepted = await core.acceptTestCredential?.(context, token);
  assert(accepted?.ok);
  const recorded = await core.record(context);
  assert(recorded.ok);
}

async function open(): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-app-output-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [
      new URL("./lophn-agent.ts", import.meta.url).href,
      new URL("./documents.ts", import.meta.url).href,
      new URL("./apps.ts", import.meta.url).href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(31),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  await accept(core, {
    principal: "user-1",
    actor: "user",
    scope: {
      operations: [
        "app.create",
        "app.archive",
        "project.create",
        "document.list",
        "document.history",
        "document.file",
        "document.rename",
        "document.resolve",
        "series.get",
      ],
      targets: {},
    },
    conditions: {},
    credential_ref: "cred-user",
  }, USER_TOKEN);
  return {
    core,
    home,
    async dispose() {
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
    },
  };
}

async function post(
  core: Core,
  path: string,
  body: unknown,
  token = USER_TOKEN,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch { /* 본문이 JSON이 아니다 */ }
  return { status: response.status, body: json };
}

function command(input: unknown, key: string, compare: unknown = {}) {
  return { input, idempotency_key: key, compare, prepared: [] };
}

async function createApp(
  opened: Opened,
  slug: string,
  token: string,
): Promise<AppWorld> {
  const created = await post(
    opened.core,
    "apps/create",
    command({ slug, name: slug, description: `${slug} app` }, `create-${slug}`),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const id = String(created.body.id);
  // 앱 supervisor가 발급하는 app credential과 같은 조건이다(platform/identity/app-credential).
  const fixed = {
    app: id,
    release: REL,
    process: `proc-${slug}`,
    mode: "live",
  };
  await accept(opened.core, {
    principal: `app:${id}`,
    actor: `app:${id}`,
    scope: {
      operations: [
        "document.upload",
        "document.prepare",
        "document.save",
        "document.list",
        "series.create",
      ],
      targets: fixed,
    },
    conditions: fixed,
    credential_ref: `cred-${slug}`,
  }, token);
  const client = createCoreClient({
    baseUrl: `http://127.0.0.1:${opened.core.port}`,
    connection: FAKE_CONNECTION,
    provider: () => Promise.resolve({ ok: true, value: { token } }),
  });
  const output = { files: new Map<string, string>() };
  const save = createAppDocumentsSave({
    client: () => Promise.resolve({ ok: true, value: client }),
    output: {
      files(request) {
        const text = output.files.get(request.key);
        if (text === undefined) {
          return Promise.resolve({
            ok: false,
            error: { code: "not_found", message: "no output" },
          });
        }
        return Promise.resolve({ ok: true, value: [outputFile(text)] });
      },
    },
    declarations: {
      get: () =>
        Promise.resolve({
          ok: true,
          value: { name: "주간 보고", format: FORMAT },
        }),
    },
  });
  return { id, token, output, save };
}

function outputFile(text: string): AppOutputFile {
  const bytes = new TextEncoder().encode(text);
  return {
    path: "report.md",
    media_type: "text/markdown",
    bytes: bytes.length,
    blob_hash: createHash("sha256").update(bytes).digest("hex"),
    primary: true,
    open: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
  };
}

function request(
  app: AppWorld,
  overrides: Partial<Parameters<DocumentsSave["save"]>[0]> = {},
) {
  return {
    app: app.id,
    release: REL,
    place: { kind: "app" as const, app: app.id },
    key: "weekly-report",
    baseVersion: null,
    idempotencyKey: "report-1",
    ...overrides,
  };
}

function ledger(home: string): DatabaseSync {
  return new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
}

Deno.test("documents/versions#R14: 앱 저장은 앱 place의 한 Document에 고정 판을 쌓고 같은 재전송 key는 판을 늘리지 않는다", async () => {
  const opened = await open();
  try {
    const app = await createApp(opened, "weekly", "a".repeat(43));
    app.output.files.set("weekly-report", "# 1주차\n본문\n");
    const first = await app.save.save(request(app));
    assert(first.ok, first.ok ? "" : JSON.stringify(first.error));
    assertEquals(first.value.saved, true);
    const v1 = first.value.version!;
    // 응답을 잃은 첫 저장의 재전송은 같은 판이다.
    const retried = await app.save.save(request(app));
    assert(retried.ok, retried.ok ? "" : JSON.stringify(retried.error));
    assertEquals(retried.value, first.value);
    // 기준 판 위의 새 판. 같은 Document의 2번 판이다.
    app.output.files.set("weekly-report", "# 1주차\n본문\n바뀐 내용\n");
    const second = await app.save.save(
      request(app, { baseVersion: v1, idempotencyKey: "report-2" }),
    );
    assert(second.ok, second.ok ? "" : JSON.stringify(second.error));
    assertEquals(second.value.saved, true);
    const v2 = second.value.version!;
    assert(v2 !== v1);
    // 응답을 잃은 두 번째 저장의 재전송은 기준 판이 이미 지난 뒤에도 같은 판이다.
    const again = await app.save.save(
      request(app, { baseVersion: v1, idempotencyKey: "report-2" }),
    );
    assert(again.ok, again.ok ? "" : JSON.stringify(again.error));
    assertEquals(again.value.version, v2);
    // 낡은 기준 판의 새 key 저장은 conflict다. 판을 덮지 않는다.
    app.output.files.set("weekly-report", "# 1주차\n다른 쪽 내용\n");
    const stale = await app.save.save(
      request(app, { baseVersion: v1, idempotencyKey: "report-3" }),
    );
    assert(!stale.ok);
    assertEquals(stale.error.code, "conflict");
    // 같은 내용이면 unchanged다.
    app.output.files.set("weekly-report", "# 1주차\n본문\n바뀐 내용\n");
    const same = await app.save.save(
      request(app, { baseVersion: v2, idempotencyKey: "report-4" }),
    );
    assert(same.ok, same.ok ? "" : JSON.stringify(same.error));
    assertEquals(same.value, { saved: false, version: v2 });

    // 앱 place의 문서는 하나이고 두 판이다. 판의 주체와 출처는 앱 자격이다.
    const list = await post(opened.core, "documents/list", {
      place: { kind: "app", id: app.id },
    });
    assertEquals(list.status, 200, JSON.stringify(list.body));
    const documents = list.body.documents as {
      document: { id: string; name: string; title: string };
    }[];
    assertEquals(documents.length, 1);
    assertEquals(documents[0].document.name, "weekly-report");
    assertEquals(documents[0].document.title, "주간 보고");
    const db = ledger(opened.home);
    try {
      const rows = db.prepare(
        "SELECT number, saved_by, source FROM versions WHERE document = ? ORDER BY number",
      ).all(documents[0].document.id) as {
        number: number;
        saved_by: string;
        source: string;
      }[];
      assertEquals(rows.map((row) => row.number), [1, 2]);
      for (const row of rows) {
        assertEquals(row.saved_by, `app:${app.id}`);
        assertEquals(JSON.parse(row.source), {
          kind: "app",
          app: app.id,
          release: REL,
        });
      }
    } finally {
      db.close();
    }
    // 결과는 고정 판으로 다시 열린다: 옛 판의 원문은 새 판 뒤에도 그대로다.
    const file = await fetch(
      `http://127.0.0.1:${opened.core.port}/v1/documents/file`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${USER_TOKEN}`,
        },
        body: JSON.stringify({ version: v1, path: "report.md" }),
      },
    );
    assertEquals(file.status, 200);
    assertEquals(await file.text(), "# 1주차\n본문\n");
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/versions#R14: 앱은 다른 앱 place의 문서에 판을 더하지 못하고 그 답은 없는 문서와 같다", async () => {
  const opened = await open();
  try {
    const one = await createApp(opened, "weekly", "a".repeat(43));
    const two = await createApp(opened, "daily", "b".repeat(43));
    one.output.files.set("weekly-report", "# 1주차\n");
    const first = await one.save.save(request(one));
    assert(first.ok, first.ok ? "" : JSON.stringify(first.error));
    // 앱 daily가 같은 출력 key로 저장하면 자기 앱 place의 새 문서다(앱 weekly의 문서가 아니다).
    two.output.files.set("weekly-report", "# daily\n");
    const own = await two.save.save(request(two));
    assert(own.ok, own.ok ? "" : JSON.stringify(own.error));
    assert(own.value.version !== first.value.version);
    const db = ledger(opened.home);
    let foreign: string;
    try {
      const rows = db.prepare(
        "SELECT id, place_id FROM documents ORDER BY place_id",
      ).all() as { id: string; place_id: string }[];
      assertEquals(rows.length, 2);
      foreign = rows.find((row) => row.place_id === one.id)!.id;
    } finally {
      db.close();
    }
    // daily가 weekly 문서 id를 직접 가리켜 준비·저장하면 없는 문서와 같은 거절이다.
    const client = createCoreClient({
      baseUrl: `http://127.0.0.1:${opened.core.port}`,
      connection: FAKE_CONNECTION,
      provider: () =>
        Promise.resolve({ ok: true, value: { token: two.token } }),
    });
    const bytes = new TextEncoder().encode("# 가로채기\n");
    const uploaded = await client.upload(
      (await import("../../packages/protocol/projects/mod.ts"))
        .documentUpload,
      {
        blob_hash: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      },
      outputFile("# 가로채기\n").open(),
    );
    assert(uploaded.ok, uploaded.ok ? "" : JSON.stringify(uploaded.error));
    const { documentPrepare, documentSave } = await import(
      "../../packages/protocol/projects/mod.ts"
    );
    const attempt = async (document: string, key: string) => {
      const prepared = await client.read(documentPrepare, {
        document,
        base_version: first.value.version,
        files: [{
          path: "report.md",
          media_type: "text/markdown",
          bytes: bytes.length,
          blob_hash: createHash("sha256").update(bytes).digest("hex"),
          primary: true,
          content: { kind: "prepared", blob: uploaded.value },
        }],
        source: { kind: "app", app: two.id, release: REL },
        idempotency_key: key,
      });
      // 기준 판 읽기도 앱 자격의 범위 안이다. 범위 밖의 판은 없는 판과 같아 준비가 거절이거나
      // 저장이 거절이다. 어느 쪽이든 foreign과 absent의 오류가 같다.
      if (!prepared.ok) return prepared;
      return await client.command(documentSave, {
        input: prepared.value,
        idempotency_key: key,
        compare: { base_version: first.value.version },
        prepared: [
          (prepared.value as { preparation_ref: string }).preparation_ref,
        ],
      });
    };
    const denied = await attempt(foreign, "intrude-1");
    const absent = await attempt("doc_01arz3ndektsv4rrffq69g5fb9", "intrude-2");
    assert(!denied.ok);
    assert(!absent.ok);
    assertEquals(denied.error.code, absent.error.code);
    assertEquals(denied.error.message, absent.error.message);
    // weekly 문서의 판은 늘지 않았다.
    const history = await post(opened.core, "documents/history", {
      document: foreign,
    });
    assertEquals((history.body.versions as unknown[]).length, 1);
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/addressing#R2: project 이름을 앱 이름이 쓰고 있으면 project 생성은 conflict고 앱 문서 이름 변경 뒤 옛 address는 현재 참조로 안내한다", async () => {
  const opened = await open();
  try {
    const app = await createApp(opened, "weekly", "a".repeat(43));
    // 앱 이름은 project와 하나의 이름 공간이다(앱 생성의 같은 transaction 예약).
    const clash = await post(
      opened.core,
      "projects/create",
      command({
        id: "prj_01arz3ndektsv4rrffq69g5fav",
        name: "weekly",
        title: "겹치는 이름",
        purpose: "",
        folders: [{
          path: `${opened.home}/project-folder`,
          description: "",
        }],
        tracking: { enabled: false, patterns: [], use_gitignore: false },
      }, "project-clash"),
    );
    assertEquals(clash.status, 409, JSON.stringify(clash.body));
    // 앱 문서를 저장한 뒤 문서 이름을 바꾸면 옛 address가 현재 참조로 이어진다.
    app.output.files.set("weekly-report", "# 1주차\n");
    const saved = await app.save.save(request(app));
    assert(saved.ok, saved.ok ? "" : JSON.stringify(saved.error));
    const listed = await post(opened.core, "documents/list", {
      place: { kind: "app", id: app.id },
    });
    const entry = (listed.body.documents as {
      document: { id: string; revision: string };
    }[])[0];
    const renamed = await post(
      opened.core,
      "documents/rename",
      command(
        { document: entry.document.id, name: "summary" },
        "rename-1",
        { base_revision: entry.document.revision },
      ),
    );
    assertEquals(renamed.status, 200, JSON.stringify(renamed.body));
    const resolved = await post(opened.core, "documents/resolve", {
      reference: {
        place: "weekly",
        document: "weekly-report",
        section: null,
        version: null,
      },
    });
    assertEquals(resolved.status, 200, JSON.stringify(resolved.body));
    const page = resolved.body.resolved as {
      document: string;
      redirected: boolean;
      current_reference: { place: string; document: string };
    };
    assertEquals(page.document, entry.document.id);
    assertEquals(page.redirected, true);
    assertEquals(page.current_reference.place, "weekly");
    assertEquals(page.current_reference.document, "summary");
    // 이름은 옛 이름을 다른 문서에 다시 줄 수 없다: 같은 이름으로 새 출력을 저장하면 같은
    // 앱 place의 새 문서 이름 충돌이다.
    app.output.files.set("weekly-report", "# 새 문서\n");
    const reuse = await app.save.save(
      request(app, { idempotencyKey: "reuse" }),
    );
    assert(!reuse.ok);
    assertEquals(reuse.error.code, "conflict");
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/versions#R14: 보관된 앱은 새 출력을 남기지 못하고 앱 문서는 그대로 남는다", async () => {
  const opened = await open();
  try {
    const app = await createApp(opened, "weekly", "a".repeat(43));
    app.output.files.set("weekly-report", "# 1주차\n");
    const first = await app.save.save(request(app));
    assert(first.ok, first.ok ? "" : JSON.stringify(first.error));
    const archived = await post(
      opened.core,
      "apps/archive",
      command({ app: app.id }, "archive-1", {
        base_revision: appRevision(opened, app.id),
      }),
    );
    assertEquals(archived.status, 200, JSON.stringify(archived.body));
    app.output.files.set("weekly-report", "# 1주차\n바뀜\n");
    const next = await app.save.save(
      request(app, { baseVersion: first.value.version, idempotencyKey: "r2" }),
    );
    assert(!next.ok);
    assertEquals(next.error.code, "forbidden");
    // 앱 문서는 보존된다(apps/registration#R9).
    const list = await post(opened.core, "documents/list", {
      place: { kind: "app", id: app.id },
    });
    assertEquals((list.body.documents as unknown[]).length, 1);
  } finally {
    await opened.dispose();
  }
});

function appRevision(opened: Opened, app: string): string {
  const db = ledger(opened.home);
  try {
    const row = db.prepare("SELECT revision FROM apps WHERE id = ?").get(
      app,
    ) as { revision: string };
    return row.revision;
  } finally {
    db.close();
  }
}

Deno.test("documents/series#R1: 앱은 자기 앱 place에만 series를 등록하고 project에는 forbidden이다", async () => {
  const opened = await open();
  try {
    const app = await createApp(opened, "weekly", "a".repeat(43));
    const family = (id: string, place: unknown, name: string) =>
      command({
        id,
        place,
        name,
        title: "주간 보고",
        format: "document",
        order: { kind: "key", direction: "ascending" },
        next_rule: "{n+1}",
      }, `series-${name}`);
    const own = await post(
      opened.core,
      "series/create",
      family(
        "ser_01arz3ndektsv4rrffq69g5fav",
        { kind: "app", id: app.id },
        "weekly",
      ),
      app.token,
    );
    assertEquals(own.status, 200, JSON.stringify(own.body));
    const project = await post(
      opened.core,
      "series/create",
      family(
        "ser_01arz3ndektsv4rrffq69g5faw",
        { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" },
        "elsewhere",
      ),
      app.token,
    );
    assertEquals(project.status, 403, JSON.stringify(project.body));
  } finally {
    await opened.dispose();
  }
});
