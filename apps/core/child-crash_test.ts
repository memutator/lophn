// 감독하는 child(documents coordinator, I/O worker)가 crash할 때 core가 하는 일을 실제 core로 본다.
// child는 같은 process 안의 가짜다(testing/in-process-io.ts): 요청에 답하지 않아 요청이 child에
// 묶인 채 남고, 시험이 crash를 일으킨다. 데이터 root와 폴더는 temp dir다. 사람 데이터 root
// (~/.lophn, ~/.config/lophn)는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { type Core, startCore } from "./core.ts";
import { createLedgerRegistration } from "./documents.ts";
import { inProcessIo } from "./testing/in-process-io.ts";

const PROJECT = "prj_01kq12a1pha000000000000000";
const USER = "u".repeat(43);
const OPERATIONS = [
  "project.create",
  "project.preview_tracking",
  "document.upload",
];

type Opened = {
  core: Core;
  home: string;
  folder: string;
  io: ReturnType<typeof inProcessIo>;
  dispose(): Promise<void>;
};

async function open(stall: readonly string[] = []): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-child-crash-" });
  const folder = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-child-crash-folder-" }),
  );
  const io = inProcessIo({ root: home, stall });
  const dispose = async (core?: Core) => {
    await core?.shutdown();
    await Deno.remove(home, { recursive: true });
    await Deno.remove(folder, { recursive: true });
  };
  let core: Core | undefined;
  try {
    const started = await startCore({
      lophnHome: home,
      port: 0,
      teams: [{ createLedgerRegistration }],
      teamModules: [new URL("./documents.ts", import.meta.url).href],
      clock: manualClock(Date.UTC(2024, 0, 1)),
      random: seededRandom(41),
      testCredentials: true,
      spawn: io.spawn,
    });
    assert(started.ok, started.ok ? "" : started.error.message);
    core = started.value;
    const context: AuthenticatedContext = {
      principal: "user",
      actor: "user",
      scope: { operations: OPERATIONS, targets: {} },
      conditions: {},
      credential_ref: "cred-child-crash",
    };
    assert(core.acceptTestCredential);
    const accepted = await core.acceptTestCredential(context, USER);
    assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    const recorded = await core.record(context);
    assert(recorded.ok, recorded.ok ? "" : recorded.error.message);
  } catch (thrown) {
    // 띄운 core를 닫지 않으면 서버·worker가 test process를 붙들어 실패가 멈춤으로 바뀐다.
    await dispose(core);
    throw thrown;
  }
  const opened = core;
  return { core: opened, home, folder, io, dispose: () => dispose(opened) };
}

function post(opened: Opened, path: string, body: unknown) {
  return fetch(`http://127.0.0.1:${opened.core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${USER}`,
    },
    body: JSON.stringify(body),
  });
}

async function until(
  what: string,
  ready: () => boolean,
  timeoutMs = 40_000,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out: ${what}`);
}

// 기한 안에 끝나지 않으면 던진다. 끝나지 않는 요청이 시험을 붙들지 않는다.
async function within<T>(what: string, work: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${what} did not finish within ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function createProject(opened: Opened) {
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
  const body = await created.json() as { revision: string };
  assertEquals(created.status, 200, JSON.stringify(body));
  return body;
}

function previewRequest(opened: Opened, revision: string) {
  return post(opened, "projects/preview_tracking", {
    project: PROJECT,
    base_revision: revision,
    folders: [{ path: opened.folder, description: "a" }],
    tracking: {
      enabled: true,
      patterns: [{ effect: "include", glob: "**/*.md" }],
      use_gitignore: false,
    },
  });
}

Deno.test("platform/responsiveness#R3: documents coordinator가 crash하면 보낸 요청은 기한(70초)까지 기다리지 않고 바로 끝나고 감독이 다시 띄운다", async () => {
  const opened = await open();
  try {
    const { revision } = await createProject(opened);
    const before = opened.io.writes("documents/worker");
    // 이 child는 답하지 않는다. 요청이 coordinator에 묶인 채 남는다.
    const held = previewRequest(opened, revision);
    await until(
      "the request reached the coordinator",
      () => opened.io.writes("documents/worker") > before,
    );
    assert(opened.io.crash("documents/worker"));
    const reply = await within("the lost request", held, 15_000);
    assertEquals(reply.status, 503, await reply.text());
    await until(
      "the supervisor restarts the coordinator",
      () => opened.io.spawned("documents/worker") >= 2,
    );
  } finally {
    await opened.dispose();
  }
});

Deno.test("platform/responsiveness#R3: 감독이 포기한 documents coordinator는 core가 backoff로 다시 띄운다", async () => {
  const opened = await open();
  try {
    // crash마다 감독이 3번까지 다시 띄운다(1·2·4초). 네 번째 crash 뒤 감독은 포기한다.
    for (let spawned = 1; spawned <= 4; spawned++) {
      await until(
        `coordinator ${spawned} is started`,
        () => opened.io.spawned("documents/worker") >= spawned,
      );
      assert(opened.io.crash("documents/worker"));
    }
    // 포기한 뒤에도 core가 한 번 더 띄운다. 감독만이라면 여기서 4번에 멈춘다.
    await until(
      "core respawns the coordinator the supervisor gave up on",
      () => opened.io.spawned("documents/worker") >= 5,
    );
  } finally {
    await opened.dispose();
  }
});

Deno.test("platform/responsiveness#R3: I/O worker가 crash하면 blob 준비 요청은 기한(30초)까지 기다리지 않고 바로 끝난다", async () => {
  const opened = await open(["platform/io"]);
  try {
    const bytes = new TextEncoder().encode("# a\n");
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = [...new Uint8Array(digest)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    const input = btoa(JSON.stringify({ blob_hash: hash, bytes: bytes.length }))
      .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    const before = opened.io.writes("platform/io");
    // 이 I/O worker는 credit도 응답도 주지 않는다. 준비가 worker에 묶인 채 남는다.
    const held = fetch(
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
    await until(
      "the preparation reached the I/O worker",
      () => opened.io.writes("platform/io") > before,
    );
    assert(opened.io.crash("platform/io"));
    const reply = await within("the lost preparation", held, 15_000);
    assertEquals(reply.status, 503, await reply.text());
    await until(
      "the supervisor restarts the I/O worker",
      () => opened.io.spawned("platform/io") >= 2,
    );
  } finally {
    await opened.dispose();
  }
});
