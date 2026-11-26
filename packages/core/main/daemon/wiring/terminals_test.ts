import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import {
  createIdSource,
  cryptoRandom,
  manualClock,
  ok,
  systemClock,
} from "../../../../base/mod.ts";
import { routePath } from "../../../../protocol/base/mod.ts";
import {
  TERMINAL_ROUTES,
  type TerminalOutput,
  terminalsInput,
  terminalsOpen,
  terminalsPasteImage,
  terminalsRestart,
  terminalsSnapshot,
  terminalsWatch,
} from "../../../../protocol/coding-agent/terminals.ts";
import type { BusEvent } from "../../../../protocol/events/bus.ts";
import { dispatchHttp } from "../../../server/dispatch.ts";
import type { MemoryHandler, ReadHandler } from "../../../server/mod.ts";
import type { PtyAdapter } from "../../../terminals/host/pty.ts";
import { serveHost } from "../../../terminals/host/serve.ts";
import { createTerminals } from "../../../terminals/mod.ts";
import { terminalsWiring } from "./terminals.ts";

const PROJECT = `prj_${"0".repeat(26)}`;
const CAPABILITY = "c".repeat(43);

// node-pty 대신 쓰는 PTY. 친 글을 모으고, 테스트가 출력을 낸다. group은 kill하면 죽는다.
function fakePty() {
  const alive = new Set<number>();
  const written: string[] = [];
  const outputs: ((chunk: string) => void)[] = [];
  let pid = 100;
  const pty: PtyAdapter = {
    spawn() {
      const id = pid++;
      alive.add(id);
      return {
        pid: id,
        write: (data) => void written.push(data),
        resize() {},
        kill() {},
        onData(listener) {
          outputs.push(listener);
          return { dispose() {} };
        },
        onExit: () => ({ dispose() {} }),
        foreground: () => null,
      };
    },
    group: (group) => ({
      pid: group,
      kill() {
        alive.delete(group);
        return { confirmed: true };
      },
      alive: () => alive.has(group),
    }),
  };
  return {
    pty,
    alive,
    written,
    emit: (chunk: string) => outputs.at(-1)!(chunk),
  };
}

// PTY host를 subprocess 없이 같은 process에서 돌린다. supervisor는 진짜 host와 같은 pipe 줄로 말한다.
function inProcessHost(pty: PtyAdapter) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const proc = Object.assign(new EventEmitter(), {
    stdin: {
      write: (data: string) => stdin.write(data),
      end: () => stdin.end(),
      on() {},
    },
    stdout,
    stderr: new EventEmitter(),
    killed: false,
    kill: () => true,
  });
  serveHost({
    deps: {
      pty,
      ids: createIdSource({ clock: systemClock, random: cryptoRandom }),
      env: { SHELL: "/bin/sh" },
      platform: "linux",
      exists: () => true,
      checkFolder: (path) => ({ ok: true, path }),
      schedule: (done) => setImmediate(done),
      sleep: async () => {},
    },
    input: stdin,
    write: (line) => stdout.write(`${JSON.stringify(line)}\n`),
    exit: (code) => proc.emit("exit", code, null),
  });
  return proc;
}

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !done(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(done(), "condition was not met in time");
}

async function setup() {
  const fake = fakePty();
  const clock = manualClock(Date.parse("2026-11-18T00:00:00.000Z"));
  const published: BusEvent[] = [];
  const terminals = createTerminals({
    spawnHost: () => inProcessHost(fake.pty),
    personEnv: { cli: null, env: async () => ({ SHELL: "/bin/sh" }) },
    folders: async (project) =>
      ok([{ folder_ref: `${project}_0`, path: tmpdir() }]),
    platform: "linux",
    hostExited() {},
  });
  const slots: Record<string, unknown> = {
    terminals,
    // 기기는 dev_a(허락 없는 컴퓨터), dev_b(허락받은 컴퓨터), dev_phone(모바일 폰, 항상 허용)이다. 살아 있는 capability는 하나다.
    deviceKind: (principal: string) =>
      principal === "device:dev_phone"
        ? "phone"
        : principal.startsWith("device:")
          ? "computer"
          : null,
    terminalInputGrant: (principal: string) => principal === "device:dev_b",
    shellCapabilities: { has: (value: string) => value === CAPABILITY },
  };
  const dataRoot = mkdtempSync(join(tmpdir(), "lophn-terminals-test-"));
  const ctx = {
    clock,
    root: { path: dataRoot },
    peek: slots,
    terminals,
    bus: { publish: (event: BusEvent) => published.push(event) },
    hostQueue: { openTab() {} },
    terminalView: { adopt() {} },
  };
  const wiring = terminalsWiring();
  const built = await wiring.build!(ctx as never);
  assert.ok(built.ok);
  const memory = new Map(
    built.value.memory as Iterable<[string, MemoryHandler]>,
  );
  const reads = new Map<string, ReadHandler>();
  built.value.reads!(reads);
  const opened = await terminals.open({ project: PROJECT as never });
  assert.ok(opened.ok);
  const terminal = opened.value.terminal_ref;

  const call = async (
    route: (typeof TERMINAL_ROUTES)[number],
    actor: string,
    principal: string,
    body: Record<string, unknown>,
  ) => {
    const done = await dispatchHttp(
      new Request(`http://127.0.0.1${routePath(route)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { route, path: routePath(route) },
      {
        principal,
        actor,
        scope: {
          operations: TERMINAL_ROUTES.map((one) => one.name),
          targets: {},
        },
        conditions: {},
        credential_ref: principal,
      },
      {
        credentials: undefined as never,
        clock,
        memory,
        reads,
        bodyTimeoutMs: 1000,
        jsonMaxBytes: 65_536,
      },
    );
    return done as {
      status: number;
      json: { error?: { code: string } } & Record<string, unknown>;
    };
  };
  return {
    fake,
    clock,
    published,
    terminals,
    terminal,
    wiring,
    call,
    cleanup: () => rmSync(dataRoot, { recursive: true, force: true }),
  };
}

test("agent 자격과 터미널 입력 허락이 없는 기기는 터미널에 치거나 다시 띄우지 못한다", async () => {
  const { fake, terminal, wiring, call } = await setup();
  const refused: [string, string, Record<string, unknown>][] = [
    ["agent:ses_x", "agent:ses_x", { shell_capability: CAPABILITY }],
    ["user", "device:dev_a", {}],
    ["user", "user", {}],
    ["user", "user", { shell_capability: "x".repeat(43) }],
  ];
  for (const [actor, principal, extra] of refused) {
    const done = await call(terminalsInput, actor, principal, {
      terminal,
      text: `${principal}\n`,
      ...extra,
    });
    assert.equal(done.json.error?.code, "forbidden", principal);
  }
  assert.deepEqual(fake.written, []);

  const device = await call(terminalsInput, "user", "device:dev_b", {
    terminal,
    text: "from computer\n",
  });
  const phone = await call(terminalsInput, "user", "device:dev_phone", {
    terminal,
    text: "from phone\n",
  });
  const shell = await call(terminalsInput, "user", "user", {
    terminal,
    text: "from desktop\n",
    shell_capability: CAPABILITY,
  });
  assert.equal(device.status, 200);
  assert.equal(phone.status, 200);
  assert.equal(shell.status, 200);
  assert.deepEqual(fake.written, [
    "from computer\n",
    "from phone\n",
    "from desktop\n",
  ]);

  // 다시 띄우기도 같은 자격이다. 허락이 없는 기기와 죽은 capability는 PTY를 다시 띄우지 못한다.
  for (const [principal, extra] of [
    ["device:dev_a", {}],
    ["user", { shell_capability: "x".repeat(43) }],
    ["user", {}],
  ] as const) {
    const refused = await call(terminalsRestart, "user", principal, {
      terminal,
      generation: 1,
      ...extra,
    });
    assert.equal(refused.json.error?.code, "forbidden", principal);
  }
  assert.equal(fake.alive.size, 1);
  // 허락받은 기기(다른 컴퓨터의 창)는 capability 없이 다시 띄운다.
  const restart = await call(terminalsRestart, "user", "device:dev_b", {
    terminal,
    generation: 1,
  });
  assert.equal(restart.status, 200);
  assert.equal((restart.json.runtime as { generation: number }).generation, 2);
  await wiring.closeWork!();
});

test("터미널 입력 허락이 없는 기기가 terminals/open에 command나 resume을 실으면 치지 않는다", async () => {
  const { fake, wiring, call } = await setup();
  const resume = { harness: "claude", external_session: "s1" };
  for (const extra of [{ command: "echo denied" }, { resume }]) {
    const done = await call(terminalsOpen, "user", "device:dev_a", {
      project: PROJECT,
      ...extra,
    });
    assert.equal(done.json.error?.code, "forbidden");
  }
  // 막힌 열기는 터미널도 열지 않는다(setup이 연 하나만 있다).
  assert.equal(fake.alive.size, 1);

  const typedBy = async (principal: string, command: string) => {
    const done = await call(terminalsOpen, "user", principal, {
      project: PROJECT,
      command,
    });
    assert.equal(done.status, 200, principal);
    // 첫 출력이 잦아든 뒤에 친다.
    fake.emit("$ ");
    await until(() => fake.written.includes(`${command}\r`));
  };
  const empty = await call(terminalsOpen, "user", "device:dev_a", {
    project: PROJECT,
  });
  assert.equal(empty.status, 200);
  await typedBy("device:dev_b", "echo granted");
  await typedBy("device:dev_phone", "echo phone");
  await typedBy("user", "echo desktop");
  assert.deepEqual(fake.written, [
    "echo granted\r",
    "echo phone\r",
    "echo desktop\r",
  ]);
  await wiring.closeWork!();
});

test("core가 끝나면 PTY가 남지 않는다", async () => {
  const { fake, terminals, wiring } = await setup();
  const second = await terminals.open({ project: PROJECT as never });
  assert.ok(second.ok);
  assert.equal(fake.alive.size, 2);
  // closeWork가 host stdin을 닫고, host는 stdin EOF에 모든 PTY를 끝낸 뒤 끝난다.
  await wiring.closeWork!();
  assert.equal(fake.alive.size, 0);
});

test("화면이 다시 붙어도 터미널의 출력을 잃거나 두 번 받지 않는다", async () => {
  const { fake, clock, published, terminals, terminal, wiring, call } =
    await setup();
  let seen = 0;
  terminals.onOutput((output) => {
    for (const chunk of output) seen = Math.max(seen, chunk.seq);
  });
  const emit = async (text: string) => {
    const before = seen;
    fake.emit(text);
    await until(() => seen > before);
  };
  const appended = () =>
    published
      .filter((event) => event.type === "TerminalOutputAppended")
      .map((event) => (event.payload as TerminalOutput).seq);
  const watch = () =>
    call(terminalsWatch, "user", "user", { terminal, watcher: "w", on: true });

  // lease가 없으면 Bus에 가지 않는다.
  await emit("a");
  await watch();
  await emit("b");
  await emit("c");
  // lease를 놓쳤다. 그 사이 출력은 Bus에 가지 않는다.
  clock.advance(30_000);
  await emit("d");
  await watch();
  await emit("e");
  assert.deepEqual(appended(), [2, 3, 5]);

  // 다시 붙는 화면은 받은 마지막 seq 뒤를 snapshot으로 받아 놓친 출력(d)을 잇는다.
  const snap = await call(terminalsSnapshot, "user", "user", {
    terminal,
    after_seq: 3,
  });
  const missed = snap.json.output as TerminalOutput[];
  assert.ok(missed.every((chunk) => chunk.seq > 3));
  assert.match(missed.map((chunk) => chunk.chunk).join(""), /de/);
  assert.equal(missed.at(-1)!.seq, 5);
  await wiring.closeWork!();
});

test("terminals/paste_image는 입력 자격을 검사하고 임시 폴더에 안전하게 저장하며 OSC 52 쓰기는 TerminalClipboardWritten을 발행한다", async () => {
  const { fake, published, terminal, wiring, call, cleanup } = await setup();
  try {
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const b64 = pngBytes.toString("base64");

    // 권한 없는 호출자는 거절한다.
    for (const [actor, principal, extra] of [
      ["agent:ses_x", "agent:ses_x", { shell_capability: CAPABILITY }],
      ["user", "device:dev_a", {}],
      ["user", "user", {}],
    ] as const) {
      const denied = await call(terminalsPasteImage, actor, principal, {
        terminal,
        media_type: "image/png",
        data_base64: b64,
        ...extra,
      });
      assert.equal(denied.json.error?.code, "forbidden", principal);
    }

    // 허락받은 컴퓨터·폰·shell capability는 임시 파일로 저장하고 경로·바이트 수를 돌려준다.
    const saved = await call(terminalsPasteImage, "user", "device:dev_b", {
      terminal,
      media_type: "image/png",
      data_base64: b64,
    });
    assert.equal(saved.status, 200);
    const savedPath = saved.json.path as string;
    assert.ok(savedPath.endsWith(".png"));
    assert.equal(saved.json.bytes, pngBytes.byteLength);
    assert.deepEqual(readFileSync(savedPath), pngBytes);

    // 잘못된 base64와 없는 터미널은 거절한다.
    const badB64 = await call(terminalsPasteImage, "user", "user", {
      terminal,
      media_type: "image/jpeg",
      data_base64: "not valid base64!!!",
      shell_capability: CAPABILITY,
    });
    assert.equal(badB64.json.error?.code, "invalid_input");

    const missing = await call(terminalsPasteImage, "user", "user", {
      terminal: "trm_missing",
      media_type: "image/webp",
      data_base64: b64,
      shell_capability: CAPABILITY,
    });
    assert.equal(missing.json.error?.code, "not_found");

    // OSC 52 읽기(`?`)는 발행하지 않고, 쓰기는 바이트 수와 함께 TerminalClipboardWritten을 발행한다.
    fake.emit("\x1b]52;c;?\x07");
    fake.emit(
      `\x1b]52;c;${Buffer.from("hello remote").toString("base64")}\x07`,
    );
    await until(() =>
      published.some((event) => event.type === "TerminalClipboardWritten"),
    );
    const clipEvents = published.filter(
      (event) => event.type === "TerminalClipboardWritten",
    );
    assert.equal(clipEvents.length, 1);
    assert.deepEqual(clipEvents[0]!.payload, {
      terminal,
      bytes: Buffer.byteLength("hello remote"),
    });
  } finally {
    await wiring.closeWork!();
    cleanup();
  }
});
