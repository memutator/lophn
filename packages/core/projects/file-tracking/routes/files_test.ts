// documents#T12 끝에서 끝까지: 실제 core가 실제 documents coordinator와 준비 worker(coordinator가
// 띄운 자식 프로세스)를 거쳐 사람 파일 쓰기·이름 변경·삭제를 하고, working copy를 편집하고, 관측
// loop가 쓴 파일을 판 하나로 기록한다. 데이터 root와 폴더는 모두 temp dir다. 사람 데이터 root
// (~/.lophn, ~/.config/lophn)는 열지 않는다.
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
const USER_OPERATIONS = [
  "project.create",
  "project.set_tracking",
  "project.preview_tracking",
  "files.status",
  "files.list",
  "files.read",
  "files.write",
  "files.rename",
  "files.delete",
  "files.watch",
  "document.upload",
  "document.prepare",
  "document.save",
  "document.file",
];

type Json = Record<string, unknown>;
type Reply = { status: number; body: Json };

const encoder = new TextEncoder();

async function sha(text: string | Uint8Array): Promise<string> {
  const bytes = typeof text === "string" ? encoder.encode(text) : text;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
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
  machine: { credential: string; api_port: number } | undefined;
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

async function open(files: Record<string, string> = {}): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-docs-files-" });
  const folder = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-docs-files-folder-" }),
  );
  for (const [name, text] of Object.entries(files)) {
    await Deno.writeTextFile(`${folder}/${name}`, text);
  }
  const hello: { current?: { credential: string; api_port: number } } = {};
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createLedgerRegistration }],
    teamModules: [new URL("../../register.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(31),
    testCredentials: true,
    onDocumentsHello: (received) => {
      hello.current = received;
    },
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  try {
    await accept(core, {
      principal: "user",
      actor: "user",
      scope: { operations: USER_OPERATIONS, targets: {} },
      conditions: {},
      credential_ref: "cred-files-user",
    }, USER);
  } catch (thrown) {
    // 띄운 core를 닫지 않으면 서버·worker가 test process를 붙들어 실패가 멈춤으로 바뀐다.
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
    await Deno.remove(folder, { recursive: true });
    throw thrown;
  }
  return {
    core,
    home,
    folder,
    get machine() {
      return hello.current;
    },
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

async function readFile(
  opened: Opened,
  target: unknown,
): Promise<{ status: number; bytes: Uint8Array }> {
  const response = await fetch(
    `http://127.0.0.1:${opened.core.port}/v1/files/read`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${USER}`,
      },
      body: JSON.stringify({ target }),
    },
  );
  return {
    status: response.status,
    bytes: new Uint8Array(await response.arrayBuffer()),
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
    blob_hash: await sha(bytes),
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

function projectTarget(opened: Opened, name: string) {
  return {
    kind: "project_file" as const,
    project: PROJECT,
    path: `${opened.folder}/${name}`,
  };
}

async function track(opened: Opened) {
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
  // 미리보기는 이 test가 직접 하지 않고 실제 route가 준비 worker로 한다.
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
  return preview;
}

type VersionRow = {
  number: number;
  document: string;
  saved_by: string;
  source: string | null;
};

function versions(home: string): VersionRow[] {
  return ledger(home, (db) =>
    db.prepare(
      "SELECT number, document, saved_by, source FROM versions ORDER BY document, number",
    ).all() as unknown as VersionRow[]);
}

function fileEvents(home: string): { type: string; payload: Json }[] {
  return ledger(home, (db) =>
    (db.prepare(
      "SELECT type, payload FROM events WHERE type LIKE 'File%' ORDER BY seq",
    ).all() as unknown as { type: string; payload: string }[]).map((row) => ({
      type: row.type,
      payload: JSON.parse(row.payload) as Json,
    })));
}

const ABSENT_BODY = { error: { code: "invalid_input" } };

Deno.test("documents/file-tracking#R11 documents/file-tracking#R12 documents/file-tracking#R17: 사람 쓰기는 준비 worker가 원자 교체하고, 관측 loop가 그 파일을 판 하나로 기록하며, 저장·이름 변경·삭제는 각각 event 하나다", async () => {
  const opened = await open({ "a.md": "# a\n\none\n" });
  const { core, home, folder } = opened;
  try {
    const preview = await track(opened);
    // 처음 관측한 파일이 첫 판이다.
    await until("first version", () => {
      const rows = versions(home);
      return rows.length === 1 ? rows : undefined;
    });
    const target = projectTarget(opened, "a.md");
    // 편집 목록과 상태에 이 파일이 있다.
    const listed = await until("listed", async () => {
      const answered = await post(opened, "files/list", {});
      const targets = (answered.body as { targets?: unknown[] }).targets;
      return targets !== undefined && targets.length > 0 ? targets : undefined;
    });
    assertEquals(listed, [{
      kind: "project_file",
      ...{ project: PROJECT, path: `${folder}/a.md` },
    }]);

    // 읽기: 현재 바이트를 그대로 돌려준다.
    const read = await readFile(opened, target);
    assertEquals(read.status, 200);
    assertEquals(new TextDecoder().decode(read.bytes), "# a\n\none\n");

    // 쓰기: base_hash가 맞으면 새 바이트가 원자 교체로 들어가고 결과는 파일·기록·판 대기를 따로 낸다.
    const next = "# a\n\n사람이 고침\n";
    const blob = await upload(opened, next);
    const written = await post(opened, "files/write", {
      request_key: "write-1",
      target,
      base_hash: await sha("# a\n\none\n"),
      content: { kind: "prepared", blob },
      version_request: {
        document: DOC,
        base_version: null,
        idempotency_key: "version-1",
      },
    });
    assertEquals(written.status, 200, JSON.stringify(written.body));
    assertEquals(written.body["outcome"], "written");
    assertEquals(written.body["written_hash"], await sha(next));
    assertEquals(written.body["observed_hash"], await sha(next));
    assertEquals(written.body["changed_again"], false);
    assertEquals(written.body["recording"], "recorded");
    assertNotEquals(written.body["event_seq"], null);
    // project 파일의 판은 관측 loop가 만든다. 응답은 기다림만 알린다.
    assertEquals(written.body["version_result"], "preparing");
    assertEquals(await Deno.readTextFile(`${folder}/a.md`), next);
    // 폴더에 임시 파일이 남지 않는다.
    const names: string[] = [];
    for await (const entry of Deno.readDir(folder)) names.push(entry.name);
    assertEquals(names, ["a.md"]);

    // 관측 loop가 이 파일을 판 하나(2)로 기록한다. 중복 판은 없다.
    const second = await until("second version", () => {
      const rows = versions(home);
      return rows.length === 2 ? rows : undefined;
    });
    assertEquals(second.map((row) => row.number), [1, 2]);
    assertEquals(second[0].document, second[1].document);
    assertEquals(
      (JSON.parse(second[1].source!) as { original_hash: string })
        .original_hash,
      await sha(next),
    );
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    assertEquals(versions(home).length, 2);

    // 낡은 base_hash는 409고 파일은 그대로다. 쓴 내용은 기록되지 않는다.
    const stale = await post(opened, "files/write", {
      request_key: "write-2",
      target,
      base_hash: await sha("# a\n\none\n"),
      content: { kind: "prepared", blob: await upload(opened, "overwrite") },
    });
    assertEquals(stale.status, 409);
    assertEquals(await Deno.readTextFile(`${folder}/a.md`), next);
    assertEquals(fileEvents(home).length, 1);

    // 외부에서 먼저 고친 파일도 같다.
    await Deno.writeTextFile(`${folder}/a.md`, "# a\n\n외부에서 고침\n");
    const external = await post(opened, "files/write", {
      request_key: "write-3",
      target,
      base_hash: await sha(next),
      content: { kind: "prepared", blob: await upload(opened, "mine") },
    });
    assertEquals(external.status, 409);
    assertEquals(
      await Deno.readTextFile(`${folder}/a.md`),
      "# a\n\n외부에서 고침\n",
    );

    // 이름 변경: base_hash를 맞추고 새 목표가 없어야 한다.
    const renamed = await post(opened, "files/rename", {
      request_key: "rename-1",
      target,
      path: `${folder}/b.md`,
      base_hash: await sha("# a\n\n외부에서 고침\n"),
    });
    assertEquals(renamed.status, 200, JSON.stringify(renamed.body));
    assertEquals(renamed.body["outcome"], "renamed");
    assertEquals(renamed.body["recording"], "recorded");
    assertEquals(
      await Deno.readTextFile(`${folder}/b.md`),
      "# a\n\n외부에서 고침\n",
    );
    const gone = await Deno.stat(`${folder}/a.md`).then(
      () => false,
      () => true,
    );
    assert(gone);

    // 삭제는 사람 결정 확인이 있어야 하고, 확인 handle은 한 번만 쓴다.
    const input = {
      request_key: "delete-1",
      target: projectTarget(opened, "b.md"),
      base_hash: await sha("# a\n\n외부에서 고침\n"),
    };
    const unconfirmed = await post(opened, "files/delete", input);
    assertEquals(unconfirmed.status, 403);
    assertEquals(
      await Deno.readTextFile(`${folder}/b.md`),
      "# a\n\n외부에서 고침\n",
    );
    const binding = await confirmationBinding(filesDelete, input);
    assert(binding && core.confirmation);
    const issued = await core.confirmation({
      action: "issue",
      request: {
        type: "confirmation_handle_register",
        window_id: "win-delete",
        target_ref: binding.target,
        content_hash: binding.content,
        allowed_decisions: [FILE_DELETE_DECISION],
        expires_at: new Date(Date.UTC(2024, 0, 1) + 600_000).toISOString(),
      },
    });
    assert(issued.ok, issued.ok ? "" : issued.error.message);
    const confirmation = (issued.value as { confirmation: string })
      .confirmation;
    const deleted = await post(opened, "files/delete", {
      ...input,
      confirmation,
    });
    assertEquals(deleted.status, 200, JSON.stringify(deleted.body));
    assertEquals(deleted.body["outcome"], "deleted");
    assertEquals(deleted.body["recording"], "recorded");
    const removed = await Deno.stat(`${folder}/b.md`).then(
      () => false,
      () => true,
    );
    assert(removed);
    const reused = await post(opened, "files/delete", {
      ...input,
      confirmation,
    });
    assertEquals(reused.status, 403);

    // 저장·이름 변경·삭제가 각각 event 하나다(편집 세션당 하나가 아니다).
    assertEquals(fileEvents(home).map((event) => event.type), [
      "FileWritten",
      "FileRenamed",
      "FileDeleted",
    ]);
    assertEquals(
      JSON.stringify(fileEvents(home)).includes("사람이 고침"),
      false,
    );
    void preview;
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/file-tracking#R2 documents/file-tracking#R1: agent·coding agent·앱 자격은 원본 파일 통로를 쓰지 못하고 범위 밖 대상은 없는 것과 같은 답이다", async () => {
  const opened = await open({ "a.md": "# a\n" });
  try {
    await track(opened);
    await until("first version", () => {
      const rows = versions(opened.home);
      return rows.length === 1 ? rows : undefined;
    });
    const target = projectTarget(opened, "a.md");
    const blob = await upload(opened, "forbidden write");
    const actors = [
      ["coding_agent:cac_01arz3ndektsv4rrffq69g5fav", "a"],
      ["agent:asg_01arz3ndektsv4rrffq69g5fav", "b"],
      ["app:app_01arz3ndektsv4rrffq69g5fav", "c"],
    ] as const;
    for (const [actor, letter] of actors) {
      const token = letter.repeat(43);
      await accept(opened.core, {
        principal: actor,
        actor,
        scope: {
          operations: [
            "files.write",
            "files.read",
            "files.rename",
            "files.list",
          ],
          targets: {},
        },
        conditions: {},
        credential_ref: `cred-${letter}`,
      }, token);
      const written = await post(opened, "files/write", {
        request_key: `forbidden-${letter}`,
        target,
        base_hash: await sha("# a\n"),
        content: { kind: "prepared", blob },
      }, token);
      assertEquals(written.status, 403, actor);
      const listed = await post(opened, "files/list", {}, token);
      assertEquals(listed.status, 403, actor);
      assertEquals((await readFile(opened, target)).status, 200);
    }
    assertEquals(
      await Deno.readTextFile(`${opened.folder}/a.md`),
      "# a\n",
    );

    // 등록 폴더 밖, 모르는 project, 없는 working copy 문서, instruction 목표는 모두 같은 답이다.
    const outside = await Deno.makeTempDir({ prefix: "lophn-docs-files-out-" });
    try {
      await Deno.writeTextFile(`${outside}/secret.md`, "outside");
      const attempts = [
        {
          kind: "project_file",
          project: PROJECT,
          path: `${outside}/secret.md`,
        },
        {
          kind: "project_file",
          project: "prj_01kq12a1pha000000000000001",
          path: `${opened.folder}/a.md`,
        },
        {
          kind: "project_file",
          project: PROJECT,
          path: `${opened.folder}/.git/config`,
        },
        { kind: "working_copy", document: "doc_01kq12a1pha000000000000009" },
      ];
      const replies: Reply[] = [];
      for (const outsideTarget of attempts) {
        replies.push(
          await post(opened, "files/write", {
            request_key: "scope-write",
            target: outsideTarget,
            base_hash: null,
            content: { kind: "prepared", blob },
          }),
        );
      }
      for (const reply of replies) {
        assertEquals(reply.status, 400, JSON.stringify(replies));
        assertEquals(reply.body, replies[0].body);
        assertEquals(reply.body["error"] !== undefined, true);
      }
      assertEquals(
        (replies[0].body["error"] as Json)["code"],
        ABSENT_BODY.error.code,
      );
      assertEquals(await Deno.readTextFile(`${outside}/secret.md`), "outside");
      const read = await readFile(opened, attempts[0]);
      assertEquals(read.status, 400);
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/file-tracking#R16: 읽기 전용 폴더에 쓰면 503이고 event·로그에 본문이 없다", async () => {
  const opened = await open({ "a.md": "# a\n" });
  try {
    await track(opened);
    await until("first version", () => {
      const rows = versions(opened.home);
      return rows.length === 1 ? rows : undefined;
    });
    await Deno.chmod(opened.folder, 0o555);
    const blob = await upload(opened, "secret body text");
    const denied = await post(opened, "files/write", {
      request_key: "ro-1",
      target: projectTarget(opened, "a.md"),
      base_hash: await sha("# a\n"),
      content: { kind: "prepared", blob },
    });
    await Deno.chmod(opened.folder, 0o755);
    assertEquals(denied.status, 503);
    assertEquals(
      JSON.stringify(denied.body).includes("secret body text"),
      false,
    );
    assertEquals(await Deno.readTextFile(`${opened.folder}/a.md`), "# a\n");
    assertEquals(fileEvents(opened.home), []);
  } finally {
    await Deno.chmod(opened.folder, 0o755).catch(() => {});
    await opened.dispose();
  }
});

Deno.test("documents/file-tracking#R15 documents/file-tracking#R16: file.record_result는 같은 request_key와 operation을 한 event로 막고 사람 credential의 직접 기록은 거절한다", async () => {
  const opened = await open({ "a.md": "# a\n" });
  try {
    await track(opened);
    await until("first version", () => {
      const rows = versions(opened.home);
      return rows.length === 1 ? rows : undefined;
    });
    const machine = opened.machine;
    assert(machine);
    const input = {
      request_key: "manual-1",
      operation: "write",
      target: projectTarget(opened, "a.md"),
      outcome: "written",
      before_path: `${opened.folder}/a.md`,
      after_path: `${opened.folder}/a.md`,
      before_hash: await sha("# a\n"),
      written_hash: await sha("x"),
      observed_hash: null,
      observed_at: null,
      changed_again: null,
      recording: "unverified",
      event_seq: null,
      version_result: "not_requested",
    };
    const envelope = {
      input,
      idempotency_key: "file-result-manual-1-write",
      compare: {},
      prepared: [],
    };
    const first = await post(
      opened,
      "files/record_result",
      envelope,
      machine.credential,
    );
    assertEquals(first.status, 200, JSON.stringify(first.body));
    assertEquals(first.body["recording"], "recorded");
    const again = await post(
      opened,
      "files/record_result",
      envelope,
      machine.credential,
    );
    assertEquals(again.status, 200);
    assertEquals(again.body["event_seq"], first.body["event_seq"]);
    assertEquals(fileEvents(opened.home).length, 1);
    // 사람 credential은 감사 사실을 직접 기록하지 못한다.
    const forged = await post(opened, "files/record_result", envelope, USER);
    assertEquals(forged.status, 403);
    assertEquals(fileEvents(opened.home).length, 1);
  } finally {
    await opened.dispose();
  }
});

// 원본 없는 문서 하나를 사람 자격으로 저장한다(준비 → 저장). 첫 판 id를 돌려준다.
async function saveNewDocument(
  opened: Opened,
  text: string,
): Promise<string> {
  const blob = await upload(opened, text);
  const prepared = await post(opened, "documents/prepare", {
    document: DOC,
    base_version: null,
    metadata: { title: "note", place: null, name: null },
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

function copyTarget() {
  return { kind: "working_copy" as const, document: DOC };
}

Deno.test("documents/file-tracking#R1 documents/file-tracking#R15: 원본 없는 문서는 선택한 판으로 만든 working copy를 편집하고, 판 확정 결과는 파일 쓰기와 따로이며 새 최신 판과 충돌해도 사본이 남는다", async () => {
  const opened = await open();
  const { home } = opened;
  try {
    const first = await saveNewDocument(opened, "# note\n\none\n");
    // 원본 없는 문서의 사본이 편집 목록에 있고, 아직 사본 파일은 없다.
    const listed = await post(opened, "files/list", {});
    assertEquals(
      (listed.body as { targets: unknown[] }).targets,
      [copyTarget()],
    );
    assertEquals((await readFile(opened, copyTarget())).status, 404);
    const notTracked = await post(opened, "files/status", {
      target: copyTarget(),
    });
    assertEquals(
      (notTracked.body as { status: { state: string } }).status.state,
      "not_tracked",
    );

    // 선택한 판(첫 판)을 기준으로 사본을 만들고 명시 저장한다. 파일·기록·판이 각각 결과다.
    const edit1 = "# note\n\n고침 1\n";
    const written = await post(opened, "files/write", {
      request_key: "copy-write-1",
      target: copyTarget(),
      base_hash: null,
      content: { kind: "prepared", blob: await upload(opened, edit1) },
      version_request: {
        document: DOC,
        base_version: first,
        idempotency_key: "copy-version-1",
      },
    });
    assertEquals(written.status, 200, JSON.stringify(written.body));
    assertEquals(written.body["outcome"], "written");
    assertEquals(written.body["recording"], "recorded");
    assertEquals(written.body["version_result"], "confirmed");
    const save = written.body["save_result"] as {
      status: string;
      version: string;
    };
    assertEquals(save.status, "saved");
    assertNotEquals(save.version, first);
    const copyFile = `${home}/documents/working-copies/${DOC}/content`;
    assertEquals(await Deno.readTextFile(copyFile), edit1);
    // 확정한 판은 요청한 사람 자격의 판이고 새 project·문서는 생기지 않았다.
    const rows = versions(home);
    assertEquals(rows.map((row) => row.number), [1, 2]);
    assertEquals(rows[1].saved_by, "user");
    assertEquals(
      ledger(
        home,
        (db) =>
          (db.prepare("SELECT COUNT(*) AS count FROM documents").get() as Json)[
            "count"
          ],
      ),
      1,
    );
    assertEquals(
      ledger(
        home,
        (db) =>
          (db.prepare("SELECT COUNT(*) AS count FROM projects").get() as Json)[
            "count"
          ],
      ),
      0,
    );
    // 사본을 읽고, 확정한 내용과 같으니 추적 중이다.
    const read = await readFile(opened, copyTarget());
    assertEquals(read.status, 200);
    assertEquals(new TextDecoder().decode(read.bytes), edit1);
    const tracked = await post(opened, "files/status", {
      target: copyTarget(),
    });
    const status = tracked.body["status"] as {
      state: string;
      compared_version: string;
      observed_hash: string;
    };
    assertEquals(status.state, "tracked");
    assertEquals(status.compared_version, save.version);
    assertEquals(status.observed_hash, await sha(edit1));

    // 자동 저장은 파일 쓰기만이다. 사본은 판 대기가 되고 사본 안에서 base_hash를 대조한다.
    const edit2 = "# note\n\n고침 2\n";
    const watched = (async () => {
      const current = await post(opened, "files/watch", {
        target: copyTarget(),
      });
      const cursor = current.body["next_cursor"] as string;
      return await post(opened, "files/watch", {
        target: copyTarget(),
        cursor,
      });
    })();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const autosave = await post(opened, "files/write", {
      request_key: "copy-write-2",
      target: copyTarget(),
      base_hash: await sha(edit1),
      content: { kind: "prepared", blob: await upload(opened, edit2) },
    });
    assertEquals(autosave.status, 200, JSON.stringify(autosave.body));
    assertEquals(autosave.body["version_result"], "not_requested");
    assertEquals(versions(home).length, 2);
    // 편집 연결은 그 변화를 알려 받는다.
    const changed = await watched;
    assertEquals(changed.status, 200, JSON.stringify(changed.body));
    assertEquals(
      (changed.body["status"] as { state: string }).state,
      "version_pending",
    );
    const stale = await post(opened, "files/write", {
      request_key: "copy-write-stale",
      target: copyTarget(),
      base_hash: await sha("someone else's content"),
      content: { kind: "prepared", blob: await upload(opened, "overwrite") },
    });
    assertEquals(stale.status, 409);
    assertEquals(await Deno.readTextFile(copyFile), edit2);

    // 그사이 다른 경로로 새 최신 판이 생겼다. 열었던 판(save.version)으로 명시 저장하면
    // 판은 conflict지만 사본 파일은 남고, 새 판은 만들어지지 않는다.
    const newer = await upload(opened, "# note\n\n다른 곳에서 고친 최신 판\n");
    const newerPrepared = await post(opened, "documents/prepare", {
      document: DOC,
      base_version: save.version,
      files: [{
        path: "note.md",
        blob_hash: newer.hash,
        bytes: newer.size_bytes,
        media_type: "text/markdown",
        primary: true,
        content: { kind: "prepared", blob: newer },
      }],
      source: null,
      idempotency_key: "newer-save",
    });
    assertEquals(newerPrepared.status, 200, JSON.stringify(newerPrepared.body));
    const newerSaved = await post(opened, "documents/save", {
      input: newerPrepared.body,
      idempotency_key: "newer-save",
      compare: { base_version: save.version },
      prepared: [
        String(newerPrepared.body["preparation_ref"]),
        ...(newerPrepared.body["files"] as { preparation_ref: string }[]).map((
          file,
        ) => file.preparation_ref),
      ],
    });
    assertEquals(newerSaved.status, 200, JSON.stringify(newerSaved.body));
    assertEquals(versions(home).length, 3);
    const edit3 = "# note\n\n고침 3\n";
    const conflicted = await post(opened, "files/write", {
      request_key: "copy-write-3",
      target: copyTarget(),
      base_hash: await sha(edit2),
      content: { kind: "prepared", blob: await upload(opened, edit3) },
      version_request: {
        document: DOC,
        base_version: save.version,
        idempotency_key: "copy-version-3",
      },
    });
    assertEquals(conflicted.status, 200, JSON.stringify(conflicted.body));
    // 파일 쓰기는 성공이고 판 확정만 conflict다.
    assertEquals(conflicted.body["outcome"], "written");
    assertEquals(conflicted.body["recording"], "recorded");
    assertEquals(conflicted.body["version_result"], "conflict");
    // 새 기준(그 문서의 지금 최신 판)이 결과에 실려 온다.
    const newest = ledger(
      home,
      (db) =>
        (db.prepare(
          "SELECT id FROM versions WHERE document = ? ORDER BY number DESC LIMIT 1",
        ).get(DOC) as { id: string }).id,
    );
    assertEquals(conflicted.body["latest_version"], newest);
    assertNotEquals(newest, save.version);
    assertEquals(await Deno.readTextFile(copyFile), edit3);
    assertEquals(versions(home).length, 3);
    const pending = await post(opened, "files/status", {
      target: copyTarget(),
    });
    assertEquals(
      (pending.body["status"] as { state: string }).state,
      "version_pending",
    );
    // 세 번의 사본 쓰기는 각각 event 하나다.
    assertEquals(
      fileEvents(home).filter((event) => event.type === "FileWritten").length,
      3,
    );
  } finally {
    await opened.dispose();
  }
});

// tracking을 끈 project를 등록한다. coordinator가 그 폴더를 쓰기 폴더로 받는 것은 core가 자기
// snapshot에서 읽어 envelope로 보내는 길이라, 테스트는 쓰기가 성공할 때까지 기다린다.
async function registerUntracked(opened: Opened) {
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
}

async function openRead(opened: Opened, target: unknown): Promise<Response> {
  return await until("file read", async () => {
    const answered = await fetch(
      `http://127.0.0.1:${opened.core.port}/v1/files/read`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${USER}`,
        },
        body: JSON.stringify({ target }),
      },
    );
    if (answered.status === 200) return answered;
    await answered.body?.cancel();
    return undefined;
  });
}

Deno.test("documents/file-tracking#R1 documents/file-tracking#R11 documents/file-tracking#R17: tracking을 끈 project의 폴더도 쓰고 읽고 이름을 바꾸고 지운다 — 관측하지 않으니 판은 만들어지지 않는다", async () => {
  const opened = await open();
  const { core, home, folder } = opened;
  try {
    await registerUntracked(opened);
    const target = projectTarget(opened, "note.md");
    const first = "# note\n\n처음\n";
    // coordinator가 폴더 근거를 받기 전의 쓰기는 없는 것과 같은 답이고 파일을 만들지 않는다.
    const written = await until("untracked write", async () => {
      const answered = await post(opened, "files/write", {
        request_key: "untracked-1",
        target,
        base_hash: null,
        content: { kind: "prepared", blob: await upload(opened, first) },
        version_request: {
          document: DOC,
          base_version: null,
          idempotency_key: "untracked-version",
        },
      });
      return answered.status === 200 ? answered : undefined;
    });
    assertEquals(written.body["outcome"], "written");
    assertEquals(written.body["recording"], "recorded");
    assertEquals(written.body["written_hash"], await sha(first));
    // 관측하지 않는 폴더라 기다릴 판이 없다.
    assertEquals(written.body["version_result"], "not_requested");
    assertEquals(await Deno.readTextFile(`${folder}/note.md`), first);
    const read = await readFile(opened, target);
    assertEquals(read.status, 200);
    assertEquals(new TextDecoder().decode(read.bytes), first);

    const edited = "# note\n\n고침\n";
    const rewritten = await post(opened, "files/write", {
      request_key: "untracked-2",
      target,
      base_hash: await sha(first),
      content: { kind: "prepared", blob: await upload(opened, edited) },
    });
    assertEquals(rewritten.status, 200, JSON.stringify(rewritten.body));
    // 낡은 base_hash는 이 폴더에서도 409다.
    const stale = await post(opened, "files/write", {
      request_key: "untracked-stale",
      target,
      base_hash: await sha(first),
      content: { kind: "prepared", blob: await upload(opened, "overwrite") },
    });
    assertEquals(stale.status, 409);

    const renamed = await post(opened, "files/rename", {
      request_key: "untracked-rename",
      target,
      path: `${folder}/moved.md`,
      base_hash: await sha(edited),
    });
    assertEquals(renamed.status, 200, JSON.stringify(renamed.body));
    assertEquals(await Deno.readTextFile(`${folder}/moved.md`), edited);

    const input = {
      request_key: "untracked-delete",
      target: projectTarget(opened, "moved.md"),
      base_hash: await sha(edited),
    };
    const binding = await confirmationBinding(filesDelete, input);
    assert(binding && core.confirmation);
    const issued = await core.confirmation({
      action: "issue",
      request: {
        type: "confirmation_handle_register",
        window_id: "win-untracked-delete",
        target_ref: binding.target,
        content_hash: binding.content,
        allowed_decisions: [FILE_DELETE_DECISION],
        expires_at: new Date(Date.UTC(2024, 0, 1) + 600_000).toISOString(),
      },
    });
    assert(issued.ok, issued.ok ? "" : issued.error.message);
    const deleted = await post(opened, "files/delete", {
      ...input,
      confirmation: (issued.value as { confirmation: string }).confirmation,
    });
    assertEquals(deleted.status, 200, JSON.stringify(deleted.body));
    const left: string[] = [];
    for await (const entry of Deno.readDir(folder)) left.push(entry.name);
    assertEquals(left, []);

    // 저장·이름 변경·삭제가 각각 event 하나고, 관측 loop는 이 폴더를 보지 않아 판이 없다.
    assertEquals(
      fileEvents(home).map((event) => event.type),
      ["FileWritten", "FileWritten", "FileRenamed", "FileDeleted"],
    );
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    assertEquals(versions(home).length, 0);
    // 등록 폴더 밖의 경로는 이 project의 목표가 아니다(없는 것과 같은 답).
    const outside = await post(opened, "files/write", {
      request_key: "untracked-outside",
      target: {
        kind: "project_file",
        project: PROJECT,
        path: `${await Deno.realPath(home)}/escape.md`,
      },
      base_hash: null,
      content: { kind: "prepared", blob: await upload(opened, "x") },
    });
    assertEquals(outside.status, 400);
    assertEquals(
      (outside.body["error"] as Json)["code"],
      ABSENT_BODY.error.code,
    );
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/file-tracking#R9: 512 KiB와 한 JSON frame을 넘는 파일도 창 단위 byte frame으로 흘려 읽고 hash가 같다", async () => {
  const opened = await open();
  const { folder } = opened;
  try {
    await registerUntracked(opened);
    // 17 MiB: 옛 읽기 한도(512 KiB)와 검사 입력 상한(16 MiB)을 모두 넘는다.
    const size = 17 * 1024 * 1024 + 321;
    const bytes = new Uint8Array(size);
    for (let at = 0; at < size; at++) bytes[at] = (at * 31 + (at >> 8)) & 255;
    await Deno.writeFile(`${folder}/big.bin`, bytes);
    const response = await openRead(opened, projectTarget(opened, "big.bin"));
    assertEquals(response.headers.get("content-length"), String(size));
    const body = new Uint8Array(await response.arrayBuffer());
    assertEquals(body.length, size);
    assertEquals(await sha(body), await sha(bytes));
    // 빈 파일과 없는 파일.
    await Deno.writeFile(`${folder}/empty.bin`, new Uint8Array());
    const empty = await readFile(opened, projectTarget(opened, "empty.bin"));
    assertEquals(empty.status, 200);
    assertEquals(empty.bytes.length, 0);
    const missing = await readFile(opened, projectTarget(opened, "none.bin"));
    assertEquals(missing.status, 404);
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/file-tracking#R9 documents/file-tracking#R11: 읽는 도중 파일이 바뀌면 섞인 바이트를 끝까지 내보내지 않고 응답을 끊는다", async () => {
  const opened = await open();
  const { folder } = opened;
  try {
    await registerUntracked(opened);
    const size = 48 * 1024 * 1024;
    await Deno.writeFile(`${folder}/live.bin`, new Uint8Array(size).fill(1));
    const response = await openRead(opened, projectTarget(opened, "live.bin"));
    const reader = response.body!.getReader();
    const head = await reader.read();
    assert(!head.done && head.value!.length > 0);
    // 소비자가 멈춘 사이 파일을 같은 크기의 다른 내용으로 바꾼다(mtime이 달라진다).
    await new Promise((resolve) => setTimeout(resolve, 50));
    await Deno.writeFile(`${folder}/live.bin`, new Uint8Array(size).fill(2));
    let received = head.value!.length;
    let failed = false;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        assert(next.value.every((byte) => byte === 1));
        received += next.value.length;
      }
    } catch {
      failed = true;
    }
    assert(failed, "바뀐 파일의 응답은 끝까지 가지 않고 끊긴다");
    assert(received < size);
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/file-tracking#R1 documents/file-tracking#R11: 옛 판 복원은 그 판 파일의 원본 참조로 쓰고, 위조된 참조는 없는 것과 같은 답이다", async () => {
  const oldText = "# a\n\n옛 내용\n";
  const opened = await open({ "a.md": oldText });
  const { home, folder } = opened;
  try {
    await track(opened);
    await until("first version", () => {
      const rows = versions(home);
      return rows.length === 1 ? rows : undefined;
    });
    const old = ledger(
      home,
      (db) =>
        db.prepare("SELECT id FROM versions ORDER BY number").get() as {
          id: string;
        },
    );
    const target = projectTarget(opened, "a.md");
    const newer = "# a\n\n새 내용\n";
    const rewrite = await post(opened, "files/write", {
      request_key: "restore-edit",
      target,
      base_hash: await sha(oldText),
      content: { kind: "prepared", blob: await upload(opened, newer) },
    });
    assertEquals(rewrite.status, 200, JSON.stringify(rewrite.body));
    await until("second version", () => {
      const rows = versions(home);
      return rows.length === 2 ? rows : undefined;
    });
    const registered = ledger(
      home,
      (db) =>
        (db.prepare(
          `SELECT registered_seq AS seq FROM blob_refs
           WHERE owner_kind = 'document_version' AND owner_key = ? AND field = 'file'`,
        ).get(`${old.id}/a.md`) as { seq: number | string }).seq,
    );
    const reference = {
      owner_kind: "document_version",
      owner_key: `${old.id}/a.md`,
      field: "file",
      hash: await sha(oldText),
      registered_seq: String(registered),
    };
    // 위조: 다른 hash, 없는 판, 없는 경로, 판 파일이 아닌 참조는 모두 같은 400이고 파일을 건드리지 않는다.
    const forged = [
      { ...reference, hash: await sha("something else") },
      { ...reference, owner_key: "ver_01kq12a1pha0000000000000zz/a.md" },
      { ...reference, owner_key: `${old.id}/missing.md` },
      { ...reference, owner_kind: "message_body" },
    ];
    const bodies = new Set<string>();
    for (const [index, content] of forged.entries()) {
      const refused = await post(opened, "files/write", {
        request_key: `restore-forged-${index}`,
        target,
        base_hash: await sha(newer),
        content: { kind: "existing", reference: content },
      });
      assertEquals(refused.status, 400, JSON.stringify(refused.body));
      bodies.add(JSON.stringify(refused.body));
    }
    assertEquals(bodies.size, 1);
    assertEquals(await Deno.readTextFile(`${folder}/a.md`), newer);
    // 그 판의 문서를 읽을 권한(document.file)이 없는 자격은 같은 참조도 없는 것과 같은 400이다.
    const LIMITED = "l".repeat(43);
    await accept(opened.core, {
      principal: "user-limited",
      actor: "user",
      scope: {
        operations: USER_OPERATIONS.filter((name) => name !== "document.file"),
        targets: {},
      },
      conditions: {},
      credential_ref: "cred-files-limited",
    }, LIMITED);
    const limited = await post(opened, "files/write", {
      request_key: "restore-limited",
      target,
      base_hash: await sha(newer),
      content: { kind: "existing", reference },
    }, LIMITED);
    assertEquals(limited.status, 400, JSON.stringify(limited.body));
    assertEquals(bodies.has(JSON.stringify(limited.body)), true);
    assertEquals(await Deno.readTextFile(`${folder}/a.md`), newer);
    // 읽을 수 있는 판의 참조는 그 바이트를 쓴다.
    const restored = await post(opened, "files/write", {
      request_key: "restore-1",
      target,
      base_hash: await sha(newer),
      content: { kind: "existing", reference },
    });
    assertEquals(restored.status, 200, JSON.stringify(restored.body));
    assertEquals(restored.body["outcome"], "written");
    assertEquals(restored.body["written_hash"], await sha(oldText));
    assertEquals(await Deno.readTextFile(`${folder}/a.md`), oldText);
  } finally {
    await opened.dispose();
  }
});

// 추적을 켜면 core가 새 root 권한으로 coordinator를 다시 띄운다. 그 직전에 coordinator에 보낸 요청은
// 옛 child와 함께 사라져 답이 오지 않았고, 요청의 기한(preview는 70초)까지 멈췄다.
Deno.test("documents/file-tracking#R3 platform/responsiveness#R3: 추적을 켠 직후 preview는 coordinator를 바꾸는 동안에도 기한을 다 기다리지 않고 답한다", async () => {
  for (let round = 0; round < 3; round++) {
    const opened = await open({ "a.md": "# a\n" });
    try {
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
      const folders = [{ path: opened.folder, description: "a" }];
      const tracking = {
        enabled: true,
        patterns: [{ effect: "include" as const, glob: "**/*.md" }],
        use_gitignore: false,
      };
      const first = await post(opened, "projects/preview_tracking", {
        project: PROJECT,
        base_revision: String(created.body["revision"]),
        folders,
        tracking,
      });
      assertEquals(first.status, 200, JSON.stringify(first.body));
      const applied = await post(opened, "projects/set_tracking", {
        input: { project: PROJECT, folders, tracking, preview: first.body },
        idempotency_key: "track-alpha",
        compare: { base_revision: String(created.body["revision"]) },
        prepared: [],
      });
      assertEquals(applied.status, 200, JSON.stringify(applied.body));
      // 곧바로 여러 번 겹쳐 부른다. 교체가 시작되는 때(적용 뒤 0.1초쯤)에 걸린 요청이 있어야 한다.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const calls = Array.from({ length: 10 }, async (_, index) => {
        await new Promise((resolve) => setTimeout(resolve, index * 40));
        return await post(opened, "projects/preview_tracking", {
          project: PROJECT,
          base_revision: String(applied.body["revision"]),
          folders,
          tracking,
        });
      });
      const replies = await Promise.race([
        Promise.all(calls),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("preview did not answer within 25s")),
            25_000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      for (const reply of replies) {
        assertEquals(reply.status, 200, JSON.stringify(reply.body));
      }
    } finally {
      await opened.dispose();
    }
  }
});
