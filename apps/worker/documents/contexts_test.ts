// documents/contexts#R20·R23·R25 [ctx-T9b]: context worker의 IPC 처리. 감독 pipe의 frame을 직접 먹여
// hello → ready, `context.index`, `context.check`의 답과 거절을 본다. 파일과 sqlite는 임시 폴더의 실제 것이다.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { canonicalize } from "../../../packages/base/mod.ts";
import {
  encodeFrame,
  type Frame,
  FrameDecoder,
} from "../../../packages/protocol/server/mod.ts";
import {
  type ByteReader,
  type ChildStreams,
} from "../../../packages/core/supervision/responsiveness/mod.ts";
import { sampleEnv } from "../../../packages/core/projects/contexts/validate/sample.ts";
import { openIndexStore } from "../../../packages/core/projects/contexts/index/mod.ts";
import { CONTEXTS_KIND, createContextsWorker } from "./contexts.ts";
import type { ContextFileOptions } from "./contexts-files.ts";
import { createHash } from "node:crypto";

const FIXTURES = new URL(
  "../../../packages/core/projects/contexts/testdata/",
  import.meta.url,
);
const CONTEXT = "ctx_00000000000000000000000001";
const CHECK = "chk_00000000000000000000000001";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

// 먹이는 만큼만 내주고, 닫으면 EOF다.
function controlledStdin() {
  const queue: Uint8Array[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  const reader: ByteReader = {
    async read(buffer) {
      for (;;) {
        const next = queue.shift();
        if (next) {
          buffer.set(next);
          return next.length;
        }
        if (closed) return null;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
  return {
    reader,
    push(payload: unknown) {
      queue.push(encodeFrame({ kind: "json", channel: 0, payload }));
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
  };
}

function recordingStdout() {
  const decoder = new FrameDecoder();
  const frames: Frame[] = [];
  return {
    writer: {
      write(bytes: Uint8Array) {
        frames.push(...decoder.push(bytes));
        return Promise.resolve(bytes.length);
      },
    },
    payloads: () =>
      frames.flatMap((frame) =>
        frame.kind === "json" ? [frame.payload] : []
      ) as {
        type: string;
        request_id?: string;
        ok?: boolean;
        payload?: Record<string, unknown>;
        error?: { code: string };
      }[],
  };
}

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  for (let i = 0; i < 3000; i++) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out");
}

async function fixtureProject(): Promise<string> {
  const root = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-contexts-worker-project-" }),
  );
  const source = new URL("eval-project/", FIXTURES);
  const walk = async (directory: URL, relative: string) => {
    for await (const entry of Deno.readDir(directory)) {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory) {
        await Deno.mkdir(`${root}/${child}`, { recursive: true });
        await walk(new URL(`${entry.name}/`, directory), child);
      } else {
        await Deno.copyFile(new URL(entry.name, directory), `${root}/${child}`);
      }
    }
  };
  await walk(source, "");
  return root;
}

const contract = async () =>
  JSON.parse(
    await Deno.readTextFile(new URL("eval-project.contract.json", FIXTURES)),
  ) as Record<string, unknown>;

function started(
  dataRoot: string,
  kind = CONTEXTS_KIND,
  files?: ContextFileOptions,
) {
  const stdin = controlledStdin();
  const out = recordingStdout();
  const streams: ChildStreams = {
    stdin: stdin.reader,
    stdout: out.writer,
    stderr: { write: (bytes) => Promise.resolve(bytes.length) },
  };
  const session = createContextsWorker({
    streams,
    ...(files ? { files } : {}),
  });
  const done = session.run();
  stdin.push({
    type: "hello",
    core_epoch: "epoch",
    process_identity: "process",
    kind,
    task: "contexts",
    scope: { operations: [], targets: { data_root: dataRoot } },
    credential: "none",
    api_port: 7431,
  });
  return { stdin, out, done };
}

async function ask(
  worker: Awaited<ReturnType<typeof started>>,
  id: string,
  op: string,
  payload: unknown,
) {
  worker.stdin.push({ type: "worker_request", request_id: id, op, payload });
  return await waitFor(() =>
    worker.out.payloads().find((message) =>
      message.type === "worker_response" && message.request_id === id
    )
  );
}

Deno.test("documents/contexts#R23 [ctx-T9b]: hello brings the worker up and a different kind or a missing data root is refused", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-contexts-home-" });
  try {
    const worker = started(home);
    await waitFor(() =>
      worker.out.payloads().find((message) => message.type === "ready")
    );
    worker.stdin.close();
    await worker.done;
    assertEquals(
      worker.out.payloads().filter((message) => message.type === "stopped")
        .length,
      1,
    );

    const other = started(home, "documents/worker");
    await assertRejects(() => other.done, Error, "invalid worker kind");

    const stdin = controlledStdin();
    const out = recordingStdout();
    const session = createContextsWorker({
      streams: {
        stdin: stdin.reader,
        stdout: out.writer,
        stderr: { write: (bytes) => Promise.resolve(bytes.length) },
      },
    });
    const done = session.run();
    stdin.push({
      type: "hello",
      core_epoch: "epoch",
      process_identity: "process",
      kind: CONTEXTS_KIND,
      task: "contexts",
      scope: { operations: [], targets: {} },
      credential: "none",
      api_port: 7431,
    });
    await assertRejects(() => done, Error, "data_root");
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("documents/contexts#R23 #R25 [ctx-T9b]: context.index scans the folder into the derived index, asks core to record the violation count, and skips unchanged files the second time", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-contexts-home-" });
  const project = await fixtureProject();
  try {
    await Deno.mkdir(`${home}/derived`, { recursive: true });
    const worker = started(home);
    await waitFor(() =>
      worker.out.payloads().find((message) => message.type === "ready")
    );
    const bundle = await contract();
    const request = {
      context: CONTEXT,
      bundle,
      bundle_hash: sha(canonicalize(bundle)),
      recorded_count: 0,
      roots: [project],
    };

    const first = await ask(worker, "r1", "context.index", request);
    assertEquals(first.ok, true, JSON.stringify(first));
    assertEquals(first.payload?.["extracted"], true);
    assertEquals(first.payload?.["violation_count"], 7);
    assertEquals(first.payload?.["scanned"], first.payload?.["changed"]);
    // 낼 command는 답에 실린다. worker가 core를 부르지 않는다.
    assertEquals(first.payload?.["submissions"], [{
      command: "context.record_violations",
      input: {
        context: CONTEXT,
        count: 7,
        bundle_hash: request.bundle_hash,
      },
    }]);

    // 마지막 기록과 같으면 낼 것이 없고 바뀐 파일이 없으면 다시 extract하지 않는다.
    const second = await ask(worker, "r2", "context.index", {
      ...request,
      recorded_count: 7,
    });
    assertEquals(second.ok, true, JSON.stringify(second));
    assertEquals(second.payload?.["extracted"], false);
    assertEquals(second.payload?.["changed"], 0);
    assertEquals(second.payload?.["submissions"], []);

    // 파일이 바뀌면 그 scan이 다시 계산한다.
    const path = `${project}/eval/experiments/exp-003-paused.md`;
    await Deno.writeTextFile(
      path,
      (await Deno.readTextFile(path)).replace("paused", "done"),
    );
    const third = await ask(worker, "r3", "context.index", {
      ...request,
      recorded_count: 7,
    });
    assertEquals(third.payload?.["changed"], 1);
    assertEquals(third.payload?.["violation_count"], 6);
    assertEquals(
      (third.payload?.["submissions"] as { input: { count: number } }[]).map((
        entry,
      ) => entry.input.count),
      [6],
    );

    worker.stdin.close();
    await worker.done;

    // worker가 쓴 index를 다른 연결이 읽는다.
    const store = openIndexStore(`${home}/derived/contexts.sqlite`);
    try {
      const row = store.sql.get(
        "SELECT result FROM index_state WHERE context = ?",
        [CONTEXT],
      );
      assertEquals(row?.["result"], "complete");
    } finally {
      store.close();
    }
  } finally {
    await Deno.remove(home, { recursive: true });
    await Deno.remove(project, { recursive: true });
  }
});

Deno.test("documents/contexts#R20 [ctx-T9b]: context.check checks a snapshot and answers with the finish_check command, then leaves no snapshot", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-contexts-home-" });
  const project = await fixtureProject();
  try {
    // 이전 process가 남긴 snapshot은 시작 때 지운다.
    const staging = `${home}/documents/staging/context-check`;
    await Deno.mkdir(`${staging}/chk_leftover`, { recursive: true });
    const worker = started(home);
    await waitFor(() =>
      worker.out.payloads().find((message) => message.type === "ready")
    );
    assertEquals([...Deno.readDirSync(staging)], []);

    const bundle = await contract();
    const request = {
      context: CONTEXT,
      check: CHECK,
      bundle,
      bundle_hash: sha(canonicalize(bundle)),
      roots: [project],
      user_saved_views: [],
      external_types: sampleEnv().externalTypes,
      app_commands: [{
        app: "calendar",
        command: "events.list",
        effect: "read",
      }],
    };
    const answer = await ask(worker, "c1", "context.check", request);
    assertEquals(answer.ok, true, JSON.stringify(answer));
    assertEquals(answer.payload?.["status"], "passed");
    assertEquals(answer.payload?.["violation_count"], 7);
    const submissions = answer.payload?.["submissions"] as {
      command: string;
      input: Record<string, unknown>;
    }[];
    assertEquals(submissions.length, 1);
    assertEquals(submissions[0]!.command, "bundle.finish_check");
    assertEquals(submissions[0]!.input["check"], CHECK);
    assertEquals(submissions[0]!.input["result"], "passed");
    assertEquals(submissions[0]!.input["bundle_hash"], request.bundle_hash);
    assertEquals(
      submissions[0]!.input["snapshot_hash"],
      answer.payload?.["snapshot_hash"],
    );
    assertEquals([...Deno.readDirSync(staging)], []);

    // 앱 명령의 효과를 알려 주지 않으면 앱 데이터 type을 가진 계약은 검사를 통과하지 못한다.
    const unknown = await ask(worker, "c2", "context.check", {
      ...request,
      check: "chk_00000000000000000000000002",
      app_commands: [],
    });
    assertEquals(unknown.payload?.["status"], "failed");
    const finding = (unknown.payload?.["submissions"] as {
      input: { findings: { kind: string; detail: string }[] };
    }[])[0]!.input.findings;
    assert(finding.some((entry) => entry.detail === "app_command_unknown"));

    worker.stdin.close();
    await worker.done;
  } finally {
    await Deno.remove(home, { recursive: true });
    await Deno.remove(project, { recursive: true });
  }
});

Deno.test("documents/contexts#R19 [ctx-I64p]: context.preview counts the draft's entities in a snapshot, submits nothing and leaves no snapshot and no index; a snapshot over the budget is unavailable with no partial result", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-contexts-home-" });
  const project = await fixtureProject();
  try {
    const worker = started(home);
    await waitFor(() =>
      worker.out.payloads().find((message) => message.type === "ready")
    );
    const request = {
      context: CONTEXT,
      draft: await contract(),
      roots: [project],
      external_types: sampleEnv().externalTypes,
      app_commands: [{
        app: "calendar",
        command: "events.list",
        effect: "read",
      }],
    };
    const answer = await ask(worker, "p1", "context.preview", request);
    assertEquals(answer.ok, true, JSON.stringify(answer));
    assertEquals(
      (answer.payload?.["types"] as { type: string; count: number }[]).map((
        entry,
      ) => [entry.type, entry.count]),
      [
        ["Experiment", 5],
        ["Scenario", 2],
        ["Finding", 3],
        ["Decision", 2],
        ["Guide", 2],
        ["GuideHeading", 6],
        ["Event", 0],
      ],
    );
    assertEquals(answer.payload?.["findings"], []);
    assertEquals(answer.payload?.["violation_count"], 7);
    assertEquals((answer.payload?.["violations"] as unknown[]).length, 7);
    // 낼 command가 없다.
    assertEquals(Object.keys(answer.payload ?? {}).sort(), [
      "findings",
      "types",
      "violation_count",
      "violations",
    ]);
    assertEquals(
      [...Deno.readDirSync(`${home}/documents/staging/context-check`)],
      [],
    );
    assertEquals(
      await Deno.stat(`${home}/derived/contexts.sqlite`).then(() => true).catch(
        () => false,
      ),
      false,
    );

    // 모양이 틀린 draft는 finding만 있고 개체 수도 위반도 없다.
    const broken = await ask(worker, "p2", "context.preview", {
      ...request,
      draft: { ...(request.draft as object), schema: 2 },
    });
    assertEquals(broken.ok, true);
    assertEquals(broken.payload?.["types"], []);
    assertEquals(broken.payload?.["violations"], []);
    assertEquals(
      (broken.payload?.["findings"] as { kind: string }[]).map((entry) =>
        entry.kind
      ),
      ["contract_invalid"],
    );
    worker.stdin.close();
    await worker.done;

    const small = started(home, CONTEXTS_KIND, {
      limits: { snapshotBytes: 10 },
    });
    await waitFor(() =>
      small.out.payloads().find((message) => message.type === "ready")
    );
    const over = await ask(small, "p3", "context.preview", request);
    assertEquals(over.ok, false);
    assertEquals(over.error?.code, "unavailable");
    assertEquals(over.payload, undefined);
    assertEquals(
      [...Deno.readDirSync(`${home}/documents/staging/context-check`)],
      [],
    );
    small.stdin.close();
    await small.done;
  } finally {
    await Deno.remove(home, { recursive: true });
    await Deno.remove(project, { recursive: true });
  }
});

Deno.test("documents/contexts#R20 [ctx-T9b]: a malformed request and an unknown op are refused with invalid_input", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-contexts-home-" });
  try {
    const worker = started(home);
    await waitFor(() =>
      worker.out.payloads().find((message) => message.type === "ready")
    );
    for (
      const [id, op, payload] of [
        ["m1", "context.index", { context: "nope" }],
        ["m2", "context.check", {}],
        ["m3", "context.preview", {}],
      ] as const
    ) {
      const answer = await ask(worker, id, op, payload);
      assertEquals(answer.ok, false, id);
      assertEquals(answer.error?.code, "invalid_input", id);
    }
    worker.stdin.close();
    await worker.done;
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
