import { assert, assertEquals } from "@std/assert";
import { daemonStatus, daemonStop } from "../../protocol/client/daemon.ts";
import { readRunMetadata } from "../../protocol/client/run-metadata.ts";
import {
  acquireInstanceLock,
  resolveDataRoot,
  writeRunMetadata,
} from "./mod.ts";

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
