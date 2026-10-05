import {
  createIdSource,
  err,
  internalError,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../packages/base/mod.ts";
import type {
  AuthenticatedContext,
  CommandDefinition,
} from "../../packages/contracts/platform/mod.ts";
import { authenticatedContextSchema } from "../../packages/contracts/platform/mod.ts";
import {
  confirmationBridge,
  ConfirmationRegistry,
} from "../../packages/platform/identity/mod.ts";
import {
  LEDGER_COMMANDS,
  type LedgerConnection,
  type TxPortRegistration,
  type WriterRegistration,
} from "../../packages/platform/ledger/mod.ts";
import {
  type BlobFieldDefinition,
  type RequestContext,
  type Tx,
} from "../../packages/contracts/platform/mod.ts";
import {
  createBlobRegistrar,
  createPreparationRegistry,
  type PreparationRegistry,
} from "../../packages/platform/blob-store/mod.ts";
import type { TeamModule } from "./registration.ts";
import { claimSweepTimePort } from "../../packages/coding-agent/tickets/sweep-time.ts";

export type WriterBoot = {
  path: string;
  modules: string[];
  nowMs: number;
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
    noteBlobTime(nowMs: number): void;
    onTx(tx: Tx | undefined): void;
  }
> {
  const clock = manualClock(boot.nowMs);
  const commands: CommandDefinition[] = [...LEDGER_COMMANDS];
  const ports: TxPortRegistration[] = [];
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
    blobFields.push(...loose?.blobFields ?? []);
  }
  ports.push(claimSweepTimePort(() => claimSweepMs));
  const preparations = createPreparationRegistry();
  // writer는 command를 한 줄로 처리하므로 진행 중인 요청의 자격을 여기 둔다.
  let currentRequest: RequestContext | undefined;
  let currentTx: Tx | undefined;
  // writer clock은 기동 시각에 고정된다. command의 tx.now()는 이 시계를 그대로
  // 쓴다. blob 만기 판정만 core가 알린 시각(blobNowMs)을 본다.
  // claim 만료 판단은 sweep가 알린 시각만 따로 둔다. writer clock이 실제 시각을
  // 따르면(fix/writer-clock) 이 시각 대신 tx.now()를 쓴다.
  let blobNowMs = boot.nowMs;
  let claimSweepMs: number | null = null;
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
    // 준비 참조는 writer 메모리에 있다. core가 준비 성공을 알리고, 등록은 그 메모리를 본다(R4).
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
        nowMs: () => blobNowMs,
        current: () => currentRequest,
      })(tx.sql, reference);
    },
    preparations,
    noteRequest(ctx: RequestContext | undefined) {
      currentRequest = ctx;
    },
    noteBlobTime(nowMs: number) {
      if (nowMs > blobNowMs) blobNowMs = nowMs;
      // sweep가 만료 판단에 쓰는 시각. writer clock은 움직이지 않는다.
      claimSweepMs = nowMs;
    },
    onTx(tx: Tx | undefined) {
      currentTx = tx;
    },
    call: () => err({ code: "unavailable", message: "Tx.call dispatch 없음" }),
    checkCredential: (ctx) => checkCredential(connection, ctx),
  };
}

function teamRegistration(team: TeamModule): Loose | undefined {
  const direct = team.createCoreRegistration?.();
  const fromLedger = team.createLedgerRegistration
    ? team.createLedgerRegistration({} as never)
    : undefined;
  // problems 팀은 tests와 reporting 두 등록을 같은 모듈이 내보낸다. 둘 다 모은다.
  const problems: Loose[] = [
    team.problemsTestDefinitions,
    team.problemsReportDefinitions,
  ].filter(defined).map((value) => value as Loose);
  if (problems.length > 0) {
    const commands = problems.flatMap((value) => value.commands ?? []);
    const ports: TxPortRegistration[] = problems.flatMap((value) =>
      toArray(value.ports) as TxPortRegistration[]
    );
    const blobFields: BlobFieldDefinition[] = problems.flatMap((value) =>
      value.blobFields ?? []
    );
    return { commands, ports, blobFields };
  }
  const sources = [
    direct,
    fromLedger,
    team.codingAgentConnectionDefinitions,
    team.lophnAgentDefinitions,
    team.ticketDefinitions,
  ].filter(defined);
  if (sources.length === 0) return undefined;
  return {
    commands: sources.flatMap((value) => (value as Loose).commands ?? []),
    ports: sources.flatMap((value) =>
      toArray((value as Loose).ports)
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
// create가 없는 problems·coding-agent 모양)은 writer에서 판정에 쓰지 않으므로 거른다.
// 없는 create를 등록하면 tx-ports가 registry 전체를 닫으므로 다른 팀의 command까지 죽는다.
function portList(ports: unknown): TxPortRegistration[] {
  if (!ports) return [];
  const values = Array.isArray(ports) ? ports : Object.values(ports);
  return values.filter((port): port is TxPortRegistration => {
    if (!port || typeof port !== "object") return false;
    const key = (port as TxPortRegistration).key;
    const create = (port as TxPortRegistration).create;
    return (
      key !== null && typeof key === "object" &&
      typeof key.name === "string" && key.name.length > 0 &&
      typeof create === "function"
    );
  });
}

// BEGIN IMMEDIATE 안에서 부른다. 기록에 없는 ref나 제출 binding이 다른 ref는 거절한다.
export function checkCredential(
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
  if (
    !row || row["state"] !== "active" || typeof row["context"] !== "string"
  ) {
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
