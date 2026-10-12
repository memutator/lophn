// lophn-agent/instructions#R1 R4 R7 R8 [agent-I19]: LOPHN.md는 document·판 없이 그냥 파일이다. reader Worker의
// ReadInstructionFile이 run의 작업 자리로 전역(~/.lophn)·project 폴더·앱 자리 파일과 agent 정의 본문을 매 읽기마다
// 파일에서 읽는다. 앞쪽은 ledger 모양의 temp DB와 temp 폴더로 handler를 직접 부르고, 뒤쪽은 실제 core의
// machine 자격 HTTP 읽기를 runtime의 InstructionFiles 어댑터에 꽂아 본다. 사람 데이터 root(~/.lophn,
// ~/.config/lophn)는 열지 않는다. model provider는 부르지 않는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  err,
  manualClock,
  ok,
  seededRandom,
  sha256Hex,
} from "../../packages/base/mod.ts";
import {
  INSTRUCTION_PREVIEW_MAX_BYTES,
  instructionPreview,
  instructionRead,
} from "../../packages/protocol/lophn-agent/mod.ts";
import type {
  ReadSnapshot,
  RequestContext,
} from "../../packages/protocol/platform/mod.ts";
import { routePath } from "../../packages/protocol/platform/mod.ts";
import {
  INSTRUCTION_FILE_MAX_BYTES,
  instructionFilesOverCore,
  resolveInstructions,
} from "../../packages/lophn-agent/instructions/mod.ts";
import { createProductRedactor } from "./documents-redactor.ts";
import { createLedgerRegistration } from "./documents.ts";
import {
  createLedgerRegistration as createLophnAgentRegistration,
  lophnAgentDefinitions,
} from "./lophn-agent.ts";
import { type Core, startCore } from "./core.ts";
import { createReaderRegistration } from "./instruction-files.ts";

const PROJECT = "prj_01kq12a1pha000000000000000";
const APP = "app_01kq12a1pha000000000000000";
const SES = "ses_01arz3ndektsv4rrffq69g5fav";
const MSG = "msg_01arz3ndektsv4rrffq69g5fav";
const OPERATOR = "asg_01kq12a1pha000000000000000";
const RUN_SESSION = "run_01kq12a1pha000000000000000";
const RUN_OPERATOR = "run_01kq12a1phb000000000000000";
const RUN_ALL = "run_01kq12a1phc000000000000000";

const machine: RequestContext = {
  principal: "machine:agent-runtime",
  actor: "machine",
  scope: { operations: [instructionRead.name], targets: {} },
  conditions: {},
  credential_ref: "cred-instr-files",
};

type Fixture = {
  root: string;
  folder: string;
  read(run: string, layer: string): ReturnType<typeof readOnce>;
  close(): Promise<void>;
};

const read = createReaderRegistration().reads[0];

function readOnce(
  db: DatabaseSync,
  run: string,
  layer: string,
) {
  const snapshot: ReadSnapshot = {
    sql: {
      get: (text, params) =>
        db.prepare(text).get(...(params as never[])) as never,
      all: (text, params) =>
        db.prepare(text).all(...(params as never[])) as never,
    },
    as_of_seq: "9",
    port: () => {
      throw new Error("no port");
    },
  };
  return read.handle(snapshot, machine, { run, layer } as never);
}

// ledger 모양: lophn.db가 있는 폴더가 data root다. 세션이 project에 연 lophn run 하나, 앱 Operator run 하나,
// 세션 없는 전역 lophn run 하나.
async function fixture(): Promise<Fixture> {
  const root = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-instr-files-" }),
  );
  const folder = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-instr-folder-" }),
  );
  const db = new DatabaseSync(`${root}/lophn.db`);
  db.exec(`
    create table runs (id text primary key, assignment text, session text);
    create table assignments (id text primary key, role text, scope_kind text, scope_id text);
    create table sessions (id text primary key, work_place_kind text, work_place_id text);
    create table project_folders (project text, position integer, path text);
    insert into assignments values ('asg_g', 'lophn', 'all', null);
    insert into assignments values ('${OPERATOR}', 'operator', 'app', '${APP}');
    insert into sessions values ('ses_1', 'project', '${PROJECT}');
    insert into runs values ('${RUN_SESSION}', 'asg_g', 'ses_1');
    insert into runs values ('${RUN_OPERATOR}', '${OPERATOR}', null);
    insert into runs values ('${RUN_ALL}', 'asg_g', null);
    insert into project_folders values ('${PROJECT}', 1, '${folder}/second');
    insert into project_folders values ('${PROJECT}', 0, '${folder}');
  `);
  return {
    root,
    folder,
    read: (run, layer) => readOnce(db, run, layer),
    async close() {
      db.close();
      await Deno.remove(root, { recursive: true });
      await Deno.remove(folder, { recursive: true });
    },
  };
}

function textOf(
  reply: ReturnType<typeof readOnce>,
): { text: string; size: number } | null {
  assert(reply.ok, reply.ok ? "" : reply.error.message);
  const file = (reply.value as {
    file: { size_bytes: number; content_base64: string } | null;
  })
    .file;
  if (file === null) return null;
  return {
    text: new TextDecoder().decode(
      Uint8Array.from(atob(file.content_base64), (c) => c.charCodeAt(0)),
    ),
    size: file.size_bytes,
  };
}

function codeOf(reply: ReturnType<typeof readOnce>): string {
  return reply.ok ? "ok" : reply.error.code;
}

Deno.test("lophn-agent/instructions#R1 R4 R9 [agent-I19, agent-I49]: reader 등록은 machine의 ReadInstructionFile과 사람 화면의 PreviewGlobalInstructions를 서빙한다", () => {
  const registration = createReaderRegistration();
  assertEquals(registration.reads.map((entry) => entry.route.name), [
    instructionRead.name,
    instructionPreview.name,
  ]);
  assertEquals(registration.reads[0].route, instructionRead);
  assertEquals(registration.reads[1].route, instructionPreview);
});

Deno.test("lophn-agent/instructions#R1 R4 R5 [agent-I19]: project 세션 run은 data root의 전역과 project 첫 폴더의 LOPHN.md와 그 자리 agent 정의 본문을 읽고 app 층은 없는 대상이며 AGENTS.md는 읽지 않는다", async () => {
  const f = await fixture();
  try {
    await Deno.writeTextFile(`${f.root}/LOPHN.md`, "global rules\n");
    await Deno.writeTextFile(`${f.folder}/LOPHN.md`, "project rules\n");
    // 둘째 폴더와 coding agent의 별개 파일은 지침이 아니다.
    await Deno.mkdir(`${f.folder}/second`);
    await Deno.writeTextFile(`${f.folder}/second/LOPHN.md`, "second\n");
    await Deno.writeTextFile(`${f.folder}/AGENTS.md`, "# coding rules\n");
    await Deno.mkdir(`${f.root}/projects/${PROJECT}/agents`, {
      recursive: true,
    });
    await Deno.writeTextFile(
      `${f.root}/projects/${PROJECT}/agents/lophn.md`,
      "Be brief.\n",
    );

    assertEquals(textOf(f.read(RUN_SESSION, "global")), {
      text: "global rules\n",
      size: 13,
    });
    assertEquals(
      textOf(f.read(RUN_SESSION, "project"))?.text,
      "project rules\n",
    );
    // 정의 파일의 frontmatter가 아니라 본문이 agent 층이다.
    assertEquals(textOf(f.read(RUN_SESSION, "agent"))?.text, "Be brief.");
    assertEquals(codeOf(f.read(RUN_SESSION, "app")), "not_found");

    // 읽기 답은 as_of_seq를 싣고 경로나 문서·판 id를 싣지 않는다.
    const reply = f.read(RUN_SESSION, "global");
    assert(reply.ok);
    assertEquals((reply.value as { as_of_seq: string }).as_of_seq, "9");
    assert(!JSON.stringify(reply.value).includes(f.root));
    assert(!JSON.stringify(reply.value).includes("doc_"));
  } finally {
    await f.close();
  }
});

Deno.test("lophn-agent/instructions#R1 R4 [agent-I19]: 앱 Operator run은 담당 앱 자리의 LOPHN.md와 그 Operator 정의 본문을 읽고 project 층은 없는 대상이다", async () => {
  const f = await fixture();
  try {
    await Deno.mkdir(`${f.root}/apps/${APP}/agents`, { recursive: true });
    await Deno.writeTextFile(`${f.root}/apps/${APP}/LOPHN.md`, "app rules\n");
    await Deno.writeTextFile(
      `${f.root}/apps/${APP}/agents/${OPERATOR}.md`,
      "---\nname: Watcher\n---\n\nWatch the status.\n",
    );
    assertEquals(textOf(f.read(RUN_OPERATOR, "app"))?.text, "app rules\n");
    assertEquals(
      textOf(f.read(RUN_OPERATOR, "agent"))?.text,
      "Watch the status.",
    );
    assertEquals(codeOf(f.read(RUN_OPERATOR, "project")), "not_found");
    // 전역 파일이 없으면 부재다.
    assertEquals(textOf(f.read(RUN_OPERATOR, "global")), null);
  } finally {
    await f.close();
  }
});

Deno.test("lophn-agent/instructions#R2 [agent-I19]: 없는 파일은 부재(null)이고 빈 파일과 구별하며 읽기가 파일을 만들지 않는다", async () => {
  const f = await fixture();
  try {
    assertEquals(textOf(f.read(RUN_SESSION, "global")), null);
    assertEquals(textOf(f.read(RUN_SESSION, "project")), null);
    assertEquals(textOf(f.read(RUN_SESSION, "agent")), null);
    for (const path of [`${f.root}/LOPHN.md`, `${f.folder}/LOPHN.md`]) {
      assertEquals(await Deno.stat(path).catch(() => null), null);
    }
    await Deno.writeTextFile(`${f.root}/LOPHN.md`, "");
    assertEquals(textOf(f.read(RUN_SESSION, "global")), { text: "", size: 0 });
    // 폴더가 없는 project는 project 층이 부재다.
    const db = new DatabaseSync(`${f.root}/lophn.db`);
    db.exec(`delete from project_folders`);
    db.close();
    assertEquals(textOf(f.read(RUN_SESSION, "project")), null);
  } finally {
    await f.close();
  }
});

Deno.test("lophn-agent/instructions#R4 [agent-I19]: 없는 run과 작업 자리가 없는 run의 project·app 층은 없는 대상과 같은 not_found다", async () => {
  const f = await fixture();
  try {
    await Deno.writeTextFile(`${f.root}/LOPHN.md`, "global rules\n");
    assertEquals(codeOf(f.read("run_none", "global")), "not_found");
    assertEquals(textOf(f.read(RUN_ALL, "global"))?.text, "global rules\n");
    assertEquals(codeOf(f.read(RUN_ALL, "project")), "not_found");
    assertEquals(codeOf(f.read(RUN_ALL, "app")), "not_found");
    // 세션 없는 전역 run에는 정의를 둘 자리가 없어 agent 본문이 없다.
    assertEquals(textOf(f.read(RUN_ALL, "agent")), null);
  } finally {
    await f.close();
  }
});

Deno.test("lophn-agent/instructions#R7 [agent-I19]: 32 KiB를 넘는 파일은 처음 32 KiB만 주고 실제 크기를 알리며 읽지 못하는 파일은 부재가 아니라 unavailable이고 경로가 새지 않는다", async () => {
  const f = await fixture();
  try {
    await Deno.writeTextFile(
      `${f.root}/LOPHN.md`,
      "a".repeat(INSTRUCTION_FILE_MAX_BYTES + 5),
    );
    const large = textOf(f.read(RUN_SESSION, "global"));
    assertEquals(large?.size, INSTRUCTION_FILE_MAX_BYTES + 5);
    assertEquals(large?.text.length, INSTRUCTION_FILE_MAX_BYTES);

    // 파일 자리에 폴더가 있으면 읽지 못한다.
    await Deno.mkdir(`${f.folder}/LOPHN.md`);
    const unreadable = f.read(RUN_SESSION, "project");
    assert(!unreadable.ok);
    assertEquals(unreadable.error.code, "unavailable");
    assert(!unreadable.error.message.includes(f.folder));

    // 깨진 agent 정의는 본문이 없는 것으로 보지 않고 읽지 못한 것이다.
    await Deno.mkdir(`${f.root}/projects/${PROJECT}/agents`, {
      recursive: true,
    });
    await Deno.writeTextFile(
      `${f.root}/projects/${PROJECT}/agents/lophn.md`,
      "---\nname: [unclosed\n",
    );
    assertEquals(codeOf(f.read(RUN_SESSION, "agent")), "unavailable");
  } finally {
    await f.close();
  }
});

Deno.test("lophn-agent/instructions#R8 [agent-I19]: 읽을 때마다 파일을 다시 읽어 사람의 저장이 다음 읽기부터 보인다", async () => {
  const f = await fixture();
  try {
    await Deno.writeTextFile(`${f.root}/LOPHN.md`, "first\n");
    assertEquals(textOf(f.read(RUN_SESSION, "global"))?.text, "first\n");
    await Deno.writeTextFile(`${f.root}/LOPHN.md`, "second, longer\n");
    assertEquals(
      textOf(f.read(RUN_SESSION, "global"))?.text,
      "second, longer\n",
    );
    await Deno.remove(`${f.root}/LOPHN.md`);
    assertEquals(textOf(f.read(RUN_SESSION, "global")), null);
  } finally {
    await f.close();
  }
});

const previewRead = createReaderRegistration().reads[1];

const person: RequestContext = {
  principal: "user",
  actor: "user",
  scope: { operations: [instructionPreview.name], targets: {} },
  conditions: {},
  credential_ref: "cred-instr-preview-user",
};

// 미리보기는 run을 모른다: 전역 LOPHN.md(data root)만 본다. ledger 모양의 temp DB는 data root를 알리는 용도다.
async function previewFixture() {
  const root = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-instr-preview-" }),
  );
  const db = new DatabaseSync(`${root}/lophn.db`);
  return {
    root,
    preview() {
      const snapshot: ReadSnapshot = {
        sql: {
          get: (text, params) =>
            db.prepare(text).get(...(params as never[])) as never,
          all: (text, params) =>
            db.prepare(text).all(...(params as never[])) as never,
        },
        as_of_seq: "9",
        port: () => {
          throw new Error("no port");
        },
      };
      return previewRead.handle(snapshot, person, {} as never);
    },
    async close() {
      db.close();
      await Deno.remove(root, { recursive: true });
    },
  };
}

type PreviewValue = {
  preview: { text: string; size_bytes: number; truncated: boolean } | null;
  as_of_seq: string;
};

Deno.test("lophn-agent/instructions#R2 R9 [agent-I49]: 전역 미리보기는 data root의 LOPHN.md 앞부분이고 파일이 없으면 null이며 빈 파일과 구별하고 파일을 만들지 않는다", async () => {
  const f = await previewFixture();
  try {
    const absent = f.preview();
    assert(absent.ok, absent.ok ? "" : absent.error.message);
    assertEquals((absent.value as PreviewValue).preview, null);
    assertEquals(
      await Deno.stat(`${f.root}/LOPHN.md`).catch(() => null),
      null,
    );

    await Deno.writeTextFile(`${f.root}/LOPHN.md`, "");
    const empty = f.preview();
    assert(empty.ok);
    assertEquals((empty.value as PreviewValue).preview, {
      text: "",
      size_bytes: 0,
      truncated: false,
    });

    await Deno.writeTextFile(`${f.root}/LOPHN.md`, "# Rules\nBe brief.\n");
    const short = f.preview();
    assert(short.ok);
    assertEquals((short.value as PreviewValue).preview, {
      text: "# Rules\nBe brief.\n",
      size_bytes: 18,
      truncated: false,
    });
    // 응답은 ledger 위치를 싣고 경로를 싣지 않으며 contract output schema를 통과한다.
    assertEquals((short.value as PreviewValue).as_of_seq, "9");
    assert(!JSON.stringify(short.value).includes(f.root));
    assert(instructionPreview.output.safeParse(short.value).success);
  } finally {
    await f.close();
  }
});

Deno.test("lophn-agent/instructions#R7 R9 [agent-I49]: 긴 파일은 미리보기 상한까지만 주고 실제 크기와 잘림을 알리며 읽을 때마다 파일을 다시 읽는다", async () => {
  const f = await previewFixture();
  try {
    await Deno.writeTextFile(
      `${f.root}/LOPHN.md`,
      "a".repeat(INSTRUCTION_FILE_MAX_BYTES * 3),
    );
    const big = f.preview();
    assert(big.ok);
    const value = (big.value as PreviewValue).preview!;
    assertEquals(value.text.length, INSTRUCTION_PREVIEW_MAX_BYTES);
    assertEquals(value.size_bytes, INSTRUCTION_FILE_MAX_BYTES * 3);
    assertEquals(value.truncated, true);

    await Deno.writeTextFile(`${f.root}/LOPHN.md`, "short now\n");
    const edited = f.preview();
    assert(edited.ok);
    assertEquals((edited.value as PreviewValue).preview?.text, "short now\n");
  } finally {
    await f.close();
  }
});

Deno.test("lophn-agent/instructions#R7 R9 [agent-I49]: 읽지 못하는 파일은 unavailable이고 UTF-8이 아닌 파일은 invalid_input이며 경로가 새지 않는다", async () => {
  const f = await previewFixture();
  try {
    await Deno.mkdir(`${f.root}/LOPHN.md`);
    const unreadable = f.preview();
    assert(!unreadable.ok);
    assertEquals(unreadable.error.code, "unavailable");
    assert(!unreadable.error.message.includes(f.root));

    await Deno.remove(`${f.root}/LOPHN.md`);
    await Deno.writeFile(
      `${f.root}/LOPHN.md`,
      Uint8Array.from([0x61, 0xff, 0xfe]),
    );
    const broken = f.preview();
    assert(!broken.ok);
    assertEquals(broken.error.code, "invalid_input");
    assert(!broken.error.message.includes(f.root));
  } finally {
    await f.close();
  }
});

const USER = "u".repeat(43);
const MACHINE = "m".repeat(43);

async function post(core: Core, path: string, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${USER}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.startsWith("{") ? JSON.parse(text) : {},
  };
}

Deno.test("lophn-agent/instructions#R4 R5 R8 [agent-I19]: 실제 core에서 runtime은 ReadInstructionFile로 전역·project·agent 지침을 파일 그대로 읽고 저장은 다음 call부터 새 hash이며 machine이 아니면 거절된다", async () => {
  const home = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-agent-instr-read-" }),
  );
  const folder = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-agent-instr-read-folder-" }),
  );
  const globalText = "# global\nPrefer short answers.\n";
  const projectText = "# project\nUse the ledger vocabulary.\n";
  await Deno.writeTextFile(`${home}/LOPHN.md`, globalText);
  await Deno.writeTextFile(`${folder}/LOPHN.md`, projectText);
  // coding agent의 별개 파일. 지침 통로가 읽지 않는다.
  await Deno.writeTextFile(`${folder}/AGENTS.md`, "# coding agent rules\n");
  await Deno.mkdir(`${home}/projects/${PROJECT}/agents`, { recursive: true });
  await Deno.writeTextFile(
    `${home}/projects/${PROJECT}/agents/lophn.md`,
    "Greet in Korean.\n",
  );
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [
      { createLedgerRegistration },
      { lophnAgentDefinitions },
      { createLedgerRegistration: createLophnAgentRegistration },
    ],
    teamModules: [
      new URL("./documents.ts", import.meta.url).href,
      new URL("./lophn-agent.ts", import.meta.url).href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(43),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  assert(core.acceptTestCredential);
  const user = {
    principal: "user",
    actor: "user" as const,
    scope: {
      operations: [
        "project.create",
        "ListAssignments",
        "OpenSession",
        "ReadSession",
        "ReceiveMessage",
      ],
      targets: {},
    },
    conditions: {},
    credential_ref: "cred-instr-read-user",
  };
  const machineContext = {
    ...machine,
    credential_ref: "cred-instr-read-machine",
  };
  for (
    const [context, token] of [[user, USER], [machineContext, MACHINE]] as const
  ) {
    assert((await core.acceptTestCredential(context, token)).ok);
    assert((await core.record(context)).ok);
  }
  async function call(token: string, input: unknown) {
    const response = await fetch(
      `http://127.0.0.1:${core.port}${routePath(instructionRead)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
      },
    );
    const parsed = await response.json();
    return response.status === 200 ? ok(parsed) : err({
      code: (parsed.error?.code ?? "internal") as "internal",
      message: parsed.error?.message ?? "",
    });
  }
  try {
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

    // 사람이 연 project 세션의 요청 하나가 run이 된다. 그 run의 작업 자리는 이 project다.
    const listed = await post(core, "assignments/list", {});
    const lophn = (listed.body["assignments"] as {
      id: string;
      role: string;
      revision: number;
    }[]).find((entry) => entry.role === "lophn");
    assert(lophn !== undefined, JSON.stringify(listed.body));
    const envelope = (input: unknown, compare: unknown, key: string) => ({
      input,
      idempotency_key: key,
      compare,
      prepared: [],
    });
    const opened = await post(
      core,
      "sessions/open",
      envelope({
        id: SES,
        assignment: lophn.id,
        work_place: { kind: "project", id: PROJECT },
        opening_context: null,
      }, {
        assignment_revision: lophn.revision,
        assignment_state: "enabled",
      }, "open-session"),
    );
    assertEquals(opened.status, 200, JSON.stringify(opened.body));
    const session = await post(core, "sessions/read", { session: SES });
    const sent = await post(
      core,
      "messages/receive",
      envelope({
        id: MSG,
        session: SES,
        content: {
          schema_version: 1,
          parts: [{ kind: "text", text: "hello" }],
        },
        mode: "request",
      }, {
        session_state: "open",
        session_state_seq: session.body.session.state_seq,
        assignment_revision: lophn.revision,
        assignment_state: "enabled",
      }, "receive-message"),
    );
    assertEquals(sent.status, 200, JSON.stringify(sent.body));
    const run: string = sent.body.message.run;

    const files = instructionFilesOverCore(run, async (input) => {
      const reply = await call(MACHINE, input);
      if (!reply.ok) return reply;
      const parsed = instructionRead.output.safeParse(reply.value);
      return parsed.success
        ? ok(parsed.data)
        : err({ code: "unavailable", message: "unexpected core reply" });
    });
    const redactor = createProductRedactor();
    const deps = {
      files,
      redact: (text: string) =>
        redactor(
          { concern: "lophn-agent/instructions", revision: "1", scope: "test" },
          "text/markdown",
          text,
        ),
    };
    const resolve = async () => {
      const resolved = await resolveInstructions(deps, {
        place: { kind: "project", id: PROJECT },
      });
      assert(resolved.ok, resolved.ok ? "" : resolved.error.message);
      return resolved.value;
    };

    const first = await resolve();
    assertEquals(first.status, "ready", JSON.stringify(first));
    assertEquals(first.layers.map((layer) => layer.kind), [
      "global",
      "project",
      "agent",
    ]);
    assertEquals(first.layers.map((layer) => layer.text), [
      globalText,
      projectText,
      "Greet in Korean.",
    ]);
    assertEquals(first.layers[0].source_hash, await sha256Hex(globalText));
    assert(!JSON.stringify(first).includes(folder));
    assert(!JSON.stringify(first).includes(home));

    // 사람이 editor에서 파일을 저장한다. 다음 읽기부터 새 내용이고 이력은 없다.
    const edited = "# global\nPrefer long answers.\n";
    await Deno.writeTextFile(`${home}/LOPHN.md`, edited);
    const second = await resolve();
    assertEquals(second.layers[0].text, edited);
    assert(second.layers[0].source_hash !== first.layers[0].source_hash);

    // 사람 자격은 이 읽기를 못 쓴다.
    const byUser = await call(USER, { run, layer: "global" });
    assertEquals(byUser.ok, false);

    // 그 run의 작업 자리가 아닌 app 층과 없는 run은 없는 대상과 같은 not_found다.
    const notFound = (reply: { ok: boolean; error?: { code: string } }) => {
      assertEquals(reply.ok, false);
      assertEquals(reply.error?.code, "not_found");
    };
    notFound(await call(MACHINE, { run, layer: "app" }));
    notFound(
      await call(MACHINE, {
        run: "run_01kq12a1pha000000000000000",
        layer: "global",
      }),
    );
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
    await Deno.remove(folder, { recursive: true });
  }
});

Deno.test("lophn-agent/instructions#R9 [agent-I49]: 실제 core에서 사람은 전역 LOPHN.md 미리보기를 읽고 machine 자격은 거절되며 응답에 경로가 없다", async () => {
  const home = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-agent-instr-preview-" }),
  );
  await Deno.writeTextFile(
    `${home}/LOPHN.md`,
    "# global\nPrefer short answers.\n",
  );
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [
      { createLedgerRegistration },
      { lophnAgentDefinitions },
      { createLedgerRegistration: createLophnAgentRegistration },
    ],
    teamModules: [
      new URL("./documents.ts", import.meta.url).href,
      new URL("./lophn-agent.ts", import.meta.url).href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(44),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  assert(core.acceptTestCredential);
  const previewScope = {
    operations: [instructionPreview.name],
    targets: {},
  };
  const user = {
    principal: "user",
    actor: "user" as const,
    scope: previewScope,
    conditions: {},
    credential_ref: "cred-instr-preview-core-user",
  };
  const machineContext = {
    ...machine,
    scope: previewScope,
    credential_ref: "cred-instr-preview-core-machine",
  };
  for (
    const [context, token] of [[user, USER], [machineContext, MACHINE]] as const
  ) {
    assert((await core.acceptTestCredential(context, token)).ok);
    assert((await core.record(context)).ok);
  }
  async function previewAs(token: string) {
    const response = await fetch(
      `http://127.0.0.1:${core.port}${routePath(instructionPreview)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: "{}",
      },
    );
    return { status: response.status, body: await response.json() };
  }
  try {
    const byUser = await previewAs(USER);
    assertEquals(byUser.status, 200, JSON.stringify(byUser.body));
    assertEquals(byUser.body.preview, {
      text: "# global\nPrefer short answers.\n",
      size_bytes: 31,
      truncated: false,
    });
    assert(!JSON.stringify(byUser.body).includes(home));
    // 사람이 아닌 자격은 같은 scope여도 거절이다(route actors는 user뿐).
    const byMachine = await previewAs(MACHINE);
    assertEquals(byMachine.status, 403, JSON.stringify(byMachine.body));
    assertEquals(byMachine.body.error?.code, "forbidden");
    assertEquals(byMachine.body.preview, undefined);
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
