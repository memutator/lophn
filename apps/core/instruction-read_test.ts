// lophn-agent/instructions#R4 R5 R8: agent runtime은 ledger를 열지 않고 core의 ReadInstructionFile
// 하나로 사람 지침의 확정 판을 받는다. 실제 core의 machine 자격 HTTP 읽기를 runtime의 InstructionFiles
// 어댑터(instructionFilesOverCore)에 꽂아 resolveInstructions가 전역→project 층을 읽고, 사람의 편집은
// 다음 읽기부터 새 판으로 보이며, machine이 아닌 자격은 읽지 못함을 본다. 데이터 root와 폴더는 모두
// temp dir다. 사람 데이터 root(~/.lophn, ~/.config/lophn)는 열지 않는다. model provider는 부르지 않는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  manualClock,
  seededRandom,
  sha256Hex,
} from "../../packages/base/mod.ts";
import { type Core, startCore } from "./core.ts";
import { createLedgerRegistration } from "./documents.ts";
import {
  createLedgerRegistration as createLophnAgentRegistration,
  lophnAgentDefinitions,
} from "./lophn-agent.ts";
import { createProductRedactor } from "./documents-redactor.ts";
import {
  instructionFilesOverCore,
  resolveInstructions,
} from "../../packages/lophn-agent/instructions/mod.ts";
import { instructionRead } from "../../packages/contracts/lophn-agent/mod.ts";
import { routePath } from "../../packages/contracts/platform/mod.ts";
import { err, ok } from "../../packages/base/mod.ts";

const PROJECT = "prj_01kq12a1pha000000000000000";
const APP = "app_01kq12a1pha000000000000000";
const USER = "u".repeat(43);
const MACHINE = "m".repeat(43);

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

Deno.test("lophn-agent/instructions#R4 R5 R8: runtime은 core의 ReadInstructionFile로 전역·project 지침 확정 판을 읽고 편집은 다음 읽기부터 새 판이며 machine이 아니면 거절된다", async () => {
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
      operations: ["project.create", "files.write", "document.upload"],
      targets: {},
    },
    conditions: {},
    credential_ref: "cred-instr-read-user",
  };
  const machine = {
    principal: "machine:agent-runtime",
    actor: "machine" as const,
    scope: { operations: [instructionRead.name], targets: {} },
    conditions: {},
    credential_ref: "cred-instr-read-machine",
  };
  for (const [context, token] of [[user, USER], [machine, MACHINE]] as const) {
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
    await until(
      "both versions",
      () => versionCount(home) === 2 ? true : undefined,
    );

    const files = instructionFilesOverCore(async (input) => {
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
        attachments: [],
      });
      assert(resolved.ok, resolved.ok ? "" : resolved.error.message);
      return resolved.value;
    };

    const first = await resolve();
    assertEquals(first.status, "ready", JSON.stringify(first));
    assertEquals(first.layers.map((layer) => layer.kind), [
      "global",
      "project",
    ]);
    assertEquals(first.layers.map((layer) => layer.text), [
      globalText,
      projectText,
    ]);
    assertEquals(first.layers[0].source_hash, await sha256Hex(globalText));
    assert(!JSON.stringify(first).includes(folder));
    assert(!JSON.stringify(first).includes(home));

    // 사람의 편집은 새 확정 판이 되고 다음 읽기부터 새 판으로 읽힌다.
    const edited = "# global\nPrefer long answers.\n";
    const saved = await post(core, "files/write", {
      request_key: "agent-instr-read-1",
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
    const second = await resolve();
    assertEquals(second.layers[0].text, edited);
    assert(second.layers[0].version !== first.layers[0].version);

    // 연결된 문서가 없는 자리는 부재, 없는 붙은 문서는 오류다. 사람 자격은 이 읽기를 못 쓴다.
    const missing = await call(MACHINE, {
      location: { layer: "app", place: APP },
    });
    assert(missing.ok);
    assertEquals((missing.value as { file: unknown }).file, null);
    const detached = await call(MACHINE, {
      document: "doc_01kq12a1pha000000000000000",
    });
    assertEquals(detached.ok, false);
    const byUser = await call(USER, {
      location: { layer: "global", place: "global" },
    });
    assertEquals(byUser.ok, false);
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
    await Deno.remove(folder, { recursive: true });
  }
});
