import {
  type Clock,
  createIdSource,
  err,
  internalError,
  monotonicClock,
  ok,
  type Result,
  seededRandom,
  systemClock,
} from "../../../base/mod.ts";
import {
  type AuthenticatedContext,
  authenticatedContextSchema,
  type CommandDefinition,
  type RequestContext,
  type Tx,
} from "../../../protocol/server/mod.ts";
import type { BlobFieldDefinition } from "../../../protocol/storage/mod.ts";
import {
  confirmationBridge,
  ConfirmationRegistry,
} from "../../server/identity/mod.ts";
import { defineTxPort } from "./tx-ports.ts";
import {
  createAfterCommitCollector,
  type LedgerConnection,
  type TxPortRegistration,
  type WriterRegistration,
} from "./mod.ts";
import {
  createBlobRegistrar,
  createPreparationRegistry,
  type PreparationRegistry,
} from "../blobs/mod.ts";
import { requestPrincipal } from "./after-commit.ts";
import type { TeamModule } from "./team-module.ts";

type WriterBoot = {
  path: string;
  modules: string[];
  // "system"이면 writer가 자기 system clock을 쓴다. 숫자면 그 시각에 고정한
  // clock을 쓴다. 테스트만 숫자를 보내고, 제품 경로는 "system"이다.
  clock: "system" | number;
  seed: number;
};

type Loose = {
  commands?: readonly CommandDefinition[];
  ports?: readonly TxPortRegistration[] | Record<string, unknown>;
  blobFields?: readonly BlobFieldDefinition[];
};

// writer Worker 안에서 팀 등록을 다시 조립한다.
// 자격은 제출 context가 아니라 ledger의 credential 기록으로만 다시 본다.
export async function assembleWriter(
  boot: WriterBoot,
  connection: LedgerConnection,
): Promise<
  WriterRegistration & {
    confirmationRegistry: ConfirmationRegistry;
    preparations: PreparationRegistry;
    noteRequest(ctx: RequestContext | undefined): void;
    // 테스트의 manual clock은 writer가 공유하지 못한다. core가 민 시각을 알린다.
    noteTime(nowMs: number): void;
    onTx(tx: Tx | undefined): void;
    // command 하나를 run으로 돌리고 확정된 새 command의 결과에만 모은 것을 싣는다.
    afterCommit: ReturnType<typeof createAfterCommitCollector>;
  }
> {
  // 테스트 clock은 기동 시각에 고정되지만, 테스트가 시계를 밀면 core가 알린다.
  let fixedMs = typeof boot.clock === "number" ? boot.clock : 0;
  const clock = writerClock(boot, () => fixedMs);
  const commands: CommandDefinition[] = [];
  const afterCommit = createAfterCommitCollector();
  const ports: TxPortRegistration[] = [
    afterCommit.registration,
    defineTxPort(requestPrincipal, () => ({
      principal: () => currentRequest?.principal ?? null,
    })),
  ];
  const names = new Set(commands.map((command) => command.route.name));
  const blobFields: BlobFieldDefinition[] = [];
  for (const url of boot.modules) {
    const team: TeamModule = await import(url);
    const loose = teamRegistration(team);
    for (const command of loose?.commands ?? []) {
      if (names.has(command.route.name)) {
        throw new Error("duplicate command registration");
      }
      names.add(command.route.name);
      commands.push(command);
    }
    ports.push(...portList(loose?.ports));
    blobFields.push(...(loose?.blobFields ?? []));
  }
  if (
    commands.some((c) => c.dispatchOnly === true && c.dispatchable !== true)
  ) {
    throw new Error("dispatchOnly command must be dispatchable");
  }
  const preparations = createPreparationRegistry();
  // writer는 command를 한 줄로 처리하므로 진행 중인 요청의 자격을 여기 둔다.
  let currentRequest: RequestContext | undefined;
  let currentTx: Tx | undefined;
  const random = seededRandom(boot.seed + 1);
  const confirmationRegistry = new ConfirmationRegistry({
    clock,
    random: (bytes) => random.fill(bytes),
  });
  return {
    commands,
    confirmation: confirmationBridge(confirmationRegistry),
    confirmationRegistry,
    clock,
    ids: createIdSource({ clock, random: seededRandom(boot.seed) }),
    ports,
    afterCommit,
    // 준비 참조는 writer 메모리에 있다. core가 준비 성공을 알리고, 등록은 그 메모리를 본다.
    registerBlobRef: (reference) => {
      const tx = currentTx;
      if (!tx) {
        return err({
          code: "unavailable",
          message: "blob 등록 transaction이 없다",
        });
      }
      return createBlobRegistrar({
        preparations,
        fields: blobFields,
        nowMs: () => clock.nowMs(),
        current: () => currentRequest,
      })(tx.sql, reference);
    },
    preparations,
    noteRequest(ctx: RequestContext | undefined) {
      currentRequest = ctx;
    },
    noteTime(nowMs: number) {
      if (nowMs > fixedMs) fixedMs = nowMs;
    },
    onTx(tx: Tx | undefined) {
      currentTx = tx;
    },
    call: () => err({ code: "unavailable", message: "Tx.call dispatch 없음" }),
    checkCredential: (ctx) => checkCredential(connection, ctx),
  };
}

// event `at`·tx.now()·ULID·확인 기한은 같은 시각을 쓴다. writer는 별도 Worker라 core의 clock
// 객체를 그대로 받지 못한다. 제품 경로는 writer 자신의 system clock을 쓰고,
// 테스트는 기동 시각에 고정한 clock을 쓴다. 어느 쪽이든 시각은 뒤로 가지 않는다.
function writerClock(boot: WriterBoot, fixedMs: () => number): Clock {
  if (boot.clock === "system") return monotonicClock(systemClock);
  return monotonicClock({ nowMs: fixedMs, now: () => "" });
}

function teamRegistration(team: TeamModule): Loose | undefined {
  const direct = team.createCoreRegistration?.();
  const fromLedger = team.createLedgerRegistration
    ? team.createLedgerRegistration({} as never)
    : undefined;
  const sources = [direct, fromLedger, team.lophnAgentDefinitions].filter(
    defined,
  );
  if (sources.length === 0) return undefined;
  return {
    commands: sources.flatMap((value) => (value as Loose).commands ?? []),
    ports: sources.flatMap((value) =>
      toArray((value as Loose).ports),
    ) as TxPortRegistration[],
    blobFields: sources.flatMap((value) => (value as Loose).blobFields ?? []),
  };
}

function defined(value: unknown): boolean {
  return !!value && typeof value === "object";
}

function toArray(ports: unknown): unknown[] {
  if (!ports) return [];
  return Array.isArray(ports) ? ports : Object.values(ports);
}

// 팀은 port를 배열로도, 이름 있는 객체로도 내보낸다. 있는 값만 모은다.
// 등록 모양은 {key, create}다. read snapshot 전용 port 구현(fromTx·fromSnapshot,
// create가 없는 coding-agent 모양)은 writer에서 판정에 쓰지 않으므로 거른다.
// 없는 create를 등록하면 tx-ports가 registry 전체를 닫으므로 다른 팀의 command까지 죽는다.
function portList(ports: unknown): TxPortRegistration[] {
  if (!ports) return [];
  const values = Array.isArray(ports) ? ports : Object.values(ports);
  return values.filter((port): port is TxPortRegistration => {
    if (!port || typeof port !== "object") return false;
    const key = (port as TxPortRegistration).key;
    const create = (port as TxPortRegistration).create;
    return (
      key !== null &&
      typeof key === "object" &&
      typeof key.name === "string" &&
      key.name.length > 0 &&
      typeof create === "function"
    );
  });
}

// BEGIN IMMEDIATE 안에서 부른다. 기록에 없는 ref나 제출 binding이 다른 ref는 거절한다.
function checkCredential(
  connection: LedgerConnection,
  ctx: AuthenticatedContext,
): Result<AuthenticatedContext> {
  let row: Record<string, unknown> | undefined;
  try {
    row = connection.sql.get(
      `select context, state from credentials where credential_ref = ?`,
      [ctx.credential_ref],
    );
  } catch {
    return err({
      code: "unavailable",
      message: "credential 기록을 읽지 못했다",
    });
  }
  if (!row || row["state"] !== "active" || typeof row["context"] !== "string") {
    return err({ code: "unauthorized", message: "현재 credential이 없다" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row["context"]);
  } catch {
    return err(internalError());
  }
  const context = authenticatedContextSchema.safeParse(parsed);
  if (!context.success) return err(internalError());
  if (
    context.data.credential_ref !== ctx.credential_ref ||
    context.data.principal !== ctx.principal ||
    context.data.actor !== ctx.actor
  ) {
    return err({
      code: "forbidden",
      message: "현재 credential binding이 다르다",
    });
  }
  return ok(structuredClone(context.data));
}
