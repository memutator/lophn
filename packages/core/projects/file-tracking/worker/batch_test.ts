// documents/file-tracking#R5, R6: 후보 배분 묶음의 준비 worker 요청·응답. 실제 coordinator의 배분
// 루프가 실제 준비 worker(자식 프로세스)에 묶음을 보내고, 후보마다 hash와 크기(또는 unverified
// 이유)를 순서대로 받는다. 데이터 root와 폴더는 temp dir다.
import { assert, assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import { systemClock } from "../../../../base/mod.ts";
import {
  encodeFrame,
  type Frame,
  FrameDecoder,
} from "../../../../protocol/server/mod.ts";
import type { Candidate } from "../mod.ts";
import { createSupervisor } from "../../../supervision/responsiveness/mod.ts";
import { createBatchDispatch } from "./batch.ts";
import { createCoordinator } from "./coordinator.ts";
import { preparationSpec } from "./launch.ts";
import { createPreparationPool } from "./pool.ts";

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// 첫 frame들(hello)을 주고 release 전까지 다음 읽기를 붙든다. 끝나면 EOF다.
function heldStdin(frames: Uint8Array[]) {
  const queue = [...frames];
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    release: () => release(),
    reader: {
      async read(buffer: Uint8Array): Promise<number | null> {
        const next = queue.shift();
        if (next) {
          buffer.set(next);
          return next.length;
        }
        await released;
        return null;
      },
    },
  };
}

const hello = {
  type: "hello" as const,
  core_epoch: "epoch-1",
  process_identity: "coordinator-1",
  kind: "documents/worker" as const,
  task: "documents",
  scope: { operations: [], targets: {} },
  credential: "never-recorded",
  api_port: 1,
};

Deno.test("documents/file-tracking#R5 documents/file-tracking#R6: coordinator의 배분 루프는 후보 묶음을 실제 준비 worker에 보내고 후보 순서대로 hash를 받는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-batch-home-" });
  const root = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-batch-root-" }),
  );
  const pool = createPreparationPool({
    specFor: () => preparationSpec(home, [root]),
    denoCommand: Deno.execPath(),
    env: (kind) => ({
      LOPHN_WORKER_KIND: kind,
      LOPHN_HOME: home,
      ...(Deno.env.get("HOME") ? { HOME: Deno.env.get("HOME")! } : {}),
      ...(Deno.env.get("PATH") ? { PATH: Deno.env.get("PATH")! } : {}),
    }),
    createSupervisor: (options) =>
      createSupervisor({ ...options, clock: systemClock }),
  });
  const output: Frame[] = [];
  const decoder = new FrameDecoder();
  const held = heldStdin([
    encodeFrame({ kind: "json", channel: 0, payload: hello }),
  ]);
  const submitted: { candidate: Candidate; outcome: unknown }[] = [];
  const both = Promise.withResolvers<void>();
  try {
    await Deno.writeTextFile(`${root}/a.md`, "alpha");
    await Deno.writeTextFile(`${root}/b.md`, "bravo");
    const coordinator = await createCoordinator({
      root: home,
      streams: {
        stdin: held.reader,
        stdout: {
          write: (bytes: Uint8Array) => {
            output.push(...decoder.push(bytes));
            return Promise.resolve(bytes.length);
          },
        },
        stderr: { write: (bytes: Uint8Array) => Promise.resolve(bytes.length) },
      },
      spawnPreparation: () => Promise.reject(new Error("owned by the pool")),
      dispatchBatch: createBatchDispatch(pool),
      submitResult: (candidate, outcome) => {
        submitted.push({ candidate, outcome });
        if (submitted.length === 3) both.resolve();
        return Promise.resolve();
      },
      deps: {
        nowIso: () => "2026-10-06T00:00:00.000Z",
        newRequestId: () => crypto.randomUUID(),
      },
    });
    coordinator.dispatchRoots([{ path: root }]);
    coordinator.addCandidate(root, "a.md");
    coordinator.addCandidate(root, "b.md");
    coordinator.addCandidate(root, "missing.md");
    const running = coordinator.session.run();
    await Promise.race([
      both.promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("batch not answered")), 30_000)
      ),
    ]);
    held.release();
    await running.catch(() => {});
    assertEquals(submitted.map((entry) => entry.candidate.path), [
      "a.md",
      "b.md",
      "missing.md",
    ]);
    const outcomes = submitted.map((entry) =>
      entry.outcome as Record<string, unknown>
    );
    // 같은 읽기 stream의 hash와 크기다. 본문은 응답에 없다.
    assertEquals(outcomes[0], {
      path: "a.md",
      kind: "stable",
      hash: sha("alpha"),
      size: 5,
      real_path: `${root}/a.md`,
    });
    assertEquals(outcomes[1]["hash"], sha("bravo"));
    assertEquals(outcomes[2]["kind"], "unverified");
    assert(!JSON.stringify(outcomes).includes("alpha"));
  } finally {
    held.release();
    await pool.stop();
    await Deno.remove(home, { recursive: true });
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("documents/file-tracking#R5: 준비 worker를 띄우지 못하면 그 배분은 제출하지 않는다(unavailable)", async () => {
  const pool = createPreparationPool({
    specFor: () => undefined,
    denoCommand: Deno.execPath(),
    env: () => ({}),
  });
  const dispatch = createBatchDispatch(pool);
  const answered = await dispatch(
    { name: "preparation-background", priority: "background", state: "idle" },
    {
      root: "/work/none",
      batch: [{
        root: "/work/none",
        path: "a.md",
        observedAt: "2026-10-06T00:00:00.000Z",
      }],
    },
  );
  assert(!answered.ok);
  assertEquals(answered.error.code, "unavailable");
  await pool.stop();
});
