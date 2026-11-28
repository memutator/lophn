import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import process from "node:process";
import type { Clock } from "../../../../base/mod.ts";
import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import type { BlobFieldDefinition } from "../../../../protocol/storage/mod.ts";
import { platformEntry } from "../../../install-and-update/mod.ts";
import {
  createPreparationRegistry,
  retentionRules,
} from "../../../storage/blobs/mod.ts";
import type {
  BlobPrepareCall,
  BufferGauge,
  PreparedRelayResult,
} from "../../../storage/blobs/prepare-relay.ts";
import {
  createBlobPrepareRelay,
  createBufferGauge,
} from "../../../storage/blobs/prepare-relay.ts";
import { LEDGER_SCHEMA_STEPS } from "../../../storage/ledger/mod.ts";
import { confirmStartup } from "../../../storage/migration/mod.ts";
import { windowsEnvironment } from "../../../supervision/security/child-env.ts";
import { nodeCommand } from "../../../supervision/security/node-command.ts";
import {
  type BlobRead,
  type BlobRelay,
  IO_ENDED,
  type StoppedConditions,
  type Supervisor,
  type WiringFactory,
} from "./context.ts";

export const storageWiring: WiringFactory = () => {
  let pruneTimer: ReturnType<typeof setInterval> | undefined;
  return {
    name: "storage",
    schemaSteps: LEDGER_SCHEMA_STEPS,
    prepare(ctx) {
      // 읽기 의존은 runtime보다 먼저 만들어 둔다. relay는 build에서 채운다.
      ctx.provide(
        "blobRead",
        blobReadDeps(() => ctx.assembled.blobFields),
      );
    },
    build(ctx) {
      const gauge = createBufferGauge();
      const relay = blobRelayFor(
        ctx.io,
        ctx.clock,
        (prepared) => ctx.runtime.notePrepared(prepared),
        gauge,
      );
      ctx.provide("blobBuffer", gauge);
      ctx.provide("blobRelay", relay);
      ctx.blobRead.use(relay.readBytes);
      ctx.provide("prepareRelay", (call) => relay.prepare(call));
      ctx.provide("bodyPrepare", {
        live: (prepared) => relay.live(prepared, ctx.clock.nowMs()),
        prepare: (call) => relay.prepare(call),
      });
      ctx.ioListeners.push({
        onMessage: (message) => relay.callbacks.onMessage(message),
        onFrame: (frame) => relay.callbacks.onFrame(frame),
        // I/O worker가 끝나면(crash·재기동) 답을 기다리던 준비·읽기를 기한까지 두지 않고 끝낸다.
        onEnd: () => relay.failPending(IO_ENDED),
      });
      return ok({});
    },
    start(ctx) {
      // 준비 참조 수명 만기 prune. writer 메모리는 writer가 자기 clock으로 판정한다.
      // 파일 GC는 하지 않고 메모리 참조만 떨어뜨린다.
      pruneTimer = setInterval(() => {
        ctx.blobRelay.prune(ctx.clock.nowMs());
        ctx.runtime.prunePrepared();
      }, 60_000);
      return Promise.resolve(ok(undefined));
    },
    // API가 요청을 받기 시작했고 이번 기동에서 적용한 step이 없으면 정상 기동이다. 이전 복구본을 지운다.
    async afterReady(ctx) {
      if (ctx.migrationsApplied === 0)
        await confirmStartup(ctx.root.path, ctx.telemetry.logger);
    },
    closeWork() {
      if (pruneTimer !== undefined) clearInterval(pruneTimer);
    },
    // 세 조건이 모두 관측될 때만 유지보수를 부른다. 파일 작업과 blob_refs
    // 읽기는 core graph 밖 프로세스의 몫이다. 관측을
    // 못 하면 건너뛰고(fail-closed), 시간 제한을 넘기면 그 프로세스만
    // 끝내고 종료를 계속한다. 실패는 diagnostics 로그만 남긴다.
    async stopped(ctx, conditions) {
      if (
        !(
          conditions.preparationsBlocked &&
          conditions.commandsBlocked &&
          conditions.writerStopped
        )
      )
        return;
      await runStoppedMaintenance({
        dataRoot: ctx.root.path,
        ledgerPath: ctx.ledgerPath,
        conditions,
        fields: retentionRules(ctx.assembled.blobFields),
        nowMs: ctx.clock.nowMs(),
      });
    },
  };
};

// 바이트 흐름. core가 relay를 만들어 I/O worker의 callback으로 넣는다.
// 준비 성공은 writer 메모리에도 알려 등록 판정이 같은 참조를 보게 한다.
// 바이트는 core가 열지 않는다. I/O worker의 blob.read가 읽고 core는 결과만 받는다.
function blobReadDeps(fields: () => readonly BlobFieldDefinition[]): BlobRead {
  const reader: { current?: BlobRead["deps"]["read"] } = {};
  return {
    deps: {
      get fields() {
        return fields();
      },
      read(hash, offset, length) {
        const current = reader.current;
        if (!current) {
          return Promise.resolve(
            err({
              code: "unavailable",
              message: "blob 읽기 통로가 없다",
            }),
          );
        }
        return current(hash, offset, length).catch(() =>
          err({ code: "unavailable", message: "blob을 읽지 못했다" }),
        );
      },
    },
    use(read) {
      reader.current = read;
    },
  };
}

function blobRelayFor(
  io: Supervisor,
  clock: Clock,
  note: (prepared: PreparedRelayResult, nowMs: number) => Promise<Result<void>>,
  gauge: BufferGauge,
): BlobRelay {
  const registry = createPreparationRegistry();
  const relay = createBlobPrepareRelay({
    // 해석·hash 없이 I/O worker로 넘긴다. worker가 준 credit 안에서만 보내고,
    // frame writer가 pipe backpressure를 지킨다.
    send: async (payload) => {
      const sent = await io.send("platform/io", payload);
      if (!sent.ok) throw new Error("blob 준비를 넘기지 못했다");
    },
    sendBytes: async (channel, chunk) => {
      const sent = await io.sendBytes("platform/io", channel, chunk);
      if (!sent.ok) throw new Error("blob 바이트를 넘기지 못했다");
    },
    sendEnd: async (channel) => {
      const sent = await io.sendEnd("platform/io", channel);
      if (!sent.ok) throw new Error("blob 끝을 넘기지 못했다");
    },
    sendAbort: async (channel) => {
      const sent = await io.sendAbort("platform/io", channel);
      if (!sent.ok) throw new Error("blob 중단을 넘기지 못했다");
    },
    registry,
    nowMs: () => clock.nowMs(),
    note,
    gauge,
  });
  return {
    callbacks: {
      // worker_response와 credit은 중계가 요청 id·channel로 맞춘다.
      onMessage(message) {
        relay.accept(message);
      },
      // worker가 돌려준 읽기 바이트는 JSON이 아니라 byte chunk frame이다.
      onFrame(frame) {
        relay.take(frame);
      },
    },
    failPending: (message) => relay.failPending(message),
    prune: (nowMs) => relay.prune(nowMs),
    live: (prepared, nowMs) => relay.live(prepared, nowMs),
    prepare: (call: BlobPrepareCall) =>
      relay
        .prepare(
          {
            principal: call.principal,
            purpose: call.purpose,
            expectedHash: call.expectedHash,
          },
          call.bytes,
        )
        .catch(() =>
          err({ code: "unavailable", message: "blob 준비를 넘기지 못했다" }),
        ),
    readBytes: (hash, offset, length) => relay.readBytes(hash, offset, length),
  };
}

// 정지 유지보수 프로세스. 파일 작업과
// ledger 읽기는 core graph 밖이다. 세 정지 조건은 종료
// 순서가 실제로 끝난 뒤의 관측값이라 상수 true를 넘기지 않는다. 프로세스가
// 실패하거나 blob_refs를 읽지 못하면 아무것도 지우지 않고(fail-closed), 종료는
// 그대로 끝난다. 실패는 diagnostics 로그만 남긴다.
// 문서에 종료 전체의 시간 예산은 없다. 신뢰 child 정상 정지는 5초지만 유지보수는
// 파일 삭제를 포함하므로 그보다 길게, 디스크가 멈춰도 종료가 끝나도록 30초로 둔다.
const MAINTENANCE_TIMEOUT_MS = 30_000;

async function runStoppedMaintenance(input: {
  dataRoot: string;
  ledgerPath: string;
  conditions: StoppedConditions;
  fields: ReturnType<typeof retentionRules>;
  nowMs: number;
}): Promise<void> {
  const signal = AbortSignal.timeout(MAINTENANCE_TIMEOUT_MS);
  const entry = platformEntry(import.meta.url, "maintenance");
  let success: boolean;
  try {
    const launch = nodeCommand(entry);
    const child = spawn(launch.command, launch.args, {
      // lophn 자신의 정비 child다.
      stdio: ["ignore", "ignore", "ignore"],
      // env를 주면 부모 환경을 통째로 대체한다.
      env: {
        ...launch.env,
        ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        ...windowsEnvironment(),
        LOPHN_HOME: input.dataRoot,
        LOPHN_MAINTENANCE: JSON.stringify({
          ledger: input.ledgerPath,
          conditions: input.conditions,
          fields: input.fields,
          nowMs: input.nowMs,
        }),
      },
      signal,
    });
    success = await new Promise<boolean>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code === 0));
    });
  } catch {
    // signal이 시간을 넘기면 child만 죽고 기다림이 거절된다.
    await noteMaintenanceFailure(input.dataRoot, signal.aborted);
    return;
  }
  if (!success) {
    await noteMaintenanceFailure(input.dataRoot, signal.aborted);
  }
}

// 유지보수 실패의 diagnostics 기록. 종료를 막지 않으므로 기록 실패도 삼킨다.
// 원문·경로·hash는 넣지 않고 분류만 남긴다.
async function noteMaintenanceFailure(
  dataRoot: string,
  timedOut = false,
): Promise<void> {
  try {
    const directory = `${dataRoot}/logs`;
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
    const record = {
      at: new Date().toISOString(),
      component: "platform/core",
      kind: "log",
      code: "lophn_internal",
      error_type: "maintenance_gc",
      location: "packages/core/main/daemon/wiring/storage.ts",
      message: timedOut
        ? "maintenance_gc timeout"
        : "Stopped maintenance did not run.",
    };
    await appendFile(
      `${directory}/maintenance.jsonl`,
      JSON.stringify(record) + "\n",
    );
  } catch {
    // 기록하지 못해도 종료는 그대로 끝난다.
  }
}
