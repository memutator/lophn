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
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createLedgerRegistration }],
    teamModules: [new URL("./documents.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(11),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  const context = {
    principal: "user",
    actor: "user" as const,
    credential_ref: "cred_observe_person",
    scope: {
      operations: ["project.create", "project.set_tracking", "files.status"],
      targets: {},
    },
    conditions: {},
  };
  assert(core.acceptTestCredential);
  const accepted = await core.acceptTestCredential(context, TOKEN);
  assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
  const recorded = await core.record(context);
  assert(recorded.ok, recorded.ok ? "" : recorded.error.message);
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
  await Deno.copyFile(`${opened.home}/documents/debug.log`, "/tmp/claude-1000/dbg/debug.log").catch(() => {}); await Deno.remove(opened.home, { recursive: true });
  await Deno.remove(opened.folder, { recursive: true });
}

Deno.test("documents/file-tracking#R4 documents/versions#R13: 등록 폴더의 파일 편집이 실제 worker를 거쳐 새 Version이 된다", async () => {
  const opened = await openTrackedFolder({ "a.md": "# a\n\none\n" });
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
    const documents = ledger(home, (db) =>
      db.prepare("SELECT COUNT(*) AS count FROM documents").get() as Json
    );
    assertEquals(documents["count"], 1);

    // 새로 생긴 파일은 다른 문서가 된다.
    await Deno.writeTextFile(`${folder}/b.md`, "# b\n");
    const third = await until("third version", () => {
      const rows = versions(home);
      return rows.length === 3 ? rows : undefined;
    });
    assertEquals(new Set(third.map((row) => row.document)).size, 2);

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
