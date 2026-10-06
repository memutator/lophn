// documents/file-tracking#R19·R20, documents/versions#R19 끝에서 끝까지: 실제 core가 실제 documents
// coordinator와 준비 worker를 거쳐 등록된 지침 파일(전역 LOPHN.md, tracking을 끈 project의 LOPHN.md)만
// 관측하고, 사람의 지침 파일 쓰기(미존재 CAS·base_hash CAS)가 새 판이 되게 한다. 데이터 root와 폴더는 모두
// temp dir다. 사람 데이터 root(~/.lophn, ~/.config/lophn)는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import { type Core, startCore } from "./core.ts";
import { createLedgerRegistration } from "./documents.ts";

const PROJECT = "prj_01kq12a1pha000000000000000";
const USER = "u".repeat(43);
const CODING = "c".repeat(43);
const OPERATIONS = [
  "project.create",
  "files.status",
  "files.read",
  "files.write",
  "document.upload",
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

type Opened = {
  core: Core;
  home: string;
  folder: string;
  dispose(): Promise<void>;
};

async function open(
  seed: { global?: string; project?: string } = {},
  withProject = false,
): Promise<Opened> {
  const home = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-docs-instr-" }),
  );
  const folder = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-docs-instr-folder-" }),
  );
  // 등록 경로 밖 파일들. 관측하지 않는다.
  await Deno.writeTextFile(`${home}/AGENTS.md`, "# coding agent rules\n");
  await Deno.writeTextFile(`${home}/notes.md`, "# notes\n");
  await Deno.writeTextFile(`${folder}/AGENTS.md`, "# coding agent rules\n");
  await Deno.writeTextFile(`${folder}/notes.md`, "# notes\n");
  if (seed.global !== undefined) {
    await Deno.writeTextFile(`${home}/LOPHN.md`, seed.global);
  }
  if (seed.project !== undefined) {
    await Deno.writeTextFile(`${folder}/LOPHN.md`, seed.project);
  }
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createLedgerRegistration }],
    teamModules: [new URL("./documents.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(41),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  assert(core.acceptTestCredential);
  for (
    const [actor, token, ref, principal] of [
      ["user", USER, "cred-instr-user", "user"],
      [
        "coding_agent:cac_01kq12a1pha000000000000000",
        CODING,
        "cred-instr-coding",
        "coding_agent:cac_01kq12a1pha000000000000000",
      ],
    ] as const
  ) {
    const context = {
      principal,
      actor,
      scope: { operations: OPERATIONS, targets: {} },
      conditions: {},
      credential_ref: ref,
    };
    const accepted = await core.acceptTestCredential(context, token);
    assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    const recorded = await core.record(context);
    assert(recorded.ok, recorded.ok ? "" : recorded.error.message);
  }
  const opened: Opened = {
    core,
    home,
    folder,
    async dispose() {
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
      await Deno.remove(folder, { recursive: true });
    },
  };
  if (withProject) {
    // tracking을 끈 project다. 일반 folder tracking 없이도 LOPHN.md만 관측돼야 한다.
    const created = await post(opened, "projects/create", {
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
  }
  return opened;
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

async function upload(opened: Opened, text: string) {
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
  return await response.json() as Json;
}

type VersionRow = { number: number; document: string; source: string | null };

function versions(home: string): VersionRow[] {
  return ledger(home, (db) =>
    db.prepare(
      "SELECT number, document, source FROM versions ORDER BY document, number",
    ).all() as unknown as VersionRow[]);
}

type DocumentRow = {
  id: string;
  place_kind: string | null;
  name: string | null;
  source_kind: string | null;
  source_instruction_target: string | null;
  source_project: string | null;
  source_path: string | null;
};

function documents(home: string): DocumentRow[] {
  return ledger(home, (db) =>
    db.prepare(
      `SELECT id, place_kind, name, source_kind, source_instruction_target,
              source_project, source_path FROM documents ORDER BY source_path`,
    ).all() as unknown as DocumentRow[]);
}

const GLOBAL = (home: string) => ({
  kind: "instruction_file" as const,
  instruction_target: "global",
  project: null,
  path: `${home}/LOPHN.md`,
});

Deno.test("documents/file-tracking#R19 documents/versions#R19: 전역·tracking을 끈 project의 LOPHN.md만 관측하고 AGENTS.md와 다른 파일은 만들지 않는다", async () => {
  const opened = await open(
    { global: "# global\n", project: "# project\n" },
    true,
  );
  const { home, folder } = opened;
  try {
    const rows = await until("both versions", () => {
      const found = versions(home);
      return found.length === 2 ? found : undefined;
    });
    // 한참 뒤에도 등록 밖 파일(AGENTS.md·notes.md)은 문서가 되지 않는다.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    assertEquals(versions(home).length, 2);
    const found = documents(home);
    assertEquals(found.length, 2);
    for (const row of found) {
      // place·name 없는 instruction_file 연결 문서다. Project·system place를 만들지 않는다.
      assertEquals(row.place_kind, null);
      assertEquals(row.name, null);
      assertEquals(row.source_kind, "instruction_file");
    }
    const byPath = new Map(found.map((row) => [row.source_path, row]));
    const global = byPath.get(`${home}/LOPHN.md`)!;
    assertEquals(global.source_instruction_target, "global");
    assertEquals(global.source_project, null);
    const scoped = byPath.get(`${folder}/LOPHN.md`)!;
    assertEquals(scoped.source_instruction_target, `project:${PROJECT}`);
    assertEquals(scoped.source_project, PROJECT);
    assertEquals(rows.map((row) => row.number), [1, 1]);
    for (const row of rows) {
      const source = JSON.parse(row.source!) as { kind: string };
      assertEquals(source.kind, "instruction_file");
    }
    // 상태는 일반 tracking과 독립으로 tracked다.
    const status = await post(opened, "files/status", {
      target: { ...GLOBAL(home) },
    });
    assertEquals(status.status, 200, JSON.stringify(status.body));
    assertEquals(
      (status.body["status"] as { state: string }).state,
      "tracked",
    );
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/file-tracking#R19 documents/file-tracking#R20: 파일이 없으면 판이 없고, 사람의 첫 저장은 미존재 CAS로 만들며 낡은 base_hash·등록 밖 경로·agent는 쓰지 못한다", async () => {
  const opened = await open();
  const { home } = opened;
  try {
    // 시작 관측이 끝날 시간을 준다. 파일이 없으면 아무 판도 문서도 없고 agent가 빈 파일을 만들지도 않는다.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    assertEquals(versions(home).length, 0);
    assertEquals(documents(home).length, 0);
    const absent = await Deno.stat(`${home}/LOPHN.md`).then(
      () => false,
      () => true,
    );
    assert(absent);

    const first = "# first\n";
    const created = await post(opened, "files/write", {
      request_key: "instr-1",
      target: GLOBAL(home),
      base_hash: null,
      content: { kind: "prepared", blob: await upload(opened, first) },
    });
    assertEquals(created.status, 200, JSON.stringify(created.body));
    assertEquals(created.body["outcome"], "written");
    assertEquals(await Deno.readTextFile(`${home}/LOPHN.md`), first);
    // data root에는 대상 파일만 늘었다. 임시 파일은 staging에서 교체돼 남지 않는다.
    const names: string[] = [];
    for await (const entry of Deno.readDir(home)) names.push(entry.name);
    assert(names.includes("LOPHN.md"));
    assert(!names.some((name) => name.endsWith(".tmp")));
    // 관측이 그 파일을 첫 판으로 기록한다(60초 주기를 기다리지 않는다).
    const rows = await until("first version", () => {
      const found = versions(home);
      return found.length === 1 ? found : undefined;
    });
    assertEquals(rows[0].number, 1);
    assertEquals(documents(home)[0].source_kind, "instruction_file");

    // 이미 있으면 미존재 CAS가 거절하고, 낡은 base_hash도 거절한다. 파일은 그대로다.
    const again = await post(opened, "files/write", {
      request_key: "instr-2",
      target: GLOBAL(home),
      base_hash: null,
      content: { kind: "prepared", blob: await upload(opened, "again") },
    });
    assertEquals(again.status, 409);
    const stale = await post(opened, "files/write", {
      request_key: "instr-3",
      target: GLOBAL(home),
      base_hash: await sha("something else"),
      content: { kind: "prepared", blob: await upload(opened, "stale") },
    });
    assertEquals(stale.status, 409);
    assertEquals(await Deno.readTextFile(`${home}/LOPHN.md`), first);

    // base_hash가 맞는 저장은 새 판(2)이 되고 과거 판은 그대로다.
    const second = "# second\n";
    const saved = await post(opened, "files/write", {
      request_key: "instr-4",
      target: GLOBAL(home),
      base_hash: await sha(first),
      content: { kind: "prepared", blob: await upload(opened, second) },
    });
    assertEquals(saved.status, 200, JSON.stringify(saved.body));
    assertEquals(saved.body["recording"], "recorded");
    const next = await until("second version", () => {
      const found = versions(home);
      return found.length === 2 ? found : undefined;
    });
    assertEquals(next.map((row) => row.number), [1, 2]);

    // 등록 밖 경로(AGENTS.md)·다른 대상 이름은 같은 invalid_input이고 파일은 그대로다.
    const outside = await post(opened, "files/write", {
      request_key: "instr-5",
      target: { ...GLOBAL(home), path: `${home}/AGENTS.md` },
      base_hash: await sha("# coding agent rules\n"),
      content: { kind: "prepared", blob: await upload(opened, "x") },
    });
    assertEquals(outside.status, 400, JSON.stringify(outside.body));
    assertEquals(
      await Deno.readTextFile(`${home}/AGENTS.md`),
      "# coding agent rules\n",
    );
    // coding agent 자격의 파일 쓰기는 route가 거절한다.
    const agent = await post(opened, "files/write", {
      request_key: "instr-6",
      target: GLOBAL(home),
      base_hash: await sha(second),
      content: { kind: "prepared", blob: await upload(opened, "agent") },
    }, CODING);
    assertEquals(agent.status, 403, JSON.stringify(agent.body));
    assertEquals(await Deno.readTextFile(`${home}/LOPHN.md`), second);
  } finally {
    await opened.dispose();
  }
});
