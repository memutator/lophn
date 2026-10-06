// lophn-agent/instructions#R1 R2 R5 R7 R8 끝에서 끝까지: 실제 core의 documents가 관측한 전역·project
// LOPHN.md의 확정 판을 core.instructionFiles가 읽고, agent 쪽 resolveInstructions가 층·hash·상한을
// 정한다. 사람의 편집(files.write)은 다음 call부터 새 판으로 보이고 AGENTS.md 같은 다른 파일은 읽지
// 않는다. 데이터 root와 폴더는 모두 temp dir다. 사람 데이터 root(~/.lophn, ~/.config/lophn)는 열지
// 않는다. model provider는 부르지 않는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  manualClock,
  seededRandom,
  sha256Hex,
} from "../../packages/base/mod.ts";
import { type Core, startCore } from "./core.ts";
import { createLedgerRegistration } from "./documents.ts";
import { createProductRedactor } from "./documents-redactor.ts";
import {
  INSTRUCTION_FILE_MAX_BYTES,
  type InstructionResolution,
  resolveInstructions,
} from "../../packages/lophn-agent/instructions/mod.ts";

const PROJECT = "prj_01kq12a1pha000000000000000";
const APP = "app_01kq12a1pha000000000000000";
const USER = "u".repeat(43);

const encoder = new TextEncoder();

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

function versionCount(home: string): number {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const row = db.prepare("SELECT count(*) AS n FROM versions").get() as {
      n: number;
    };
    return row.n;
  } finally {
    db.close();
  }
}

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

async function upload(core: Core, text: string) {
  const bytes = encoder.encode(text);
  const input = btoa(JSON.stringify({
    blob_hash: await sha256Hex(text),
    bytes: bytes.length,
  })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const response = await fetch(
    `http://127.0.0.1:${core.port}/v1/documents/upload`,
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
  return await response.json();
}

Deno.test("lophn-agent/instructions#R1 R5 R7 R8: 실제 core의 전역·project 지침 확정 판을 층 순서대로 읽고 편집은 다음 call부터 새 hash로 보이며 AGENTS.md와 app 층 부재는 지침이 되지 않는다", async () => {
  const home = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-agent-instr-" }),
  );
  const folder = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-agent-instr-folder-" }),
  );
  const globalText = "# global\nPrefer short answers.\n";
  const projectText = "# project\nUse the ledger vocabulary.\n";
  await Deno.writeTextFile(`${home}/LOPHN.md`, globalText);
  await Deno.writeTextFile(`${folder}/LOPHN.md`, projectText);
  // coding agent의 별개 파일. 지침 통로가 읽지 않는다.
  await Deno.writeTextFile(`${folder}/AGENTS.md`, "# coding agent rules\n");
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createLedgerRegistration }],
    teamModules: [new URL("./documents.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(43),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  assert(core.acceptTestCredential);
  const context = {
    principal: "user",
    actor: "user" as const,
    scope: {
      operations: [
        "project.create",
        "files.write",
        "document.upload",
      ],
      targets: {},
    },
    conditions: {},
    credential_ref: "cred-agent-instr-user",
  };
  const accepted = await core.acceptTestCredential(context, USER);
  assert(accepted.ok);
  assert((await core.record(context)).ok);
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
    await until(
      "both versions",
      () => versionCount(home) === 2 ? true : undefined,
    );

    const redactor = createProductRedactor();
    const deps = {
      files: core.instructionFiles,
      redact: (text: string) =>
        redactor(
          { concern: "lophn-agent/instructions", revision: "1", scope: "test" },
          "text/markdown",
          text,
        ),
    };
    const resolve = async (
      place: { kind: "project"; id: string } | { kind: "app"; id: string },
    ): Promise<InstructionResolution> => {
      const resolved = await resolveInstructions(deps, {
        place,
        attachments: [],
      });
      assert(resolved.ok, resolved.ok ? "" : resolved.error.message);
      return resolved.value;
    };

    const first = await resolve({ kind: "project", id: PROJECT });
    assertEquals(first.status, "ready");
    assertEquals(first.layers.map((layer) => layer.kind), [
      "global",
      "project",
    ]);
    assertEquals(first.layers.map((layer) => layer.text), [
      globalText,
      projectText,
    ]);
    const [global, scoped] = first.layers;
    assertEquals(global.status, "present");
    assertEquals(global.source_hash, await sha256Hex(globalText));
    assertEquals(global.transmitted_hash, await sha256Hex(globalText));
    assertEquals(scoped.place, PROJECT);
    assertEquals(scoped.bytes, encoder.encode(projectText).length);
    assert(!JSON.stringify(first).includes("coding agent rules"));
    assert(!JSON.stringify(first).includes(folder));
    assert(!JSON.stringify(first).includes(home));

    // app 층은 앱 자리 파일 등록이 생기기 전이라 부재다. 사람이 저장하기 전의 빈 지침은 없다.
    const appPlace = await resolve({ kind: "app", id: APP });
    assertEquals(appPlace.status, "ready");
    assertEquals(
      appPlace.layers.map((layer) => [layer.kind, layer.status]),
      [["global", "present"], ["app", "absent"]],
    );

    // 사람의 편집(base_hash CAS)은 새 확정 판이 되고 다음 call부터 새 hash로 읽힌다.
    const edited = "# global\nPrefer long answers.\n";
    const saved = await post(core, "files/write", {
      request_key: "agent-instr-1",
      target: {
        kind: "instruction_file",
        instruction_target: "global",
        project: null,
        path: `${home}/LOPHN.md`,
      },
      base_hash: await sha256Hex(globalText),
      content: { kind: "prepared", blob: await upload(core, edited) },
    });
    assertEquals(saved.status, 200, JSON.stringify(saved.body));
    await until(
      "second version",
      () => versionCount(home) === 3 ? true : undefined,
    );
    const second = await resolve({ kind: "project", id: PROJECT });
    assertEquals(second.layers[0].text, edited);
    assertEquals(second.layers[0].source_hash, await sha256Hex(edited));
    assert(second.layers[0].version !== global.version);
    assertEquals(second.layers[1].version, scoped.version);
    // 앞 call의 snapshot은 당시 판 그대로다.
    assertEquals(first.layers[0].text, globalText);

    // 32 KiB를 넘는 지침은 잘라 읽지 않고 call을 멈춘다.
    const large = "a".repeat(INSTRUCTION_FILE_MAX_BYTES + 1);
    const grown = await post(core, "files/write", {
      request_key: "agent-instr-2",
      target: {
        kind: "instruction_file",
        instruction_target: "global",
        project: null,
        path: `${home}/LOPHN.md`,
      },
      base_hash: await sha256Hex(edited),
      content: { kind: "prepared", blob: await upload(core, large) },
    });
    assertEquals(grown.status, 200, JSON.stringify(grown.body));
    await until(
      "third version",
      () => versionCount(home) === 4 ? true : undefined,
    );
    const blocked = await resolve({ kind: "project", id: PROJECT });
    assertEquals(blocked.status, "blocked");
    assertEquals(blocked.layers[0].status, "too_large");
    assert(blocked.layers.every((layer) => layer.text === null));
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
    await Deno.remove(folder, { recursive: true });
  }
});
