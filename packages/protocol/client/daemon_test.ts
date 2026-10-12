import { assert, assertEquals } from "@std/assert";
import { daemonStart, daemonStatus, daemonStop } from "./daemon.ts";
import { readRunMetadata, RUN_METADATA_NAME } from "./run-metadata.ts";

// 시작은 창 없이 Electron main을 띄우는 결정을 내놓는다. 실제 launcher가
// 실행하므로 테스트도 argv·env만 본다(Electron은 deno test에서 뜨지 않는다).
Deno.test("platform/install-and-update#R10: start is windowless tray argv with LOPHN_HOME and no credential", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-start-" });
  try {
    const started = daemonStart(root, "lophn-desktop");
    assert(started.ok);
    assertEquals(started.value.argv, ["--tray"]);
    assertEquals(started.value.executable, "lophn-desktop");
    assertEquals(started.value.env, { LOPHN_HOME: root });
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

// Electron 없는 server 실행은 없다. 시작은 launcher의 `--tray` 하나다.
Deno.test("platform/install-and-update#R12: start launches Electron main and no Electron-less server exists", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-e-" });
  try {
    const started = daemonStart(root, "lophn-desktop");
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

Deno.test("platform/install-and-update#R12: absent instance reads metadata as not_found, not a token error", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-a2-" });
  try {
    const read = await readRunMetadata(root);
    assert(!read.ok);
    assertEquals(read.error.code, "not_found");
    const status = await daemonStatus(root);
    assert(status.ok);
    assertEquals(status.value.state, "absent");
    assertEquals(status.value.metadata, "absent");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/install-and-update#R12: run metadata file reads back as a location and status sees it", async () => {
  const root = await Deno.makeTempDir({ prefix: "daemon-s-" });
  try {
    await Deno.writeTextFile(
      `${root}/${RUN_METADATA_NAME}`,
      JSON.stringify({
        format: 1,
        api_port: 7431,
        core_epoch: "0123456789abcdef",
        started_at: "2026-10-05T00:00:00.000Z",
      }),
    );
    const read = await readRunMetadata(root);
    assert(read.ok);
    assertEquals(read.value.api_port, 7431);
    assertEquals(read.value.format, 1);
    const status = await daemonStatus(root);
    assert(status.ok);
    assertEquals(status.value.metadata, "present");
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
