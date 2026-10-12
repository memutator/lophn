import { assert, assertEquals } from "@std/assert";
import {
  acquireInstanceLock,
  daemonStart,
  daemonStatus,
  daemonStop,
  readRunMetadata,
  resolveDataRoot,
  writeRunMetadata,
} from "./mod.ts";

// 시작은 창 없이 Electron main을 띄우는 결정을 내놓는다. 실제 launcher가
// 실행하므로 테스트도 argv·env만 본다(Electron은 deno test에서 뜨지 않는다).
Deno.test("platform/install-and-update#R10: start is windowless tray argv with LOPHN_HOME and no credential", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-start-" });
  try {
    const resolved = await resolveDataRoot({ lophnHome: root });
    assert(resolved.ok, "데이터 root 검사는 temp dir에서 통과한다");
    const started = daemonStart(resolved.value.path, "lophn-desktop");
    assert(started.ok);
    assertEquals(started.value.argv, ["--tray"]);
    assertEquals(started.value.executable, "lophn-desktop");
    assertEquals(started.value.env, { LOPHN_HOME: resolved.value.path });
    const envRecord: Record<string, string> = started.value.env;
    for (const key of Object.keys(envRecord)) {
      assert(
        !/token|credential|secret/i.test(key),
        `env key에 credential 모양이 없다: ${key}`,
      );
    }
    assert(!started.value.argv.join(" ").includes("--quit"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/install-and-update#R10: second writer in the same data folder is refused", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-lock-" });
  try {
    const resolved = await resolveDataRoot({ lophnHome: root });
    assert(resolved.ok);
    const first = await acquireInstanceLock(resolved.value.run);
    assert(first.ok, "첫 writer는 lock을 가진다");
    const second = await acquireInstanceLock(resolved.value.run);
    assert(!second.ok, "두 번째 writer는 거절이다");
    assertEquals(second.error.code, "conflict");
    assertEquals(
      second.error.message,
      "이 데이터 폴더에는 이미 실행 중인 instance가 있다",
    );
    // 거절된 writer는 metadata를 바꾸지 않는다.
    const status = await daemonStatus(resolved.value.run);
    assert(status.ok);
    assertEquals(status.value.state, "running");
    await first.value.release();
    const after = await daemonStatus(resolved.value.run);
    assert(after.ok);
    assertEquals(after.value.state, "absent");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/install-and-update#R10: independent data folders run separately", async () => {
  const first = await Deno.makeTempDir({ prefix: "daemon-a-" });
  const second = await Deno.makeTempDir({ prefix: "daemon-b-" });
  try {
    const left = await resolveDataRoot({ lophnHome: first });
    const right = await resolveDataRoot({ lophnHome: second });
    assert(left.ok && right.ok);
    const leftLock = await acquireInstanceLock(left.value.run);
    assert(leftLock.ok, "다른 폴더의 writer는 서로를 막지 않는다");
    const rightLock = await acquireInstanceLock(right.value.run);
    assert(rightLock.ok, "다른 폴더의 writer는 서로를 막지 않는다");
    await leftLock.value.release();
    await rightLock.value.release();
  } finally {
    await Deno.remove(first, { recursive: true });
    await Deno.remove(second, { recursive: true });
  }
});

// Electron 없는 server 실행은 없다. 시작은 launcher의 `--tray` 하나다.
Deno.test("platform/install-and-update#R12: start launches Electron main and no Electron-less server exists", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-e-" });
  try {
    const resolved = await resolveDataRoot({ lophnHome: root });
    assert(resolved.ok);
    const started = daemonStart(resolved.value.path, "lophn-desktop");
    assert(started.ok);
    // launcher argv는 `--tray`만이고 deno server entry는 넣지 않는다.
    assertEquals(started.value.argv.length, 1);
    assertEquals(started.value.argv, ["--tray"]);
    for (const arg of started.value.argv) {
      assert(
        !arg.endsWith("main.ts") && !arg.includes("deno"),
        `server 실행 argv가 없다: ${arg}`,
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/install-and-update#R12: quitting all windows does not stop the daemon and quit goes through single-instance", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-q-" });
  try {
    const resolved = await resolveDataRoot({ lophnHome: root });
    assert(resolved.ok);
    // 창 닫기는 core를 멈추지 않는다: lock은 그대로 있고 state는 running이다.
    const lock = await acquireInstanceLock(resolved.value.run);
    assert(lock.ok);
    const status = await daemonStatus(resolved.value.run);
    assert(status.ok);
    assertEquals(status.value.state, "running");
    // 중지는 OS single-instance 통로 `--quit`의 second-instance 요청이다.
    // descriptor에 API token·coding credential은 없다.
    const stopped = daemonStop(resolved.value.path, "lophn-desktop");
    assert(stopped.ok);
    assertEquals(stopped.value.argv, ["--quit"]);
    assertEquals(stopped.value.env, { LOPHN_HOME: resolved.value.path });
    assert(
      !/token|credential|secret/i.test(
        stopped.value.executable + stopped.value.argv.join(" ") +
          Object.keys(stopped.value.env).join(" "),
      ),
      "중지 요청의 argv·env에 credential 모양이 없다",
    );
    await lock.value.release();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/install-and-update#R12: status reads run metadata without a token and metadata holds no credential", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-s-" });
  try {
    const resolved = await resolveDataRoot({ lophnHome: root });
    assert(resolved.ok);
    const written = await writeRunMetadata(resolved.value.run, {
      apiPort: 7431,
      coreEpoch: "0123456789abcdef",
      startedAt: "2026-10-05T00:00:00.000Z",
    });
    assert(written.ok);
    const read = await readRunMetadata(resolved.value.run);
    assert(read.ok);
    assertEquals(read.value.api_port, 7431);
    assertEquals(read.value.core_epoch, "0123456789abcdef");
    assertEquals(read.value.started_at, "2026-10-05T00:00:00.000Z");
    assertEquals(read.value.format, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/install-and-update#R12: absent instance reads metadata as not_found, not a token error", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-a2-" });
  try {
    const resolved = await resolveDataRoot({ lophnHome: root });
    assert(resolved.ok);
    const read = await readRunMetadata(resolved.value.run);
    assert(!read.ok);
    assertEquals(read.error.code, "not_found");
    const status = await daemonStatus(resolved.value.run);
    assert(status.ok);
    assertEquals(status.value.state, "absent");
    assertEquals(status.value.metadata, "absent");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/install-and-update#R12: unsafe root and bad executable are refused before any process decision", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-u-" });
  try {
    const noRoot = daemonStart("relative/path", "lophn-desktop");
    assert(!noRoot.ok);
    assertEquals(noRoot.error.code, "invalid_input");
    const noName = daemonStart(root, "");
    assert(!noName.ok);
    assertEquals(noName.error.code, "invalid_input");
    const noStopName = daemonStop(root, "");
    assert(!noStopName.ok);
    assertEquals(noStopName.error.code, "invalid_input");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/install-and-update#R12: lock file stays 0600 and reading runs under OS user permission", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-p-" });
  try {
    const resolved = await resolveDataRoot({ lophnHome: root });
    assert(resolved.ok);
    const lock = await acquireInstanceLock(resolved.value.run);
    assert(lock.ok);
    const status = await Deno.stat(`${resolved.value.run}/instance.lock`);
    assertEquals(status.mode! & 0o777, 0o600);
    await lock.value.release();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
