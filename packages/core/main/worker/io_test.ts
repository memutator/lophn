import { assert, assertEquals } from "@std/assert";
import { DIAGNOSTICS_WRITE_OP } from "../../../protocol/diagnostics/mod.ts";
import {
  encodeFrame,
  type Frame,
  FrameDecoder,
} from "../../../protocol/supervision/mod.ts";
import {
  applyMigrations,
  BACKUP_MANIFEST_NAME,
} from "../../storage/migration/mod.ts";
import { manualClock, sha256Hex } from "../../../base/mod.ts";
import { objectPathFor, tmpDirFor } from "../../storage/blobs/mod.ts";
import { LEDGER_SCHEMA_STEPS } from "../../storage/ledger/mod.ts";
import { SETTINGS_SCHEMA_STEPS } from "../../config/mod.ts";
import {
  type ChildSession,
  READ_AHEAD_MAX_BYTES,
  READ_AHEAD_MAX_FRAMES,
} from "../../supervision/responsiveness/mod.ts";
import type { SettingsPipe } from "../../config/worker/pipe.ts";
import {
  BLOB_PREPARE_WORKER_BUDGET,
  BLOB_PREPARE_WORKER_WINDOW,
  createBackupTick,
  createPlatformIo,
} from "./io.ts";

const hello = {
  type: "hello",
  core_epoch: "epoch",
  process_identity: "process",
  kind: "platform/io",
  task: "diagnostics",
  scope: { operations: [DIAGNOSTICS_WRITE_OP], targets: {} },
  credential: "token-never-record",
  api_port: 7431,
};
const diagnostic = {
  type: "diagnostic" as const,
  kind: "lophn_internal" as const,
  payload: {
    component: "platform/core",
    observed_at: "2026-10-04T00:00:00.000Z",
    error_class: "internal_exception" as const,
    location: "core.command",
    count: 1,
  },
};
const request = {
  type: "worker_request",
  request_id: "request",
  op: DIAGNOSTICS_WRITE_OP,
  payload: { records: [diagnostic], dropped: 0 },
};
const frame = (payload: unknown) =>
  encodeFrame({ kind: "json", channel: 0, payload });

Deno.test("platform/diagnostics#R2 platform/redaction#R15 composed authenticated entry writes only safe record", async () => {
  const root = await Deno.makeTempDir({ prefix: "io-entry-" });
  const chunks: Uint8Array[] = [];
  let ended = false;
  let wake: () => void = () => {};
  const output: Frame[] = [];
  const decoder = new FrameDecoder();
  const push = (payload: unknown) => {
    chunks.push(frame(payload));
    wake();
  };
  let run: Promise<void> | undefined;
  try {
    const session = await createPlatformIo({
      root,
      catalog: {
        components: ["platform/core"],
        locations: { "core.command": "core/command" },
      },
      currentAuthority: () => ({
        principal: "core",
        process: "process",
        task: "diagnostics",
        scope: [DIAGNOSTICS_WRITE_OP],
        permits: (value) => value.payload.component === "platform/core",
      }),
      streams: {
        stdin: {
          async read(buffer) {
            while (!chunks.length && !ended) {
              await new Promise<void>((resolve) => wake = resolve);
            }
            const next = chunks.shift();
            if (!next) return null;
            buffer.set(next);
            return next.length;
          },
        },
        stdout: {
          write(bytes) {
            output.push(...decoder.push(bytes));
            return Promise.resolve(bytes.length);
          },
        },
        stderr: { write: (bytes) => Promise.resolve(bytes.length) },
      },
    });
    run = session.run();
    push(hello);
    push(request);
    for (let i = 0; i < 100 && output.length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assertEquals(output.length, 2);
    assertEquals(output[1], {
      kind: "json",
      channel: 0,
      payload: {
        type: "worker_response",
        request_id: "request",
        ok: true,
        payload: { accepted: 1, dropped: 0 },
      },
    });
    let contents = "";
    for (let i = 0; i < 100 && !contents; i++) {
      try {
        contents = await Deno.readTextFile(`${root}/logs/platform-0.jsonl`);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      if (!contents) await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert(contents.includes("Platform internal failure observed."));
    assert(!contents.includes("token-never-record"));
    push({ type: "stop", grace_ms: 10 });
    await run;
    assertEquals(session.credentialUsable, false);
    assertEquals(
      output.filter((value) =>
        value.kind === "json" &&
        (value.payload as { type: string }).type === "stopped"
      ).length,
      1,
    );
  } finally {
    ended = true;
    wake();
    await run;
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/diagnostics#R3 platform/redaction#R15 real product pipe EOF and stop have no raw stdout", async () => {
  const root = await Deno.makeTempDir({ prefix: "io-pipe-" });
  const entry = new URL("./main.ts", import.meta.url).pathname;
  const config = new URL("../../../../deno.json", import.meta.url).pathname;
  try {
    for (const terminal of ["stop", "eof"]) {
      const child = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--cached-only",
          "--frozen",
          "--no-prompt",
          `--allow-read=${root}`,
          `--allow-write=${root}/logs`,
          "--config",
          config,
          entry,
          "platform/io",
          root,
        ],
        clearEnv: true,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const writer = child.stdin.getWriter();
      const reader = child.stdout.getReader();
      const decoder = new FrameDecoder();
      const received: Frame[] = [];
      let stderr: Promise<Uint8Array> | undefined;
      try {
        stderr = new Response(child.stderr).bytes();
        await writer.write(frame(hello));
        while (received.length < 1) {
          const next = await reader.read();
          assert(!next.done);
          received.push(...decoder.push(next.value));
        }
        await writer.write(frame(request));
        while (received.length < 2) {
          const next = await reader.read();
          assert(!next.done);
          received.push(...decoder.push(next.value));
        }
        assertEquals(
          (received[1] as { payload: { ok: boolean } }).payload.ok,
          false,
        );
        if (terminal === "stop") {
          await writer.write(frame({ type: "stop", grace_ms: 20 }));
        }
        await writer.close();
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          received.push(...decoder.push(next.value));
        }
        decoder.finish();
        assertEquals((await child.status).success, true);
        assertEquals(
          received.filter((value) =>
            value.kind === "json" &&
            (value.payload as { type: string }).type === "stopped"
          ).length,
          1,
        );
        assertEquals((await stderr).length, 0);
      } finally {
        try {
          await writer.close();
        } catch { /* already closed */ }
        writer.releaseLock();
        reader.releaseLock();
        try {
          child.kill("SIGKILL");
        } catch { /* already exited */ }
        await child.status;
        await stderr;
      }
    }
    const entries = [];
    for await (const entry of Deno.readDir(`${root}/logs`)) entries.push(entry);
    assertEquals(entries.length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// backup scheduler 지평(platform/backup-and-migration#R9, R12,
// platform/responsiveness#R1). product entry의 tick은 만들기가 진행 중이면
// 건너뛴다: 두 snapshot이 겹치지 않는다(R9). completion이 끝나면 다음 tick이
// 다시 본다(R12).
Deno.test(
  "platform/backup-and-migration#R9 #R12: entry의 tick은 만들기가 진행 중이면 건너뛴다",
  async () => {
    const root = await Deno.makeTempDir({ prefix: "io-backup-" });
    try {
      // 실제 ledger를 준비한다(빈 events 표 대신 schema가 설치된 진짜 원본).
      const path = `${root}/lophn.db`;
      const steps = [...LEDGER_SCHEMA_STEPS, ...SETTINGS_SCHEMA_STEPS];
      const applied = await applyMigrations(path, steps, {
        clock: manualClock(Date.parse("2026-01-01T00:00:00.000Z")),
      });
      assert(applied.ok);
      // manual clock: backupDue가 거짓이 되는 최근 완료 manifest를 남긴다.
      const now = Date.now();
      const clock = manualClock(now);
      const directory = `${root}/backups/20260102T000000000Z`;
      const manifest = {
        format: 1,
        schema_version: steps.length,
        through_seq: "0",
        created_at: new Date(now - 1000).toISOString(),
        ledger_hash: "0".repeat(64),
        ledger_path: "ledger.db",
        blobs: [],
        settings: "ledger",
        integrity: "passed",
        complete: true,
        excluded: ["app_db", "external_source", "keychain", "credential"],
      };
      await Deno.mkdir(directory, { recursive: true });
      await Deno.writeTextFile(
        `${directory}/${BACKUP_MANIFEST_NAME}`,
        JSON.stringify(manifest),
      );
      // backupDue가 거짓이므로 이 check는 아무것도 만들지 않는다.
      const entry = createBackupTick(root, clock);
      entry.tick();
      await entry.settle();
      const entries1: string[] = [];
      for await (const folder of Deno.readDir(`${root}/backups`)) {
        entries1.push(folder.name);
      }
      // 24시간을 앞당긴다. 이번 tick은 만든다.
      clock.advance(24 * 60 * 60 * 1000);
      entry.tick();
      // 만들기가 진행 중이다. 도중 tick은 겹치는 만들기를 시작하지 않는다(R9).
      // tick을 연달아 부른다. inFlight가 참이면 뒤 tick은 건너뛴다.
      entry.tick();
      entry.tick();
      await entry.settle();
      assertEquals(entry.inFlight, false);
      // completion이 끝났다. completion이 만든 완료 manifest folder를 센다.
      const entries2: string[] = [];
      for await (const folder of Deno.readDir(`${root}/backups`)) {
        entries2.push(folder.name);
      }
      // 하나만 늘었다. 겹치는 만들기가 없었다(R9).
      assertEquals(entries2.length, 2);
      // 만들기가 실제로 통과했다(R12 확인): 완료 manifest가 생겼다.
      const listed = (await import(
        "../../storage/migration/mod.ts"
      )).listBackups;
      const backups = (await listed(root)).backups.filter((item) =>
        item.complete
      );
      assertEquals(backups.length, 2);
      entry.close();
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

// blob.prepare 통로: 요청 json이 먼저 오고 chunk가 end 전에 이어 온다(Q2·Q6).
// 실제 blob store로 hash·write·설치한다.
async function withBlobIo(
  run: (io: {
    root: string;
    session: ChildSession;
    push(frame: Frame): void;
    output: Frame[];
    waitFor(predicate: (frame: Frame) => boolean): Promise<Frame>;
  }) => Promise<void>,
  extra: { settings?: SettingsPipe } = {},
) {
  const root = await Deno.makeTempDir({ prefix: "io-blob-" });
  const chunks: Uint8Array[] = [];
  let ended = false;
  let wake: () => void = () => {};
  const output: Frame[] = [];
  const decoder = new FrameDecoder();
  let running: Promise<void> | undefined;
  const push = (next: Frame) => {
    chunks.push(encodeFrame(next));
    wake();
  };
  try {
    const session = await createPlatformIo({
      root,
      catalog: { components: ["platform/core"], locations: {} },
      currentAuthority: () => undefined,
      settings: extra.settings,
      streams: {
        stdin: {
          async read(buffer) {
            while (!chunks.length && !ended) {
              await new Promise<void>((resolve) => wake = resolve);
            }
            const next = chunks[0];
            if (!next) return null;
            // 버퍼보다 큰 frame은 나눠서 준다.
            const size = Math.min(buffer.length, next.length);
            buffer.set(next.subarray(0, size));
            if (size === next.length) chunks.shift();
            else chunks[0] = next.subarray(size);
            return size;
          },
        },
        stdout: {
          write(bytes) {
            output.push(...decoder.push(bytes));
            return Promise.resolve(bytes.length);
          },
        },
        stderr: { write: (bytes) => Promise.resolve(bytes.length) },
      },
    });
    running = session.run();
    push({ kind: "json", channel: 0, payload: hello });
    await run({
      root,
      session,
      push,
      output,
      async waitFor(predicate) {
        for (let i = 0; i < 400; i++) {
          const found = output.find(predicate);
          if (found) return found;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw new Error("frame did not arrive");
      },
    });
  } finally {
    ended = true;
    wake();
    await running?.catch(() => {});
    await Deno.remove(root, { recursive: true });
  }
}

const prepareRequest = (channel: number): Frame => ({
  kind: "json",
  channel: 0,
  payload: {
    type: "worker_request",
    request_id: `prepare-${channel}`,
    op: "blob.prepare",
    channel,
    payload: { principal: "machine", purpose: "document_file" },
  },
});
const isCredit = (frame: Frame) =>
  frame.kind === "json" &&
  (frame.payload as { type?: string }).type === "credit";
const creditsOf = (output: Frame[]) =>
  output.filter(isCredit).map((frame) =>
    frame.kind === "json" ? (frame.payload as { window: number }).window : 0
  );
const isResponse = (id: string) => (frame: Frame) =>
  frame.kind === "json" &&
  (frame.payload as { type?: string }).type === "worker_response" &&
  (frame.payload as { request_id?: string }).request_id === id;
const payloadOf = (frame: Frame) =>
  (frame as { payload: { ok: boolean; payload: Record<string, unknown> } })
    .payload;

Deno.test("platform/blob-store#R2 platform/responsiveness#R1: I/O worker는 end 전에 chunk를 받아 쓰고 읽어 간 만큼만 credit을 다시 주며 end 뒤에 hash를 응답한다", async () => {
  await withBlobIo(async (io) => {
    io.push(prepareRequest(5));
    await io.waitFor(isCredit);
    // 요청을 받은 즉시 window 하나를 준다.
    assertEquals(creditsOf(io.output), [BLOB_PREPARE_WORKER_WINDOW]);
    const parts = [1, 2, 3].map((n) =>
      new Uint8Array(100 * 1024).fill(n) as Uint8Array
    );
    for (const payload of parts) {
      io.push({ kind: "bytes", channel: 5, payload });
    }
    // 읽어 간 chunk마다 그 크기만큼 credit을 다시 준다.
    for (let i = 0; i < 400 && creditsOf(io.output).length < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assertEquals(creditsOf(io.output), [
      BLOB_PREPARE_WORKER_WINDOW,
      ...parts.map((part) => part.length),
    ]);
    // end 전에는 준비가 끝나지 않는다.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assertEquals(io.output.find(isResponse("prepare-5")), undefined);
    io.push({ kind: "end", channel: 5 });
    const answered = payloadOf(await io.waitFor(isResponse("prepare-5")));
    assertEquals(answered.ok, true);
    const total = new Uint8Array(300 * 1024);
    parts.forEach((part, index) => total.set(part, index * part.length));
    const hash = await sha256Hex(total);
    assertEquals(answered.payload["hash"], hash);
    assertEquals(answered.payload["size_bytes"], total.length);
    const installed = await Deno.readFile(objectPathFor(io.root, hash));
    assertEquals(installed.length, total.length);
  });
});

Deno.test("platform/blob-store#R2: abort frame은 준비를 오류로 끝내고 blob도 임시 파일도 남기지 않으며 이어 오는 chunk는 버린다", async () => {
  await withBlobIo(async (io) => {
    io.push(prepareRequest(6));
    await io.waitFor(isCredit);
    io.push({ kind: "bytes", channel: 6, payload: new Uint8Array(4096) });
    io.push({ kind: "abort", channel: 6 });
    io.push({ kind: "bytes", channel: 6, payload: new Uint8Array(4096) });
    const answered = payloadOf(await io.waitFor(isResponse("prepare-6")));
    assertEquals(answered.ok, false);
    const leftovers: string[] = [];
    try {
      for await (const entry of Deno.readDir(tmpDirFor(io.root))) {
        leftovers.push(entry.name);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    assertEquals(leftovers, []);
    let blobs = 0;
    try {
      for await (const _ of Deno.readDir(`${io.root}/blobs/sha256`)) blobs++;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    assertEquals(blobs, 0);
  });
});

Deno.test("platform/responsiveness#R3 platform/blob-store#R2: 여러 blob 준비가 동시에 오고 dispatch가 느린 요청에 묶여도 준 credit 합이 budget 안이라 read-ahead 한도를 넘지 않고 session이 살아 모든 blob이 설치된다", async () => {
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const slowSettings: SettingsPipe = {
    async handle(request) {
      started.resolve();
      await gate.promise;
      return {
        request_id: request.request_id,
        ok: false,
        error: { code: "invalid_input", message: "slow" },
      };
    },
  };
  await withBlobIo(async (io) => {
    const channels = [21, 22, 23, 24];
    const total = 1536 * 1024;
    const piece = 256 * 1024;
    const dataOf = (channel: number) => new Uint8Array(total).fill(channel);
    const credit = new Map(channels.map((channel) => [channel, 0]));
    const sent = new Map(channels.map((channel) => [channel, 0]));
    const finished = new Set<number>();
    let seen = 0;
    let granted = 0;
    // credit을 지키는 core 흉내. 준 credit이 있으면 그만큼만 보내고 다 보내면 end한다.
    const drive = () => {
      for (; seen < io.output.length; seen++) {
        const frame = io.output[seen]!;
        if (frame.kind !== "json") continue;
        const message = frame.payload as {
          type?: string;
          channel?: number;
          window?: number;
        };
        if (message.type === "credit" && credit.has(message.channel!)) {
          credit.set(
            message.channel!,
            credit.get(message.channel!)! + message.window!,
          );
          granted += message.window!;
        }
      }
      for (const channel of channels) {
        if (finished.has(channel)) continue;
        for (;;) {
          const remaining = total - sent.get(channel)!;
          const size = Math.min(credit.get(channel)!, piece, remaining);
          if (size <= 0) break;
          const from = sent.get(channel)!;
          io.push({
            kind: "bytes",
            channel,
            payload: dataOf(channel).subarray(from, from + size),
          });
          credit.set(channel, credit.get(channel)! - size);
          sent.set(channel, from + size);
        }
        if (sent.get(channel) === total) {
          io.push({ kind: "end", channel });
          finished.add(channel);
        }
      }
    };
    for (const channel of channels) io.push(prepareRequest(channel));
    // 요청만 먼저 받아 준비들이 credit을 받게 한다. 그 뒤 dispatch를 느린 요청으로 막는다.
    await io.waitFor(isCredit);
    io.push({
      kind: "json",
      channel: 0,
      payload: {
        type: "worker_request",
        request_id: "slow",
        op: "settings.import",
        payload: {},
      },
    });
    await started.promise;
    // dispatch가 막힌 동안 core 흉내가 준 credit을 모두 보낸다.
    let peakBytes = 0;
    let peakFrames = 0;
    for (let i = 0; i < 100; i++) {
      drive();
      const ahead = io.session.readAhead;
      peakBytes = Math.max(peakBytes, ahead.pendingBytes);
      peakFrames = Math.max(peakFrames, ahead.pendingFrames);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    // 막힌 동안 준 credit 합이 budget을 넘지 않았다.
    assert(granted <= BLOB_PREPARE_WORKER_BUDGET, `credit ${granted}`);
    assert(peakBytes > 0, "dispatch가 막히지 않았다");
    assert(
      peakBytes <= READ_AHEAD_MAX_BYTES,
      `read-ahead ${peakBytes}바이트`,
    );
    assert(peakFrames <= READ_AHEAD_MAX_FRAMES);
    assertEquals(io.session.stopped, false);
    // 풀면 나머지가 흐른다.
    gate.resolve();
    for (let i = 0; i < 2000 && finished.size < channels.length; i++) {
      drive();
      peakBytes = Math.max(peakBytes, io.session.readAhead.pendingBytes);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assertEquals(finished.size, channels.length);
    for (const channel of channels) {
      const answered = payloadOf(
        await io.waitFor(isResponse(`prepare-${channel}`)),
      );
      assertEquals(answered.ok, true, `channel ${channel}`);
      const hash = await sha256Hex(dataOf(channel));
      assertEquals(answered.payload["hash"], hash);
      const installed = await Deno.readFile(objectPathFor(io.root, hash));
      assertEquals(installed.length, total);
    }
    assert(peakBytes <= READ_AHEAD_MAX_BYTES);
    assertEquals(io.session.stopped, false);
  }, { settings: slowSettings });
});
