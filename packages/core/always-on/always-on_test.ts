import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  createIdSource,
  type Logger,
  manualClock,
  seededRandom,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import { type AlwaysOnOs, createAlwaysOn, type Registration } from "./mod.ts";

const base = await mkdtemp(join(tmpdir(), "lophn-always-on-"));
after(() => rm(base, { recursive: true, force: true }));

const clock = manualClock(Date.parse("2026-11-16T00:00:00.000Z"));
const ids = createIdSource({ clock, random: seededRandom(11) });
const HERE = ids.newId("mch") as Id<"mch">;
const ELSEWHERE = ids.newId("mch") as Id<"mch">;

const logger: Logger = {
  log: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  flush: () => Promise.resolve(),
};

let roots = 0;
async function root(): Promise<string> {
  const path = join(base, `root-${++roots}`);
  await mkdir(path);
  return path;
}

async function mark(
  path: string,
  machine: Id<"mch">,
  keepRunning: boolean,
  keepAwake: boolean,
) {
  await writeFile(
    join(path, "always-on.json"),
    JSON.stringify({
      machine,
      keep_running: keepRunning,
      keep_awake: keepAwake,
      service_env: { PATH: "/usr/bin" },
      updated_at: "2026-11-01T00:00:00.000Z",
    }),
  );
}

function fakeOs(answers: {
  read?: Registration;
  register?: Registration;
  unregister?: Registration;
}) {
  const calls: string[] = [];
  const os: AlwaysOnOs = {
    registrar: {
      mechanism: "systemd",
      async read() {
        calls.push("read");
        return answers.read ?? { state: "absent" };
      },
      async register() {
        calls.push("register");
        return answers.register ?? { state: "registered" };
      },
      async unregister() {
        calls.push("unregister");
        return answers.unregister ?? { state: "absent" };
      },
    },
    keepAwake: {
      async hold() {
        calls.push("hold");
        return { state: "held" };
      },
      release() {
        calls.push("release");
      },
      onLost() {},
    },
    captureEnv: () => ({ PATH: "/usr/local/bin:/usr/bin" }),
  };
  return { os, calls };
}

const exists = (path: string) =>
  readFile(join(path, "always-on.json")).then(
    () => true,
    () => false,
  );

test("개발·test core(os 없음)는 keep_running: true를 unavailable로 거절하고 file을 쓰지 않으며, 맞추기를 포함해 OS를 부르지 않는다", async () => {
  const path = await root();
  const service = await createAlwaysOn({
    root: path,
    machine: HERE,
    clock,
    logger,
  });

  for (const input of [
    { keep_running: true },
    { keep_awake: true },
    { keep_running: true, keep_awake: true },
  ]) {
    const refused = await service.set(input);
    assert.equal(refused.ok, false);
    assert.equal(!refused.ok && refused.error.code, "unavailable");
  }
  assert.equal(await exists(path), false);

  // 표시가 켜진 root라도 OS port가 없으면 맞추기는 아무것도 하지 않는다. port가 없어 부를 길이 없다.
  await mark(path, HERE, true, true);
  const marked = await createAlwaysOn({
    root: path,
    machine: HERE,
    clock,
    logger,
  });
  await marked.reconcile();
  await marked.close();
  assert.deepEqual(await marked.refresh(), {
    keep_running: true,
    keep_awake: true,
    start_at_login: "unavailable",
    login_reason: "development_build",
    awake: "released",
    awake_reason: null,
    mechanism: null,
  });
});

test("다른 기계의 always-on.json은 꺼짐으로 읽혀 register·hold를 부르지 않고, 이 기계 OS에 항목이 있을 때만 unregister한다. file이 없는 root는 OS를 부르지 않는다", async () => {
  for (const [answer, expected] of [
    ["registered", ["read", "unregister"]],
    ["stale", ["read", "unregister"]],
    ["off_in_system", ["read", "unregister"]],
    ["absent", ["read"]],
  ] as const) {
    const path = await root();
    await mark(path, ELSEWHERE, true, true);
    const { os, calls } = fakeOs({ read: { state: answer } });
    const service = await createAlwaysOn({
      root: path,
      machine: HERE,
      os,
      clock,
      logger,
    });
    await service.reconcile();
    assert.deepEqual(calls, expected, answer);
    // idle-exit는 이 값으로 막는다.
    assert.equal(service.status().keep_running, false);
    assert.equal(service.status().keep_awake, false);
    // 다른 기계의 표시는 그대로 둔다.
    const kept = JSON.parse(
      await readFile(join(path, "always-on.json"), "utf8"),
    );
    assert.equal(kept.machine, ELSEWHERE);
  }

  const empty = await root();
  const { os, calls } = fakeOs({ read: { state: "registered" } });
  const service = await createAlwaysOn({
    root: empty,
    machine: HERE,
    os,
    clock,
    logger,
  });
  await service.reconcile();
  await service.close();
  assert.deepEqual(calls, []);
});

test("start_at_login이 registered인 것은 port가 registered를 답했을 때뿐이고, 맞추기는 off_in_system을 다시 켜지 않는다", async () => {
  for (const [answer, expected] of [
    [{ state: "registered" }, "registered"],
    [{ state: "stale" }, "not_registered"],
    [{ state: "absent" }, "not_registered"],
    [{ state: "off_in_system" }, "off_in_system"],
    [{ state: "unavailable", reason: "os_failed" }, "unavailable"],
  ] as const) {
    const path = await root();
    const { os } = fakeOs({ register: answer });
    const service = await createAlwaysOn({
      root: path,
      machine: HERE,
      os,
      clock,
      logger,
    });
    const done = await service.set({ keep_running: true });
    assert.ok(done.ok);
    assert.equal(done.value.start_at_login, expected, answer.state);
    // 등록이 실패해도 사람의 표시는 남는다.
    assert.equal(done.value.keep_running, true);
    const written = JSON.parse(
      await readFile(join(path, "always-on.json"), "utf8"),
    );
    assert.equal(written.machine, HERE);
    assert.equal(written.keep_running, true);
  }

  const off = await root();
  await mark(off, HERE, true, false);
  const { os, calls } = fakeOs({ read: { state: "off_in_system" } });
  const service = await createAlwaysOn({
    root: off,
    machine: HERE,
    os,
    clock,
    logger,
  });
  await service.reconcile();
  assert.deepEqual(calls, ["read"]);
  assert.equal(service.status().start_at_login, "off_in_system");
  assert.equal(service.status().keep_running, true);

  // 빠진 등록은 다시 쓴다.
  const missing = await root();
  await mark(missing, HERE, true, true);
  const again = fakeOs({ read: { state: "absent" } });
  const restored = await createAlwaysOn({
    root: missing,
    machine: HERE,
    os: again.os,
    clock,
    logger,
  });
  await restored.reconcile();
  assert.deepEqual(again.calls, ["read", "register", "hold"]);
  assert.equal(restored.status().start_at_login, "registered");
});
