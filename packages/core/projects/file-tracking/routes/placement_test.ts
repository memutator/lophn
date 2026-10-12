// documents#T19 끝에서 끝까지: 실제 core가 실제 documents coordinator와 준비 worker를 거쳐 문서를
// 파일로 두고(`files.write`의 place) 빼는(`files.delete`의 unlink) 일을 한다. 데이터 root와 폴더는
// 모두 temp dir다. 사람 데이터 root(~/.lophn, ~/.config/lophn)는 열지 않는다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, seededRandom } from "../../../../base/mod.ts";
import {
  FILE_DELETE_DECISION,
  filesDelete,
} from "../../../../protocol/projects/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { confirmationBinding } from "../../../server/identity/mod.ts";
import { type Core, startCore } from "../../../main/daemon/core.ts";
import { createLedgerRegistration } from "../../register.ts";

const PROJECT = "prj_01kq12a1pha000000000000000";
const DOC = "doc_01kq12a1pha000000000000000";
const USER = "u".repeat(43);
const LIMITED = "l".repeat(43);
const AGENT = "a".repeat(43);
const FILE_OPERATIONS = [
  "project.create",
  "project.set_tracking",
  "project.preview_tracking",
  "files.status",
  "files.list",
  "files.read",
  "files.write",
  "files.delete",
  "document.upload",
  "document.prepare",
  "document.save",
  "document.file",
];
const USER_OPERATIONS = [
  ...FILE_OPERATIONS,
  "document.set_source",
  "document.move",
];

type Json = Record<string, unknown>;
type Reply = { status: number; body: Json };

const encoder = new TextEncoder();

async function sha(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(text) as Uint8Array<ArrayBuffer>,
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function ledger<T>(home: string, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    return run(db);
  } finally {
    db.close();
  }
}

type Opened = {
  // documents worker가 hello한 횟수. 등록 폴더가 바뀌면 worker가 다시 뜨고 새로 hello한다.
  hellos(): number;
  core: Core;
  home: string;
  folder: string;
  dispose(): Promise<void>;
};

async function accept(
  core: Core,
  context: AuthenticatedContext,
  token: string,
) {
  assert(core.acceptTestCredential);
  const accepted = await core.acceptTestCredential(context, token);
  assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
  const recorded = await core.record(context);
  assert(recorded.ok, recorded.ok ? "" : recorded.error.message);
}

async function open(): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-docs-place-" });
  const folder = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-docs-place-folder-" }),
  );
  const hello = { count: 0 };
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createLedgerRegistration }],
    teamModules: [new URL("../../register.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(41),
    testCredentials: true,
    onDocumentsHello: () => {
      hello.count += 1;
    },
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  await accept(core, {
    principal: "user",
    actor: "user",
    scope: { operations: USER_OPERATIONS, targets: {} },
    conditions: {},
    credential_ref: "cred-place-user",
  }, USER);
  // 파일 통로는 쓰지만 원본 연결·자리 command 범위는 없는 사람 자격.
  await accept(core, {
    principal: "user-limited",
    actor: "user",
    scope: { operations: FILE_OPERATIONS, targets: {} },
    conditions: {},
    credential_ref: "cred-place-limited",
  }, LIMITED);
  // 사람이 아닌 자격은 파일 통로를 쓰지 못한다.
  await accept(core, {
    principal: "agent-1",
    actor: "coding_agent:cac_01kq12a1pha000000000000000",
    scope: { operations: USER_OPERATIONS, targets: {} },
    conditions: {},
    credential_ref: "cred-place-agent",
  }, AGENT);
  return {
    hellos: () => hello.count,
    core,
    home,
    folder,
    async dispose() {
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
      await Deno.remove(folder, { recursive: true });
    },
  };
}

async function post(
  opened: Opened,
  path: string,
  body: unknown,
  token = USER,
): Promise<Reply> {
  const response = await fetch(
    `http://127.0.0.1:${opened.core.port}/v1/${path}`,
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
  return {
    status: response.status,
    body: text.length > 0 && text.startsWith("{") ? JSON.parse(text) : {},
  };
}

type Blob = {
  preparation: string;
  principal: string;
  purpose: string;
  hash: string;
  size_bytes: number;
};

async function upload(opened: Opened, text: string): Promise<Blob> {
  const bytes = encoder.encode(text);
  const input = btoa(JSON.stringify({
    blob_hash: await sha(text),
    bytes: bytes.length,
  })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const response = await fetch(
    `http://127.0.0.1:${opened.core.port}/v1/documents/upload`,
    {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-lophn-input": input,
        authorization: `Bearer ${USER}`,
      },
      body: bytes,
    },
  );
  assertEquals(response.status, 200);
  return await response.json() as Blob;
}

// 프로젝트를 만들고 `**/*.md`로 추적을 켠다(폴더는 비어 있다).
async function track(opened: Opened) {
  const before = opened.hellos();
  const created = await post(opened, "projects/create", {
    input: {
      id: PROJECT,
      name: "alpha",
      title: "Alpha",
      purpose: "",
      folders: [{ path: opened.folder, description: "a" }],
      tracking: { enabled: false, patterns: [], use_gitignore: false },
    },
    idempotency_key: "create-alpha",
    compare: {},
    prepared: [],
  });
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const revision = String(created.body["revision"]);
  const folders = [{ path: opened.folder, description: "a" }];
  const tracking = {
    enabled: true,
    patterns: [{ effect: "include" as const, glob: "**/*.md" }],
    use_gitignore: false,
  };
  const preview = await post(opened, "projects/preview_tracking", {
    project: PROJECT,
    base_revision: revision,
    folders,
    tracking,
  });
  assertEquals(preview.status, 200, JSON.stringify(preview.body));
  const applied = await post(opened, "projects/set_tracking", {
    input: { project: PROJECT, folders, tracking, preview: preview.body },
    idempotency_key: "track-alpha",
    compare: { base_revision: revision },
    prepared: [],
  });
  assertEquals(applied.status, 200, JSON.stringify(applied.body));
  // 추적 규칙을 켜면 worker가 새 폴더 권한으로 다시 뜬다. 새 worker가 hello할 때까지 기다린다:
  // 옛 worker는 곧 멈추므로 거기로 간 요청은 끝까지 답을 받지 못한다.
  const deadline = Date.now() + 40_000;
  while (opened.hellos() === before) {
    if (Date.now() > deadline) {
      throw new Error("documents worker did not restart");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// documents coordinator가 붙을 때까지 기다린다. 규칙이 바뀌면 worker가 다시 뜨므로 track 뒤에 부른다.
async function ready(opened: Opened) {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    // 등록 폴더 안의 없는 파일은 coordinator가 폴더를 알 때만 404다(붙기 전 503, 폴더를 알기 전 400).
    const response = await fetch(
      `http://127.0.0.1:${opened.core.port}/v1/files/read`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${USER}`,
        },
        body: JSON.stringify({
          target: {
            kind: "project_file",
            project: PROJECT,
            path: `${opened.folder}/ready.dat`,
          },
        }),
      },
    );
    await response.arrayBuffer();
    if (response.status === 404) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("documents worker did not become ready");
}

// 원본 없는 문서를 업로드한 원문으로 저장한다. 판 하나, 파일 하나(note.md).
async function saveDocument(opened: Opened, text: string): Promise<string> {
  const blob = await upload(opened, text);
  const prepared = await post(opened, "documents/prepare", {
    document: DOC,
    base_version: null,
    metadata: { title: "Note", place: null, name: null },
    files: [{
      path: "note.md",
      blob_hash: blob.hash,
      bytes: blob.size_bytes,
      media_type: "text/markdown",
      primary: true,
      content: { kind: "prepared", blob },
    }],
    source: null,
    idempotency_key: "first-save",
  });
  assertEquals(prepared.status, 200, JSON.stringify(prepared.body));
  const files = prepared.body["files"] as { preparation_ref: string }[];
  const saved = await post(opened, "documents/save", {
    input: prepared.body,
    idempotency_key: "first-save",
    compare: { base_version: null },
    prepared: [
      String(prepared.body["preparation_ref"]),
      ...files.map((file) => file.preparation_ref),
    ],
  });
  assertEquals(saved.status, 200, JSON.stringify(saved.body));
  return String(saved.body["version"]);
}

// 그 판 파일의 원본 참조. 저장이 등록한 blob 참조다.
async function reference(home: string, version: string, text: string) {
  const registered = ledger(
    home,
    (db) =>
      (db.prepare(
        `SELECT registered_seq AS seq FROM blob_refs
         WHERE owner_kind = 'document_version' AND owner_key = ? AND field = 'file'`,
      ).get(`${version}/note.md`) as { seq: number | string }).seq,
  );
  return {
    owner_kind: "document_version",
    owner_key: `${version}/note.md`,
    field: "file",
    hash: await sha(text),
    registered_seq: String(registered),
  };
}

type DocumentRow = {
  id: string;
  place_kind: string | null;
  place_id: string | null;
  name: string | null;
  source_path: string | null;
  source_project: string | null;
};

function documents(home: string): DocumentRow[] {
  return ledger(home, (db) =>
    db.prepare(
      `SELECT id, place_kind, place_id, name, source_path, source_project
       FROM documents ORDER BY id`,
    ).all() as unknown as DocumentRow[]);
}

function versionCount(home: string): number {
  return ledger(home, (db) =>
    Number(
      (db.prepare("SELECT COUNT(*) AS n FROM versions").get() as {
        n: number | bigint;
      }).n,
    ));
}

function eventTypes(home: string): string[] {
  return ledger(
    home,
    (db) =>
      (db.prepare("SELECT type FROM events ORDER BY seq").all() as {
        type: string;
      }[]).map((row) => row.type),
  );
}

function patterns(home: string): { effect: string; glob: string }[] {
  return ledger(home, (db) =>
    db.prepare(
      `SELECT effect, glob FROM project_tracking_patterns
       WHERE project = ? ORDER BY position`,
    ).all(PROJECT) as unknown as { effect: string; glob: string }[]);
}

async function placeRequest(
  opened: Opened,
  version: string,
  text: string,
  name: string,
  key: string,
) {
  return {
    request_key: key,
    target: {
      kind: "project_file" as const,
      project: PROJECT,
      path: `${opened.folder}/${name}`,
    },
    base_hash: null,
    content: {
      kind: "existing" as const,
      reference: await reference(opened.home, version, text),
    },
    place: { document: DOC, version },
  };
}

async function confirmed(
  opened: Opened,
  input: Json,
  window: string,
): Promise<string> {
  const binding = await confirmationBinding(filesDelete, input as never);
  assert(binding && opened.core.confirmation);
  const issued = await opened.core.confirmation({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: window,
      target_ref: binding.target,
      content_hash: binding.content,
      allowed_decisions: [FILE_DELETE_DECISION],
      expires_at: new Date(Date.UTC(2024, 0, 1) + 600_000).toISOString(),
    },
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  return (issued.value as { confirmation: string }).confirmation;
}

const SETTLE_MS = 3_000;
const settle = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

Deno.test("documents/file-tracking#R13 documents/projects#R12: 패턴 밖 경로에 두면 그 파일 하나의 include가 들어가고 원본 연결·자리·event가 각각 확정되며 관측이 문서를 하나 더 만들지 않는다", async () => {
  const opened = await open();
  const { home, folder } = opened;
  try {
    const text = "# note\n\nsaved before it became a file\n";
    const version = await saveDocument(opened, text);
    await track(opened);
    await ready(opened);
    assertEquals(documents(home).length, 1);
    const request = await placeRequest(opened, version, text, "note.txt", "p1");
    const placed = await post(opened, "files/write", request);
    assertEquals(placed.status, 200, JSON.stringify(placed.body));
    assertEquals(placed.body["outcome"], "written");
    assertEquals(placed.body["written_hash"], await sha(text));
    assertEquals(placed.body["recording"], "recorded");
    assertEquals(placed.body["placement"], {
      source: { state: "done" },
      tracking: { state: "done" },
      move: { state: "done" },
    });
    assertEquals(await Deno.readTextFile(`${folder}/note.txt`), text);
    const names: string[] = [];
    for await (const entry of Deno.readDir(folder)) names.push(entry.name);
    assertEquals(names, ["note.txt"]);
    // 연결·자리: 문서는 그 프로젝트의 자리에 있고 그 파일에 연결된다.
    const rows = documents(home);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].source_path, `${folder}/note.txt`);
    assertEquals(rows[0].source_project, PROJECT);
    assertEquals([rows[0].place_kind, rows[0].place_id], ["project", PROJECT]);
    assertNotEquals(rows[0].name, null);
    // 추적 규칙은 그 파일 하나의 include가 끝에 더해졌다.
    assertEquals(patterns(home), [
      { effect: "include", glob: "**/*.md" },
      { effect: "include", glob: "note.txt" },
    ]);
    // 파일 쓰기와 연결 확정이 각각 event 하나다. 원본 연결이 추적 규칙보다 먼저다.
    const types = eventTypes(home);
    assert(types.includes("FileWritten"));
    const order = [
      "FileWritten",
      "DocumentSourceChanged",
      "ProjectTrackingChanged",
      "DocumentMoved",
    ]
      .map((type) => types.lastIndexOf(type));
    assert(order.every((at) => at >= 0));
    assertEquals([...order].sort((a, b) => a - b), order);
    // 이제 추적되는 그 파일을 관측이 보지만 같은 내용이라 새 문서도 새 판도 만들지 않는다.
    await settle();
    assertEquals(documents(home).length, 1);
    // 판의 파일 이름이 note.md에서 note.txt로 달라져 관측이 같은 문서의 새 판을 하나 더할 수 있다.
    assert(versionCount(home) >= 1);
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/file-tracking#R13: 패턴 안 경로에 두는 동안 같은 경로의 관측이 새 문서를 만들지 못해 문서와 연결은 정확히 하나다", async () => {
  const opened = await open();
  const { home, folder } = opened;
  try {
    const text = "# note\n\nin the pattern\n";
    const version = await saveDocument(opened, text);
    await track(opened);
    await ready(opened);
    const request = await placeRequest(opened, version, text, "note.md", "p2");
    const placed = await post(opened, "files/write", request);
    assertEquals(placed.status, 200, JSON.stringify(placed.body));
    // 규칙 안이라 추적 규칙은 건드리지 않는다.
    assertEquals(
      (placed.body["placement"] as Json)["tracking"],
      { state: "skipped", reason: "the file is already tracked" },
    );
    assertEquals(patterns(home), [{ effect: "include", glob: "**/*.md" }]);
    // 관측 loop가 이 파일을 여러 번 보도록 기다려도 문서와 판은 그대로다.
    await settle();
    await settle();
    const rows = documents(home);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].source_path, `${folder}/note.md`);
    assertEquals(versionCount(home), 1);
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/file-tracking#R13: 이미 있는 파일 위·낡은 판·위조된 참조·다른 문서의 판에는 두지 않고 아무것도 바꾸지 않는다", async () => {
  const opened = await open();
  const { home, folder } = opened;
  try {
    const text = "# note\n\none\n";
    const version = await saveDocument(opened, text);
    await track(opened);
    await ready(opened);
    await Deno.writeTextFile(`${folder}/taken.md`, "already here");
    const occupied = await post(
      opened,
      "files/write",
      await placeRequest(opened, version, text, "taken.md", "p3"),
    );
    assertEquals(occupied.status, 409, JSON.stringify(occupied.body));
    assertEquals(await Deno.readTextFile(`${folder}/taken.md`), "already here");
    // 이 문서의 판이 아닌 판을 가리키면 conflict(낡은 판)가 아니라 같은 invalid_input이다.
    const request = await placeRequest(opened, version, text, "x.md", "p4");
    const forged = await post(opened, "files/write", {
      ...request,
      content: {
        kind: "existing",
        reference: { ...request.content.reference, hash: await sha("other") },
      },
    });
    assertEquals(forged.status, 400, JSON.stringify(forged.body));
    const stale = await post(opened, "files/write", {
      ...request,
      place: { document: DOC, version: "ver_01kq12a1pha0000000000000zz" },
    });
    assert(stale.status === 400 || stale.status === 409, String(stale.status));
    const names: string[] = [];
    for await (const entry of Deno.readDir(folder)) names.push(entry.name);
    assertEquals(names, ["taken.md"]);
    assertEquals(documents(home)[0].source_path, null);
    assertEquals(documents(home)[0].place_kind, null);
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/file-tracking#R14: 확인한 디스크 내용이 최신 판과 같으면 파일을 지우고 연결을 풀고 자리를 되돌린다", async () => {
  const opened = await open();
  const { home, folder } = opened;
  try {
    const text = "# note\n\nto be taken out\n";
    const version = await saveDocument(opened, text);
    await track(opened);
    await ready(opened);
    const placed = await post(
      opened,
      "files/write",
      await placeRequest(opened, version, text, "out.md", "p5"),
    );
    assertEquals(placed.status, 200, JSON.stringify(placed.body));
    const input = {
      request_key: "d1",
      target: {
        kind: "project_file" as const,
        project: PROJECT,
        path: `${folder}/out.md`,
      },
      base_hash: await sha(text),
      unlink: { document: DOC },
    };
    // 확인 없이는 403이고 아무것도 바뀌지 않는다.
    const unconfirmed = await post(opened, "files/delete", input);
    assertEquals(unconfirmed.status, 403);
    assertEquals(await Deno.readTextFile(`${folder}/out.md`), text);
    const confirmation = await confirmed(opened, input, "win-unlink");
    const removed = await post(opened, "files/delete", {
      ...input,
      confirmation,
    });
    assertEquals(removed.status, 200, JSON.stringify(removed.body));
    assertEquals(removed.body["outcome"], "deleted");
    assertEquals(removed.body["recording"], "recorded");
    assertEquals(removed.body["unlinking"], {
      source: { state: "done" },
      move: { state: "done" },
    });
    const gone = await Deno.stat(`${folder}/out.md`).then(
      () => false,
      () => true,
    );
    assert(gone);
    const rows = documents(home);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].source_path, null);
    assertEquals(rows[0].place_kind, null);
    assertEquals(rows[0].name, null);
    assert(eventTypes(home).includes("FileDeleted"));
    // 문서와 판은 그대로 남는다(영구 삭제가 아니다).
    assertEquals(versionCount(home), 1);
    // 확인 handle은 한 번만 쓴다.
    const reused = await post(opened, "files/delete", {
      ...input,
      confirmation,
    });
    assertEquals(reused.status, 403);
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/file-tracking#R14: 파일이 바뀌어 있으면 409고 파일·연결·자리는 그대로다", async () => {
  const opened = await open();
  const { home, folder } = opened;
  try {
    const text = "# note\n\noriginal\n";
    const version = await saveDocument(opened, text);
    await track(opened);
    await ready(opened);
    const placed = await post(
      opened,
      "files/write",
      await placeRequest(opened, version, text, "keep.md", "p6"),
    );
    assertEquals(placed.status, 200, JSON.stringify(placed.body));
    const before = documents(home);
    // 사람이 확인한 뒤 다른 프로그램이 파일을 고쳤다.
    const edited = "# note\n\nedited meanwhile\n";
    await Deno.writeTextFile(`${folder}/keep.md`, edited);
    const input = {
      request_key: "d2",
      target: {
        kind: "project_file" as const,
        project: PROJECT,
        path: `${folder}/keep.md`,
      },
      base_hash: await sha(text),
      unlink: { document: DOC },
    };
    const refused = await post(opened, "files/delete", {
      ...input,
      confirmation: await confirmed(opened, input, "win-refused"),
    });
    assertEquals(refused.status, 409, JSON.stringify(refused.body));
    assertEquals(await Deno.readTextFile(`${folder}/keep.md`), edited);
    assertEquals(documents(home), before);
    assert(!eventTypes(home).includes("FileDeleted"));
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/file-tracking#R13 documents/file-tracking#R14: user가 아닌 자격은 두기·빼기 모두 403이고 아무것도 바뀌지 않는다", async () => {
  const opened = await open();
  const { home, folder } = opened;
  try {
    const text = "# note\n\nagent cannot place\n";
    const version = await saveDocument(opened, text);
    await track(opened);
    await ready(opened);
    const request = await placeRequest(opened, version, text, "agent.md", "p7");
    const placed = await post(opened, "files/write", request, AGENT);
    assertEquals(placed.status, 403, JSON.stringify(placed.body));
    const unlinked = await post(opened, "files/delete", {
      request_key: "d4",
      target: request.target,
      base_hash: await sha(text),
      unlink: { document: DOC },
    }, AGENT);
    assertEquals(unlinked.status, 403, JSON.stringify(unlinked.body));
    const names: string[] = [];
    for await (const entry of Deno.readDir(folder)) names.push(entry.name);
    assertEquals(names, []);
    assertEquals(documents(home)[0].source_path, null);
    assertEquals(
      eventTypes(home).filter((type) => type.startsWith("File")),
      [],
    );
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/file-tracking#R13: 원본 연결 command 범위가 없는 사람 자격은 파일만 만들고 연결 단계 실패가 파일 결과와 따로 보인다", async () => {
  const opened = await open();
  const { home, folder } = opened;
  try {
    const text = "# note\n\nlimited scope\n";
    const version = await saveDocument(opened, text);
    await track(opened);
    await ready(opened);
    const placed = await post(
      opened,
      "files/write",
      await placeRequest(opened, version, text, "limited.md", "p8"),
      LIMITED,
    );
    assertEquals(placed.status, 200, JSON.stringify(placed.body));
    assertEquals(placed.body["outcome"], "written");
    const steps = placed.body["placement"] as {
      source: { state: string; error?: { code: string } };
      tracking: { state: string };
      move: { state: string };
    };
    assertEquals(steps.source.state, "failed");
    assertEquals(steps.source.error?.code, "forbidden");
    assertEquals(steps.tracking.state, "not_attempted");
    assertEquals(steps.move.state, "not_attempted");
    // 파일은 남고 문서는 연결되지 않았다.
    assertEquals(await Deno.readTextFile(`${folder}/limited.md`), text);
    assertEquals(documents(home)[0].source_path, null);
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/file-tracking#R14: 이미 없어진 파일은 지울 것 없이 연결을 풀고 지운 작업의 event는 없다", async () => {
  const opened = await open();
  const { home, folder } = opened;
  try {
    const text = "# note\n\nthe file is already gone\n";
    const version = await saveDocument(opened, text);
    await track(opened);
    await ready(opened);
    const placed = await post(
      opened,
      "files/write",
      await placeRequest(opened, version, text, "note.md", "p9"),
    );
    assertEquals(placed.status, 200, JSON.stringify(placed.body));
    await Deno.remove(`${folder}/note.md`);
    const input = {
      request_key: "d5",
      target: {
        kind: "project_file" as const,
        project: PROJECT,
        path: `${folder}/note.md`,
      },
      base_hash: await sha(text),
      unlink: { document: DOC },
    };
    const removed = await post(opened, "files/delete", {
      ...input,
      confirmation: await confirmed(opened, input, "win-absent"),
    });
    assertEquals(removed.status, 200, JSON.stringify(removed.body));
    // 지운 작업이 없었다: 결과는 unverified고 기록·event가 없다.
    assertEquals(removed.body["outcome"], "unverified");
    assertEquals(removed.body["recording"], "unverified");
    assertEquals(removed.body["unlinking"], {
      source: { state: "done" },
      move: { state: "done" },
    });
    assertEquals(documents(home)[0].source_path, null);
    assertEquals(documents(home)[0].place_kind, null);
    assert(!eventTypes(home).includes("FileDeleted"));
  } finally {
    await opened.dispose();
  }
});
