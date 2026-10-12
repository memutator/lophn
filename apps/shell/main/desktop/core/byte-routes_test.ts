// main client의 편집기 통로(shell#T17)가 실제 core 위에서 도는지 본다. 파일 읽기 stream·업로드·
// 파일 쓰기 worker route를 temp LOPHN_HOME core와 temp 폴더로 부른다. renderer allowlist는
// 그대로라 renderer는 파일 쓰기 route를 부르지 못한다. 사람 데이터 root는 열지 않는다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { type ChildProcess, spawn } from "node:child_process";

import {
  FrameDecoder,
  mainHelloSchema,
} from "../../../../../packages/protocol/platform/mod.ts";

import { openSession } from "./client.ts";
import { nodeFetch, nodeStreamFetch } from "./node-io.ts";

function spawnCore(home: string, repoRoot: string): ChildProcess {
  return spawn(
    "deno",
    ["run", "--allow-all", "apps/core/main.ts", "--port=0"],
    {
      cwd: repoRoot,
      env: { ...process.env, LOPHN_HOME: home },
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
}

function hello(
  stream: NodeJS.ReadableStream,
): Promise<{ user_token: string; api_port: number; core_epoch: string }> {
  const decoder = new FrameDecoder();
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error("core hello가 60초 안에 오지 않았다")),
      60_000,
    );
    stream.on("data", (chunk: Uint8Array) => {
      for (const frame of decoder.push(new Uint8Array(chunk))) {
        if (frame.kind !== "json") continue;
        const parsed = mainHelloSchema.safeParse(frame.payload);
        if (parsed.success) {
          clearTimeout(deadline);
          resolve(parsed.data);
          return;
        }
      }
    });
    stream.on("end", () => reject(new Error("core가 hello 전에 끝났다")));
  });
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

test("shell/editor#R12: main client는 파일 읽기 stream·업로드·파일 쓰기를 실제 core에 부르고, renderer allowlist는 파일 쓰기를 막는다", async () => {
  const home = await mkdtemp(`${tmpdir()}/lophn-shell-bytes-`);
  const folder = await realpath(
    await mkdtemp(`${tmpdir()}/lophn-shell-bytes-folder-`),
  );
  const repoRoot = new URL("../../../../../", import.meta.url).pathname;
  const child = spawnCore(home, repoRoot);
  try {
    const core = await hello(child.stdout!);
    const session = openSession({
      apiPort: core.api_port,
      coreEpoch: core.core_epoch,
      userToken: core.user_token,
      fetch: nodeFetch,
      stream: nodeStreamFetch,
    });
    // 추적을 끈 프로젝트 폴더도 사람 파일 통로의 목표다(documents#T12).
    const project = "prj_01kq12a1pha000000000000000";
    const created = await session.call("command", "projects", "create", {
      input: {
        id: project,
        name: "notes",
        title: "Notes",
        purpose: "",
        folders: [{ path: folder, description: "notes" }],
        tracking: { enabled: false, patterns: [], use_gitignore: false },
      },
      idempotency_key: "shell-bytes-create",
      compare: {},
      prepared: [],
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    const path = `${folder}/plan.md`;
    await writeFile(path, "# Plan\n");
    const target = { kind: "project_file", project, path };

    // stream 읽기: 바이트 그대로, 상한을 넘으면 끊는다. 등록 폴더가 documents coordinator에
    // 닿을 때까지 기다린다.
    let read = await session.readStream("files", "read", { target }, 1024);
    for (let tries = 0; !read.ok && tries < 100; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      read = await session.readStream("files", "read", { target }, 1024);
    }
    assert.equal(read.ok, true, JSON.stringify(read));
    if (read.ok) assert.equal(new TextDecoder().decode(read.value), "# Plan\n");
    const capped = await session.readStream("files", "read", { target }, 3);
    assert.equal(capped.ok, false);
    if (!capped.ok) assert.equal(capped.error.code, "too_large");

    // 업로드한 준비 참조로 파일을 쓴다.
    const next = "# Plan\n\nedited\n";
    const bytes = new TextEncoder().encode(next);
    const blob = await session.upload(
      "documents",
      "upload",
      { blob_hash: sha(next), bytes: bytes.byteLength },
      bytes,
    );
    assert.equal(blob.ok, true, JSON.stringify(blob));
    const written = await session.internal("worker", "files", "write", {
      request_key: "shell-bytes-write-1",
      target,
      base_hash: sha("# Plan\n"),
      content: { kind: "prepared", blob: blob.ok ? blob.value : null },
    });
    assert.equal(written.ok, true, JSON.stringify(written));
    if (written.ok) {
      const value = written.value as { outcome: string; written_hash: string };
      assert.equal(value.outcome, "written");
      assert.equal(value.written_hash, sha(next));
    }
    assert.equal(await readFile(path, "utf8"), next);

    // 낡은 base_hash는 conflict이고 파일은 그대로다.
    const stale = await session.internal("worker", "files", "write", {
      request_key: "shell-bytes-write-2",
      target,
      base_hash: sha("# Plan\n"),
      content: { kind: "prepared", blob: blob.ok ? blob.value : null },
    });
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.error.code, "conflict");

    // 상태·watch는 main 통로로 읽는다.
    const status = await session.internal("read", "files", "status", {
      target,
    });
    assert.equal(status.ok, true, JSON.stringify(status));
    const watched = await session.internal("worker", "files", "watch", {
      target,
    });
    assert.equal(watched.ok, true, JSON.stringify(watched));
    if (watched.ok) {
      // 추적을 끈 폴더는 관측하지 않는다. 상태는 그렇다고만 답한다.
      const value = watched.value as {
        status: { state: string; observed_hash: string | null };
        next_cursor: string;
      };
      assert.equal(value.status.state, "not_tracked");
      assert.ok(value.next_cursor.length > 0);
    }

    // renderer가 부르는 통로(call)는 파일 쓰기를 allowlist에서 막는다.
    const fromRenderer = await session.call("worker", "files", "write", {});
    assert.equal(fromRenderer.ok, false);
    if (!fromRenderer.ok) assert.equal(fromRenderer.error.code, "forbidden");
  } finally {
    try {
      child.kill("SIGTERM");
    } catch { /* 이미 끝남 */ }
    try {
      child.stdin?.end();
    } catch { /* 이미 끝남 */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      child.kill("SIGKILL");
    } catch { /* 이미 끝남 */ }
    await rm(home, { recursive: true, force: true });
    await rm(folder, { recursive: true, force: true });
  }
});
