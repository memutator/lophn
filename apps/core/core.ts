import { systemClock } from "../../packages/base/clock.ts";
import { cryptoRandom } from "../../packages/base/random.ts";
import type { Clock, RandomSource, Result } from "../../packages/base/mod.ts";
import { err, ok } from "../../packages/base/mod.ts";
import type { KindLaunchSpec } from "../../packages/contracts/platform/mod.ts";
import {
  coreToMainMessageSchema,
  mainToCoreMessageSchema,
} from "../../packages/contracts/platform/mod.ts";
import {
  type ApiServer,
  startApiServer,
} from "../../packages/platform/api/mod.ts";
import { applyMigrations } from "../../packages/platform/backup-and-migration/mod.ts";
import {
  platformStatusReads,
  type StatusSource,
} from "../../packages/platform/diagnostics/mod.ts";
import {
  type CredentialIssue,
  CredentialRegistry,
} from "../../packages/platform/identity/mod.ts";
import {
  acquireInstanceLock,
  type DataRoot,
  type InstanceLock,
  removeRunMetadata,
  resolveDataRoot,
  writeRunMetadata,
} from "../../packages/platform/install-and-update/mod.ts";
import { LEDGER_SCHEMA_STEPS } from "../../packages/platform/ledger/mod.ts";
import {
  createFrameWriter,
  readFrames,
} from "../../packages/platform/responsiveness/mod.ts";
import type { Frame } from "../../packages/contracts/platform/mod.ts";
import { assemble, type TeamModule } from "./registration.ts";

// 시작 순서: lock → ledger schema step → writer·reader → event 배포 → API → I/O worker 감독.
// writer·reader 실행기는 T18(command dispatch)이 자격을 조립하기 전에는 열지 않는다.
// 그 전까지 command·event는 등록만 되고 실행은 unavailable이다.
export type CoreOptions = {
  // 없으면 프로세스 환경의 LOPHN_HOME, 그것도 없으면 ~/.lophn.
  lophnHome?: string;
  home?: string;
  // 0이면 빈 port. 기본은 7431.
  port?: number;
  teams: readonly TeamModule[];
  clock?: Clock;
  random?: RandomSource;
  // Electron main이 물려 준 stdin/stdout. 테스트가 파이프를 끼운다.
  parent?: {
    stdin: ReadableStream<Uint8Array>;
    stdout: WritableStream<Uint8Array>;
  };
  // I/O worker 감독. 없으면 그 구성 요소는 불가 이유로 남는다.
  supervise?: (workers: readonly KindLaunchSpec[]) => Promise<void>;
};

export type Core = {
  port: number;
  epoch: string;
  dataRoot: string;
  // 부모 pipe의 종료 감시가 끝나면 resolve된다. 부모가 없으면 이미 끝난 상태다.
  done: Promise<void>;
  // 새 command 입장을 닫고 연 것을 정리한 뒤 lock을 푼다(ledger R21).
  shutdown(): Promise<void>;
};

const USER_SCOPE: CredentialIssue = {
  actor: "user",
  principal: "user",
  scope: {
    operations: ["platform/status", "platform/health"],
    targets: {},
  },
  conditions: { process: "electron-main" },
};

export async function startCore(options: CoreOptions): Promise<Result<Core>> {
  const clock = options.clock ?? systemClock;
  const random = options.random ?? cryptoRandom;
  const root = await resolveDataRoot({
    lophnHome: options.lophnHome ?? Deno.env.get("LOPHN_HOME") ?? undefined,
    home: options.home ?? Deno.env.get("HOME") ?? undefined,
  });
  if (!root.ok) return root;
  const locked = await acquireInstanceLock(root.value.run);
  if (!locked.ok) return locked;

  const opened = await open(options, root.value, locked.value, clock, random);
  if (!opened.ok) {
    await locked.value.release();
    return opened;
  }
  return opened;
}

async function open(
  options: CoreOptions,
  root: DataRoot,
  lock: InstanceLock,
  clock: Clock,
  random: RandomSource,
): Promise<Result<Core>> {
  const assembled = assemble(options.teams);
  if (!assembled.ok) return assembled;
  const ledgerPath = `${root.path}/lophn.db`;
  const migrated = await applyMigrations(
    ledgerPath,
    [...LEDGER_SCHEMA_STEPS, ...assembled.value.schemaSteps],
    { clock },
  );
  if (!migrated.ok) return migrated;
  const epoch = hex(random, 16);
  const registry = new CredentialRegistry({
    epoch,
    clock,
    random,
    operations: [
      {
        name: "platform/status",
        actors: ["user", "machine", "app", "agent", "coding_agent"],
        kind: "read",
      },
      {
        name: "platform/health",
        actors: ["user", "machine", "app", "agent", "coding_agent"],
        kind: "read",
      },
    ],
  });
  let ready = false;
  const source: StatusSource = {
    get ready() {
      return ready;
    },
    schema: LEDGER_SCHEMA_STEPS.length + assembled.value.schemaSteps.length,
    dataRoot: root.path,
    // ledger 파일 하나의 식별. 내용은 노출하지 않는다.
    ledgerId: await ledgerIdentity(ledgerPath),
    components() {
      return [
        ["ledger", { available: true }],
        ["api", { available: ready }],
        [
          "writer",
          {
            available: false,
            reason: "command dispatch가 아직 조립되지 않았다",
          },
        ],
        [
          "io",
          {
            available: options.supervise !== undefined,
            ...(options.supervise ? {} : { reason: "I/O worker 감독이 없다" }),
          },
        ],
      ];
    },
  };
  const reads = platformStatusReads(source, clock);
  let server: ApiServer;
  try {
    server = await startApiServer({
      port: options.port,
      credentials: registry,
      clock,
      reads: new Map([
        ["platform/status", reads.status],
        ["platform/health", reads.health],
      ]),
    });
  } catch {
    return err({ code: "unavailable", message: "API를 열 수 없다" });
  }
  const recorded = await writeRunMetadata(root.run, {
    apiPort: server.port,
    coreEpoch: epoch,
    startedAt: clock.now(),
  });
  if (!recorded.ok) {
    await server.stop();
    return recorded;
  }
  if (options.supervise) {
    try {
      await options.supervise(assembled.value.workers);
    } catch {
      await server.stop();
      await removeRunMetadata(root.run);
      return err({
        code: "unavailable",
        message: "I/O worker 감독을 시작하지 못했다",
      });
    }
  }
  ready = true;
  // 부모 pipe는 호출자가 명시할 때만 연다. 터미널에서 직접 띄우면 종료는 신호가 담당한다.
  const parent = options.parent;
  const hello = parent
    ? greet(parent, registry, server.port, epoch)
    : Promise.resolve(ok(undefined));
  let stopped = false;
  const core: Core = {
    port: server.port,
    epoch,
    dataRoot: root.path,
    done: Promise.resolve(),
    async shutdown() {
      if (stopped) return;
      stopped = true;
      // 새 입장을 먼저 닫는다. 이미 입장한 command는 writer가 확정 또는 실패로 마친다.
      ready = false;
      await server.stop();
      await removeRunMetadata(root.run);
      await lock.release();
    },
  };
  const greeted = await hello;
  if (!greeted.ok) {
    await core.shutdown();
    return greeted;
  }
  core.done = parent
    ? watchParent(parent, () => core.shutdown())
    : Promise.resolve();
  return ok(core);
}

// ledger 파일을 다시 열지 않고 경로와 크기로만 식별한다. 내용은 읽지 않는다.
async function ledgerIdentity(path: string): Promise<string> {
  const stat = await Deno.stat(path);
  return `${path}:${stat.size}`;
}

// Electron main의 상속 pipe에 user token을 한 번 준다. 창 닫기는 여기 오지 않는다.
async function greet(
  parent: NonNullable<CoreOptions["parent"]>,
  registry: CredentialRegistry,
  port: number,
  epoch: string,
): Promise<Result<void>> {
  const issued = await registry.issue(USER_SCOPE);
  if (!issued.ok) return issued;
  const frame = coreToMainMessageSchema.safeParse({
    user_token: issued.value.token,
    api_port: port,
    core_epoch: epoch,
  });
  if (!frame.success) {
    return err({ code: "internal", message: "hello frame을 만들지 못했다" });
  }
  // hello는 부모가 읽기 전에 나간다. 버퍼에 쌓아 두고 백프레셔로 기동을 막지 않는다.
  const buffered: Uint8Array[] = [];
  const writer = createFrameWriter({
    write: (bytes) => {
      buffered.push(bytes.slice());
      return Promise.resolve(bytes.length);
    },
  });
  try {
    await writer.writeJson(frame.data);
    // 부모가 읽기 시작해야 흐른다. 기동은 그 읽기를 기다리지 않는다.
    const out = parent.stdout.getWriter();
    void flush(out, buffered);
  } catch {
    return err({
      code: "unavailable",
      message: "부모 pipe에 hello를 쓰지 못했다",
    });
  }
  return ok(undefined);
}

// 백프레셔로 기동을 막지 않게 hello 이후의 흐름만 기다린다.
async function flush(
  out: WritableStreamDefaultWriter<Uint8Array>,
  buffered: Uint8Array[],
): Promise<void> {
  try {
    for (const bytes of buffered) {
      let rest = bytes;
      while (rest.length > 0) {
        const written = await out.write(rest);
        const count = typeof written === "number" ? written : rest.length;
        rest = rest.subarray(count);
      }
    }
  } catch {
    // 부모가 이미 닫았으면 hello는 전달되지 않는다. 종료 감시가 그 뒤를 본다.
  }
}

function hex(random: RandomSource, bytes: number): string {
  const buffer = new Uint8Array(bytes);
  random.fill(buffer);
  return [...buffer].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// pipe EOF나 main의 명시 종료가 core 종료를 시작한다(install-and-update R12).
function watchParent(
  parent: NonNullable<CoreOptions["parent"]>,
  shutdown: () => Promise<void>,
): Promise<void> {
  return (async () => {
    try {
      for await (
        const frame of readFrames({ read: streamReader(parent.stdin) })
      ) {
        if (await handleParent(frame, shutdown)) return;
      }
    } catch {
      // frame이 아닌 바이트는 protocol 위반이다. 종료로 다룬다.
    }
    await shutdown();
  })();
}

async function handleParent(
  frame: Frame,
  shutdown: () => Promise<void>,
): Promise<boolean> {
  if (frame.kind !== "json") return false;
  const message = mainToCoreMessageSchema.safeParse(frame.payload);
  if (!message.success || message.data.type !== "stop") return false;
  await shutdown();
  return true;
}

function streamReader(
  stream: ReadableStream<Uint8Array>,
): (buffer: Uint8Array) => Promise<number | null> {
  const reader = stream.getReader();
  let pending: Uint8Array | undefined;
  return async (buffer) => {
    while (!pending || pending.length === 0) {
      const next = await reader.read();
      if (next.done) return null;
      pending = next.value;
    }
    const take = Math.min(buffer.length, pending.length);
    buffer.set(pending.subarray(0, take));
    pending = pending.subarray(take);
    return take;
  };
}
