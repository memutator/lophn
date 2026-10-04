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
import type { TeamModule } from "./registration.ts";

export type WriterBoot = {
  path: string;
  modules: string[];
  nowMs: number;
  seed: number;
};

type Loose = {
  commands?: readonly CommandDefinition[];
  ports?: readonly TxPortRegistration[] | Record<string, unknown>;
};

// writer Worker 안에서 팀 등록을 다시 조립한다.
// 자격은 제출 context가 아니라 ledger의 credential 기록으로만 다시 본다.
export async function assembleWriter(
  boot: WriterBoot,
  connection: LedgerConnection,
): Promise<
  WriterRegistration & { confirmationRegistry: ConfirmationRegistry }
> {
  const clock = manualClock(boot.nowMs);
  const commands: CommandDefinition[] = [...LEDGER_COMMANDS];
  const ports: TxPortRegistration[] = [];
  const names = new Set(commands.map((command) => command.route.name));
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
  }
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
    registerBlobRef: () =>
      err({ code: "unavailable", message: "blob 참조 등록은 아직 없다" }),
    call: () => err({ code: "unavailable", message: "Tx.call dispatch 없음" }),
    checkCredential: (ctx) => checkCredential(connection, ctx),
  };
}

function teamRegistration(team: TeamModule): Loose | undefined {
  const direct = team.createCoreRegistration?.();
  const fromLedger = team.createLedgerRegistration
    ? team.createLedgerRegistration({} as never)
    : undefined;
  const value = direct ?? fromLedger ?? team.problemsTestDefinitions ??
    team.codingAgentConnectionDefinitions ?? team.lophnAgentDefinitions;
  if (!value || typeof value !== "object") return undefined;
  return value as Loose;
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
