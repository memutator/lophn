// documents/file-tracking#R3·R4·R6·R7, documents/versions#R13: 실제 core가 실제 documents
// worker를 띄우고, 등록한 임시 폴더의 파일 편집이 새 Version이 된다. tracking 규칙과 경로→
// 문서 연결은 core가 감독 pipe로 보낸다(Q15). 데이터 root와 폴더는 모두 temp dir다.
// 사람 데이터 root(~/.lophn, ~/.config/lophn)는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import { previewTracking } from "../../packages/documents/projects/work.ts";
import { directoryScanner } from "../../packages/documents/projects/scan.ts";
import { type Core, startCore } from "./core.ts";
import { createLedgerRegistration } from "./documents.ts";

const PROJECT = "prj_01kq12a1pha000000000000000";
const TOKEN = "d".repeat(43);

type Json = Record<string, unknown>;

async function post(
  core: Core,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Json }> {
  const response = await fetch(`http://127.0.0.1:${core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Json };
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

async function until<T>(
  what: string,
  read: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 40_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await read();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out: ${what}`);
}

type VersionRow = { number: number; document: string; source: string | null };

function versions(home: string): VersionRow[] {
  return ledger(home, (db) =>
    db.prepare(
      "SELECT number, document, source FROM versions ORDER BY document, number",
    ).all() as unknown as VersionRow[]);
}

// 임시 data root 위에 core를 띄우고 사람 token을 받아 둔다. 같은 home으로 다시 띄워 재시작을
// 흉내 낼 수 있다(credential_ref만 다르게 준다).
async function startCoreAt(
  home: string,
  ref: string,
  restart = false,
  // 같은 seed는 같은 credential_ref를 만든다. 재시작은 다른 seed를 준다.
  seed = 11,
  // core의 fake clock 시작 시각. 시간이 지난 뒤의 재시작을 흉내 낸다.
  startMs = Date.UTC(2024, 0, 1),
): Promise<Core> {
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createLedgerRegistration }],
    teamModules: [new URL("./documents.ts", import.meta.url).href],
    clock: manualClock(startMs),
    random: seededRandom(seed),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  const context = {
    principal: "user",
    actor: "user" as const,
    credential_ref: ref,
    scope: {
      operations: [
        "project.create",
        "project.set_tracking",
        "files.status",
        "document.move",
        "document.export",
        "document.file",
        "blobs/read",
      ],
      targets: {},
    },
    conditions: {},
  };
  assert(core.acceptTestCredential);
  const accepted = await core.acceptTestCredential(context, TOKEN);
  assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
  // 재시작이면 credential 기록은 ledger에 이미 있다.
  if (!restart) {
    const recorded = await core.record(context);
    assert(recorded.ok, recorded.ok ? "" : recorded.error.message);
  }
  return core;
}

async function openTrackedFolder(
  files: Record<string, string>,
): Promise<{ core: Core; home: string; folder: string }> {
  const home = await Deno.makeTempDir({ prefix: "lophn-docs-observe-" });
  // watch가 심볼릭 링크 경로를 돌려주지 않게 canonical 경로로 등록한다.
  const folder = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-docs-observe-folder-" }),
  );
  for (const [name, text] of Object.entries(files)) {
    await Deno.writeTextFile(`${folder}/${name}`, text);
  }
  const core = await startCoreAt(home, "cred_observe_person");
  // 사람이 프로젝트를 만들고 tracking을 켠다. 미리보기는 준비 worker가 아직 없어
  // (documents#T11 남은 것) 같은 계산을 시험이 직접 하고, 적용 command는 실제로 낸다.
  const created = await post(core, "projects/create", {
    input: {
      id: PROJECT,
      name: "alpha",
      title: "Alpha",
      purpose: "",
      folders: [{ path: folder, description: "a" }],
      tracking: { enabled: false, patterns: [], use_gitignore: false },
    },
    idempotency_key: "create-alpha",
    compare: {},
    prepared: [],
  });
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const revision = String(created.body["revision"]);
  const folders = [{ path: folder, description: "a" }];
  const tracking = {
    enabled: true,
    patterns: [{ effect: "include" as const, glob: "**/*.md" }],
    use_gitignore: false,
  };
  const preview = previewTracking(directoryScanner(), {
    project: PROJECT,
    baseRevision: revision,
    folders,
    tracking,
    observedAt: "2026-10-06T00:00:00.000Z",
  });
  assert(preview.ok);
  const applied = await post(core, "projects/set_tracking", {
    input: { project: PROJECT, folders, tracking, preview: preview.value },
    idempotency_key: "track-alpha",
    compare: { base_revision: revision },
    prepared: [],
  });
  assertEquals(applied.status, 200, JSON.stringify(applied.body));
  return { core, home, folder };
}

async function close(
  opened: { core: Core; home: string; folder: string },
): Promise<void> {
  await opened.core.shutdown();
  await Deno.remove(opened.home, { recursive: true });
  await Deno.remove(opened.folder, { recursive: true });
}

Deno.test("documents/file-tracking#R4 documents/versions#R13: 등록 폴더의 파일 편집이 실제 worker를 거쳐 새 Version이 된다", async () => {
  const opened = await openTrackedFolder({
    "a.md": "# a\n\none\n",
    "skip.txt": "규칙에 없는 파일",
  });
  const { core, home, folder } = opened;
  try {
    // 처음 관측한 파일은 그 파일에 연결된 새 문서의 첫 판이다.
    const first = await until("first version", () => {
      const rows = versions(home);
      return rows.length === 1 ? rows : undefined;
    });
    assertEquals(first[0].number, 1);
    const source = JSON.parse(first[0].source ?? "null") as {
      kind: string;
      path: string;
      project: string;
    };
    assertEquals(source.kind, "file");
    assertEquals(source.path, `${folder}/a.md`);
    assertEquals(source.project, PROJECT);
    const linked = ledger(home, (db) =>
      db.prepare(
        "SELECT id, source_kind, source_project, source_path FROM documents",
      ).all() as unknown as Json[]);
    assertEquals(linked.length, 1);
    assertEquals(linked[0]["source_path"], `${folder}/a.md`);
    assertEquals(linked[0]["source_project"], PROJECT);

    // 같은 파일을 고치면 같은 문서의 다음 판이다. 새 문서가 생기지 않는다.
    await Deno.writeTextFile(`${folder}/a.md`, "# a\n\ntwo\n");
    const second = await until("second version", () => {
      const rows = versions(home);
      return rows.length === 2 ? rows : undefined;
    });
    assertEquals(second.map((row) => row.number), [1, 2]);
    assertEquals(second[0].document, second[1].document);
    const documents = ledger(
      home,
      (db) =>
        db.prepare("SELECT COUNT(*) AS count FROM documents").get() as Json,
    );
    assertEquals(documents["count"], 1);

    // 새로 생긴 파일은 다른 문서가 된다.
    await Deno.writeTextFile(`${folder}/b.md`, "# b\n");
    const third = await until("third version", () => {
      const rows = versions(home);
      return rows.length === 3 ? rows : undefined;
    });
    assertEquals(new Set(third.map((row) => row.document)).size, 2);

    // 규칙(`**/*.md`)에 없는 파일은 관측하지 않는다.
    const linkedPaths = ledger(
      home,
      (db) =>
        (db.prepare("SELECT source_path FROM documents ORDER BY source_path")
          .all() as unknown as Json[]).map((row) => row["source_path"]),
    );
    assertEquals(linkedPaths, [`${folder}/a.md`, `${folder}/b.md`]);

    // FileStatus는 마지막 관측이 최신 판과 같다고 말한다.
    const state = await until("tracked status", async () => {
      const answered = await post(core, "files/status", {
        target: {
          kind: "project_file",
          project: PROJECT,
          path: `${folder}/a.md`,
        },
      });
      const body = answered.body as { status?: { state?: string } };
      return body.status?.state === "tracked" ? "tracked" : undefined;
    });
    assertEquals(state, "tracked");
  } finally {
    await close(opened);
  }
});

Deno.test("documents/file-tracking#R10: core를 다시 띄워도 같은 내용의 파일은 새 판을 만들지 않고 추적 중으로 돌아온다", async () => {
  const opened = await openTrackedFolder({ "a.md": "# a\n\none\n" });
  const { home, folder } = opened;
  let core = opened.core;
  try {
    await until("first version", () => {
      const rows = versions(home);
      return rows.length === 1 ? rows : undefined;
    });
    await core.shutdown();
    // 같은 data root와 폴더로 다시 시작한다. 시작 때 전체 대조가 파일을 다시 읽는다.
    core = await startCoreAt(home, "cred_observe_person", true, 12);
    opened.core = core;
    const state = await until("tracked after restart", async () => {
      const answered = await post(core, "files/status", {
        target: {
          kind: "project_file",
          project: PROJECT,
          path: `${folder}/a.md`,
        },
      });
      const body = answered.body as { status?: { state?: string } };
      return body.status?.state === "tracked" ? "tracked" : undefined;
    });
    assertEquals(state, "tracked");
    // 다시 읽어도 최신 판의 원본 hash와 같으면 판은 늘지 않는다.
    assertEquals(versions(home).length, 1);
    // 꺼진 동안 고친 파일은 켜진 뒤 현재 내용의 새 판이 된다.
    await core.shutdown();
    await Deno.writeTextFile(`${folder}/a.md`, "# a\n\n꺼진 동안 고침\n");
    core = await startCoreAt(home, "cred_observe_person", true, 13);
    opened.core = core;
    const second = await until("version after offline edit", () => {
      const rows = versions(home);
      return rows.length === 2 ? rows : undefined;
    });
    assertEquals(second.map((row) => row.number), [1, 2]);
  } finally {
    await close(opened);
  }
});

// ---- 관측한 판의 원문 blob 등록(Q16) ----

const DAY_MS = 24 * 60 * 60 * 1000;
const START_MS = Date.UTC(2024, 0, 1);

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

type FileRef = { owner_key: string; field: string; hash: string };

function fileRefs(home: string): FileRef[] {
  return ledger(home, (db) =>
    db.prepare(
      `SELECT owner_key, field, hash FROM blob_refs
       WHERE owner_kind = 'document_version' ORDER BY owner_key, field`,
    ).all() as unknown as FileRef[]);
}

function versionFileCount(home: string): number {
  return Number(ledger(
    home,
    (db) =>
      (db.prepare("SELECT COUNT(*) AS count FROM version_files").get() as Json)[
        "count"
      ],
  ));
}

function firstVersion(home: string): { id: string; document: string } {
  return ledger(
    home,
    (db) =>
      db.prepare("SELECT id, document FROM versions ORDER BY number").get() as {
        id: string;
        document: string;
      },
  );
}

async function send(
  core: Core,
  path: string,
  body: unknown,
  token = TOKEN,
): Promise<{ status: number; body: Json }> {
  const response = await fetch(`http://127.0.0.1:${core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Json };
}

function readOriginal(
  core: Core,
  owner_key: string,
  length: number,
  token = TOKEN,
): Promise<{ status: number; body: Json }> {
  return send(core, "blobs/read", {
    owner_kind: "document_version",
    owner_key,
    field: "file",
    offset_bytes: 0,
    length_bytes: length,
  }, token);
}

function decoded(body: Json): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(String(body["bytes"])), (c) => c.charCodeAt(0)),
  );
}

Deno.test("documents/versions#R5 #R8: 관측한 판의 원문 blob은 준비 참조 수명(10분)이 지나도 등록된 채 남아 읽힌다", async () => {
  const text = "# a\n\n관측한 원문\n";
  const bytes = new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
  const opened = await openTrackedFolder({ "a.md": text });
  const { home } = opened;
  let core = opened.core;
  try {
    await until("first version", () => {
      const rows = versions(home);
      return rows.length === 1 ? rows : undefined;
    });
    const hash = await sha256Hex(bytes);
    const version = firstVersion(home).id;
    // save가 같은 tx에서 판의 파일 행과 경로별 원문 blob 참조를 남겼다.
    const rows = ledger(home, (db) =>
      db.prepare(
        `SELECT path, blob_hash, bytes, media_type, primary_file
         FROM version_files WHERE version = ?`,
      ).all(version) as unknown as Json[]);
    assertEquals(rows, [{
      path: "a.md",
      blob_hash: hash,
      bytes: bytes.length,
      media_type: "text/markdown",
      primary_file: 1,
    }]);
    const refs = fileRefs(home);
    assert(
      refs.some((ref) =>
        ref.owner_key === `${version}/a.md` && ref.field === "file" &&
        ref.hash === hash
      ),
      JSON.stringify(refs),
    );
    const now = await readOriginal(core, `${version}/a.md`, bytes.length);
    assertEquals(now.status, 200, JSON.stringify(now.body));
    assertEquals(now.body["status"], "available");
    assertEquals(decoded(now.body), text);

    // 준비 참조 수명(10분)을 한참 넘긴 fake clock으로 두 번 정지·재시작한다. 정지 때의
    // blob 회수는 미참조로 처음 확인한 뒤 7일이 지난 blob만 지운다. 등록하지 않았다면
    // 원문은 첫 정지에서 미참조로 확인되고 두 번째 정지에서 지워진다.
    await core.shutdown();
    core = await startCoreAt(
      home,
      "cred_observe_person",
      true,
      21,
      START_MS + 8 * DAY_MS,
    );
    opened.core = core;
    await core.shutdown();
    core = await startCoreAt(
      home,
      "cred_observe_person",
      true,
      22,
      START_MS + 16 * DAY_MS,
    );
    opened.core = core;
    const later = await readOriginal(core, `${version}/a.md`, bytes.length);
    assertEquals(later.status, 200, JSON.stringify(later.body));
    assertEquals(later.body["status"], "available");
    assertEquals(decoded(later.body), text);
    // 같은 내용의 파일은 다시 읽어도 판이 늘지 않는다.
    assertEquals(versions(home).length, 1);
  } finally {
    await close(opened);
  }
});

Deno.test("documents/versions#R3: 같은 내용을 다시 쓴 파일은 새 판도 새 blob 참조도 만들지 않는다", async () => {
  const text = "# a\n\n같은 내용\n";
  const opened = await openTrackedFolder({ "a.md": text });
  const { home, folder } = opened;
  try {
    await until("first version", () => {
      const rows = versions(home);
      return rows.length === 1 ? rows : undefined;
    });
    const before = fileRefs(home);
    const rowsBefore = versionFileCount(home);
    // 같은 내용을 다시 쓰고(mtime만 바뀐다) 다른 파일이 새 판이 될 때까지 기다려 관측이
    // 한 바퀴 돈 것을 확인한다.
    await Deno.writeTextFile(`${folder}/a.md`, text);
    await Deno.writeTextFile(`${folder}/marker.md`, "# marker\n");
    await until("marker version", () => {
      const rows = versions(home);
      return rows.length === 2 ? rows : undefined;
    });
    const after = fileRefs(home);
    // a.md 판의 참조는 그대로고 새로 생긴 것은 marker 판의 목록·원문 참조 둘뿐이다.
    for (const ref of before) {
      assert(after.some((r) => r.owner_key === ref.owner_key));
    }
    assertEquals(after.length, before.length + 2);
    assertEquals(versionFileCount(home), rowsBefore + 1);
    const perDocument = versions(home).filter((row) =>
      row.document === firstVersion(home).document
    );
    assertEquals(perDocument.length, 1);
  } finally {
    await close(opened);
  }
});

Deno.test("documents/versions#R16: export는 관측한 판의 원문 파일(경로·hash·바이트 수·MIME)을 포함한다", async () => {
  const text = "# a\n\nexport 원문\n";
  const bytes = new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
  const opened = await openTrackedFolder({ "a.md": text });
  const { core, home } = opened;
  try {
    await until("first version", () => {
      const rows = versions(home);
      return rows.length === 1 ? rows : undefined;
    });
    const { id: version, document } = firstVersion(home);
    const revision = ledger(
      home,
      (db) =>
        (db.prepare("SELECT revision FROM documents WHERE id = ?").get(
          document,
        ) as { revision: string }).revision,
    );
    // 관측한 문서는 자리가 없다. export는 사람이 고른 자리의 문서만 묶으므로 먼저 옮긴다.
    const moved = await send(core, "documents/move", {
      input: {
        document,
        place: { kind: "project", id: PROJECT },
        name: "alpha-a",
      },
      idempotency_key: "move-a",
      compare: { base_revision: revision },
      prepared: [],
    });
    assertEquals(moved.status, 200, JSON.stringify(moved.body));
    const exported = await send(core, "documents/export", {
      place: { kind: "project", id: PROJECT },
      documents: [{ document, version }],
      format: "json",
    });
    assertEquals(exported.status, 200, JSON.stringify(exported.body));
    const entries = exported.body["documents"] as {
      version: { files: Json[] };
    }[];
    assertEquals(entries.length, 1);
    assertEquals(entries[0].version.files, [{
      path: "a.md",
      blob_hash: await sha256Hex(bytes),
      bytes: bytes.length,
      media_type: "text/markdown",
      primary: true,
    }]);
    // 그 파일의 원문 바이트가 등록된 blob으로 읽힌다.
    const original = await readOriginal(core, `${version}/a.md`, bytes.length);
    assertEquals(decoded(original.body), text);
  } finally {
    await close(opened);
  }
});

Deno.test("documents/versions#R8: 범위 밖 자격이 관측한 판을 읽는 답은 없는 판과 같다", async () => {
  const text = "# a\n\n범위 밖\n";
  const bytes = new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
  const opened = await openTrackedFolder({ "a.md": text });
  const { core, home } = opened;
  try {
    await until("first version", () => {
      const rows = versions(home);
      return rows.length === 1 ? rows : undefined;
    });
    const { id: version, document } = firstVersion(home);
    // 다른 문서와 다른 판 key만 닿는 자격이다.
    const limited = "e".repeat(43);
    const context = {
      principal: "user-2",
      actor: "user" as const,
      credential_ref: "cred_observe_limited",
      scope: {
        operations: ["document.export", "blobs/read"],
        targets: {
          document: "doc_01arz3ndektsv4rrffq69g5fb0",
          owner_key: "ver_01arz3ndektsv4rrffq69g5fb1/a.md",
        },
      },
      conditions: {},
    };
    assert(core.acceptTestCredential);
    const accepted = await core.acceptTestCredential(context, limited);
    assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    const recorded = await core.record(context);
    assert(recorded.ok, recorded.ok ? "" : recorded.error.message);

    const hidden = await readOriginal(
      core,
      `${version}/a.md`,
      bytes.length,
      limited,
    );
    const absent = await readOriginal(
      core,
      "ver_01arz3ndektsv4rrffq69g5fb9/a.md",
      bytes.length,
      limited,
    );
    assertEquals(hidden.status, absent.status);
    assertEquals(hidden.body, absent.body);
    assert(hidden.body["status"] !== "available");

    const exportBody = (doc: string, ver: string) => ({
      place: { kind: "project", id: PROJECT },
      documents: [{ document: doc, version: ver }],
      format: "json",
    });
    const hiddenExport = await send(
      core,
      "documents/export",
      exportBody(document, version),
      limited,
    );
    const absentExport = await send(
      core,
      "documents/export",
      exportBody(
        "doc_01arz3ndektsv4rrffq69g5fb9",
        "ver_01arz3ndektsv4rrffq69g5fb9",
      ),
      limited,
    );
    assertEquals(hiddenExport.status, absentExport.status);
    assertEquals(hiddenExport.body, absentExport.body);
    assert(hiddenExport.status !== 200);
  } finally {
    await close(opened);
  }
});

async function expectOriginals(
  core: Core,
  home: string,
  document: string,
  texts: string[],
): Promise<void> {
  const rows = ledger(home, (db) =>
    db.prepare(
      "SELECT id, number FROM versions WHERE document = ? ORDER BY number",
    ).all(document) as unknown as { id: string; number: number }[]);
  assertEquals(rows.length, texts.length);
  for (const [index, row] of rows.entries()) {
    const bytes = new TextEncoder().encode(texts[index]);
    const read = await readOriginal(core, `${row.id}/a.md`, bytes.length);
    assertEquals(read.status, 200, JSON.stringify(read.body));
    assertEquals(read.body["status"], "available");
    assertEquals(decoded(read.body), texts[index]);
    const files = ledger(home, (db) =>
      db.prepare(
        "SELECT blob_hash, bytes FROM version_files WHERE version = ?",
      ).all(row.id) as unknown as Json[]);
    assertEquals(files, [{
      blob_hash: await sha256Hex(bytes as Uint8Array<ArrayBuffer>),
      bytes: bytes.length,
    }]);
  }
}

Deno.test("documents/versions#R5 #R8: 파일을 A→B→A로 빠르게 고쳐도 세 판 모두 원문이 읽힌다", async () => {
  const a = "# a\n\n처음 내용\n";
  const b = "# a\n\n고친 내용\n";
  const opened = await openTrackedFolder({ "a.md": a });
  const { core, home, folder } = opened;
  try {
    await until("version 1", () => {
      const rows = versions(home);
      return rows.length === 1 ? rows : undefined;
    });
    // 준비 참조 수명(10분) 안에 같은 바이트(A)로 되돌린다. 같은 준비를 다시 쓴다.
    await Deno.writeTextFile(`${folder}/a.md`, b);
    await until("version 2", () => {
      const rows = versions(home);
      return rows.length === 2 ? rows : undefined;
    });
    await Deno.writeTextFile(`${folder}/a.md`, a);
    const all = await until("version 3", () => {
      const rows = versions(home);
      return rows.length === 3 ? rows : undefined;
    });
    assertEquals(all.map((row) => row.number), [1, 2, 3]);
    assertEquals(new Set(all.map((row) => row.document)).size, 1);
    await expectOriginals(core, home, all[0].document, [a, b, a]);
  } finally {
    await close(opened);
  }
});

Deno.test("documents/versions#R5 #R8: 시간이 지난 뒤 옛 바이트로 되돌린 판도 원문이 읽힌다", async () => {
  const a = "# a\n\n처음 내용\n";
  const b = "# a\n\n고친 내용\n";
  const opened = await openTrackedFolder({ "a.md": a });
  const { home, folder } = opened;
  let core = opened.core;
  try {
    await until("version 1", () => {
      const rows = versions(home);
      return rows.length === 1 ? rows : undefined;
    });
    await Deno.writeTextFile(`${folder}/a.md`, b);
    await until("version 2", () => {
      const rows = versions(home);
      return rows.length === 2 ? rows : undefined;
    });
    // 한참 뒤(fake clock +1일, 준비 참조는 core 재시작으로도 사라진다) A로 되돌린다.
    await core.shutdown();
    core = await startCoreAt(
      home,
      "cred_observe_person",
      true,
      31,
      START_MS + DAY_MS,
    );
    opened.core = core;
    await Deno.writeTextFile(`${folder}/a.md`, a);
    const all = await until("version 3", () => {
      const rows = versions(home);
      return rows.length === 3 ? rows : undefined;
    });
    await expectOriginals(core, home, all[0].document, [a, b, a]);
  } finally {
    await close(opened);
  }
});

Deno.test("documents/versions#R5 #R8: 내용이 같은 두 파일은 다른 문서로 모두 저장되고 각자 원문을 가진다", async () => {
  const text = "# same\n\n같은 내용\n";
  const bytes = new TextEncoder().encode(text);
  const opened = await openTrackedFolder({ "a.md": text, "b.md": text });
  const { core, home } = opened;
  try {
    const all = await until("two versions", () => {
      const rows = versions(home);
      return rows.length === 2 ? rows : undefined;
    });
    assertEquals(new Set(all.map((row) => row.document)).size, 2);
    const hash = await sha256Hex(bytes as Uint8Array<ArrayBuffer>);
    for (
      const row of ledger(
        home,
        (db) =>
          db.prepare("SELECT id FROM versions").all() as unknown as {
            id: string;
          }[],
      )
    ) {
      const files = ledger(home, (db) =>
        db.prepare(
          "SELECT path, blob_hash FROM version_files WHERE version = ?",
        ).all(row.id) as unknown as Json[]);
      assertEquals(files.length, 1);
      assertEquals(files[0]["blob_hash"], hash);
      const read = await readOriginal(
        core,
        `${row.id}/${files[0]["path"]}`,
        bytes.length,
      );
      assertEquals(read.status, 200, JSON.stringify(read.body));
      assertEquals(decoded(read.body), text);
    }
    // 같은 바이트의 참조는 판마다 따로다.
    assertEquals(
      fileRefs(home).filter((ref) => ref.field === "file" && ref.hash === hash)
        .length,
      2,
    );
  } finally {
    await close(opened);
  }
});

// ---- `/v1/documents/file`: 고정 판의 경로별 원문 bytes ----

async function readFile(
  core: Core,
  version: string,
  path: string,
  token = TOKEN,
): Promise<{ status: number; bytes: Uint8Array; type: string }> {
  const response = await fetch(
    `http://127.0.0.1:${core.port}/v1/documents/file`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ version, path }),
    },
  );
  return {
    status: response.status,
    bytes: new Uint8Array(await response.arrayBuffer()),
    type: response.headers.get("content-type") ?? "",
  };
}

function versionIds(home: string, document: string): string[] {
  return ledger(home, (db) =>
    (db.prepare(
      "SELECT id FROM versions WHERE document = ? ORDER BY number",
    ).all(document) as unknown as { id: string }[]).map((row) => row.id));
}

Deno.test("documents/versions#R5 #R8: 관측한 판의 파일은 core의 documents/file이 원문 bytes 그대로 돌려주고 옛 판은 그 판의 bytes를 돌려준다", async () => {
  const a = "# a\n\n처음 내용\n";
  const b = "# a\n\n고친 내용, 더 길다\n";
  const opened = await openTrackedFolder({ "a.md": a });
  const { core, home, folder } = opened;
  try {
    await until("version 1", () => {
      const rows = versions(home);
      return rows.length === 1 ? rows : undefined;
    });
    const { document } = firstVersion(home);
    await Deno.writeTextFile(`${folder}/a.md`, b);
    await until("version 2", () => {
      const rows = versions(home);
      return rows.length === 2 ? rows : undefined;
    });
    const [first, second] = versionIds(home, document);
    const expected = async (version: string, text: string) => {
      const want = new TextEncoder().encode(text);
      const got = await readFile(core, version, "a.md");
      assertEquals(got.status, 200, new TextDecoder().decode(got.bytes));
      assertEquals(got.bytes, want);
      assertEquals(
        await sha256Hex(got.bytes as Uint8Array<ArrayBuffer>),
        await sha256Hex(want as Uint8Array<ArrayBuffer>),
      );
    };
    await expected(second, b);
    // 옛 판은 최신 판이 아니라 자기 판의 원문이다.
    await expected(first, a);
    // 판에 없는 경로는 bytes를 돌려주지 않는다.
    const missing = await readFile(core, first, "other.md");
    assertEquals(missing.status, 404);
  } finally {
    await close(opened);
  }
});

Deno.test("documents/versions#R8: documents/file은 범위 밖 자격에 없는 판·없는 경로와 같은 답을 주고 bytes를 내지 않는다", async () => {
  const text = "# a\n\n범위 밖 원문\n";
  const opened = await openTrackedFolder({ "a.md": text });
  const { core, home } = opened;
  try {
    await until("first version", () => {
      const rows = versions(home);
      return rows.length === 1 ? rows : undefined;
    });
    const { id: version } = firstVersion(home);
    // 다른 문서만 닿는 자격이다.
    const limited = "e".repeat(43);
    const context = {
      principal: "user-2",
      actor: "user" as const,
      credential_ref: "cred_observe_limited_file",
      scope: {
        operations: ["document.file"],
        targets: { document: "doc_01arz3ndektsv4rrffq69g5fb0" },
      },
      conditions: {},
    };
    assert(core.acceptTestCredential);
    const accepted = await core.acceptTestCredential(context, limited);
    assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    const recorded = await core.record(context);
    assert(recorded.ok, recorded.ok ? "" : recorded.error.message);

    const hidden = await readFile(core, version, "a.md", limited);
    const absent = await readFile(
      core,
      "ver_01arz3ndektsv4rrffq69g5fb9",
      "a.md",
      limited,
    );
    assertEquals(hidden.status, 404);
    assertEquals(hidden.status, absent.status);
    assertEquals(hidden.type, absent.type);
    assertEquals(hidden.bytes, absent.bytes);
    // 범위 밖이 아닌 자격도 없는 판은 같은 답이다.
    const person = await readFile(
      core,
      "ver_01arz3ndektsv4rrffq69g5fb9",
      "a.md",
    );
    assertEquals(person.status, absent.status);
    assertEquals(person.bytes, absent.bytes);
    // 그 판을 볼 수 없는 자격이 판의 경로를 짐작해도 내용은 새지 않는다.
    assert(!new TextDecoder().decode(hidden.bytes).includes("범위 밖 원문"));
    // operation 자체가 없는 자격은 target과 상관없이 같은 forbidden이다(없는 판과 구별하지 않는다).
    const noOperation = "f".repeat(43);
    const bare = {
      principal: "user-3",
      actor: "user" as const,
      credential_ref: "cred_observe_nofile",
      scope: { operations: ["document.export"], targets: {} },
      conditions: {},
    };
    const bareAccepted = await core.acceptTestCredential(bare, noOperation);
    assert(bareAccepted.ok);
    assert((await core.record(bare)).ok);
    const noReal = await readFile(core, version, "a.md", noOperation);
    const noAbsent = await readFile(
      core,
      "ver_01arz3ndektsv4rrffq69g5fb9",
      "a.md",
      noOperation,
    );
    assertEquals(noReal.status, noAbsent.status);
    assertEquals(noReal.bytes, noAbsent.bytes);
    assert(noReal.status !== 200);
  } finally {
    await close(opened);
  }
});

Deno.test("documents/versions#R8: documents/file은 원문 blob이 없으면 일부 bytes로 꾸미지 않고 unavailable이다", async () => {
  const text = "# a\n\nblob이 사라진다\n";
  const opened = await openTrackedFolder({ "a.md": text });
  const { core, home } = opened;
  try {
    await until("first version", () => {
      const rows = versions(home);
      return rows.length === 1 ? rows : undefined;
    });
    const { id: version } = firstVersion(home);
    const hash = await sha256Hex(
      new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>,
    );
    const ok = await readFile(core, version, "a.md");
    assertEquals(ok.status, 200);
    // 설치된 blob 파일이 사라진 판은 bytes를 내지 않는다.
    const file = `${home}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`;
    await Deno.remove(file);
    const gone = await readFile(core, version, "a.md");
    assertEquals(gone.status, 503);
    assert(!new TextDecoder().decode(gone.bytes).includes("blob이 사라진다"));
  } finally {
    await close(opened);
  }
});
