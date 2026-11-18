import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
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
    // 기기는 dev_a와 dev_b이고 dev_b만 허락받았다. 살아 있는 capability는 하나다.
    deviceKind: (principal: string) =>
      principal.startsWith("device:") ? "phone" : null,
    terminalInputGrant: (principal: string) => principal === "device:dev_b",
    shellCapabilities: { has: (value: string) => value === CAPABILITY },
  };
  const ctx = {
    clock,
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
  return { fake, clock, published, terminals, terminal, wiring, call };
}

test("agent 자격과 터미널 입력 허락이 없는 기기는 터미널에 치지 못한다", async () => {
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
    text: "from phone\n",
  });
  const shell = await call(terminalsInput, "user", "user", {
    terminal,
    text: "from desktop\n",
    shell_capability: CAPABILITY,
  });
  assert.equal(device.status, 200);
  assert.equal(shell.status, 200);
  assert.deepEqual(fake.written, ["from phone\n", "from desktop\n"]);

  const restart = await call(terminalsRestart, "user", "user", {
    terminal,
    generation: 1,
    shell_capability: "x".repeat(43),
  });
  assert.equal(restart.json.error?.code, "forbidden");
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
  await typedBy("user", "echo desktop");
  assert.deepEqual(fake.written, ["echo granted\r", "echo desktop\r"]);
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
