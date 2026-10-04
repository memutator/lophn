import type { Clock, IdSource, Result } from "../../packages/base/mod.ts";
import type {
  CommandDefinition,
  KindLaunchSpec,
  ReadDefinition,
  SchemaStep,
} from "../../packages/contracts/platform/mod.ts";
import type { TxPortRegistration } from "../../packages/platform/ledger/mod.ts";

// 최상위 팀의 등록 파일이 내놓는 모양. main.ts는 이 목록만 부르고 팀 내용을 모른다.
// 팀 파일은 지금 자기 모양을 그대로 내보내므로, 여기 조립은 있는 항목만 읽는다.
export type TeamRegistration = {
  schemaSteps?: readonly SchemaStep[];
  commands?: readonly CommandDefinition[];
  reads?: readonly ReadDefinition[];
  ports?: readonly TxPortRegistration[];
  workers?: readonly KindLaunchSpec[];
  clock?: Clock;
  ids?: IdSource;
};

// 팀 파일은 지금 자기 타입으로 내보낸다. 조립은 아래 키만 읽고 값은 등록 시점에 검사한다.
export type TeamModule = {
  createCoreRegistration?: () => TeamRegistration;
  createLedgerRegistration?: (environment: never) => unknown;
  problemsTestDefinitions?: unknown;
  codingAgentConnectionDefinitions?: unknown;
  lophnAgentDefinitions?: unknown;
};

type Loose = {
  schemaSteps?: readonly { id?: unknown; sql?: unknown }[];
  schema?: readonly { id?: unknown; sql?: unknown }[];
  commands?: readonly { route?: { name?: unknown } }[];
  reads?: readonly { route?: { resource?: unknown; method?: unknown } }[];
  ports?: readonly TxPortRegistration[];
  workers?: readonly KindLaunchSpec[];
};

export type Assembled = {
  schemaSteps: SchemaStep[];
  commands: CommandDefinition[];
  reads: ReadDefinition[];
  ports: TxPortRegistration[];
  workers: KindLaunchSpec[];
};

function broken(what: string): Result<never> {
  return {
    ok: false,
    error: { code: "internal", message: `등록 모양이 올바르지 않다: ${what}` },
  };
}

// 팀은 port를 배열로도, 이름 있는 객체로도 내보낸다. 있는 값만 모은다.
function portList(ports: unknown): TxPortRegistration[] {
  if (!ports) return [];
  const values = Array.isArray(ports) ? ports : Object.values(ports);
  return values.filter((port): port is TxPortRegistration =>
    !!port && typeof port === "object"
  );
}

function asLoose(value: unknown): Loose | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Loose;
}

function taken<T>(seen: Set<string>, key: string, value: T): Result<T> {
  if (seen.has(key)) {
    return {
      ok: false,
      error: { code: "internal", message: `등록이 겹친다: ${key}` },
    };
  }
  seen.add(key);
  return { ok: true, value };
}

// 팀 모듈을 한 목록으로 모은다. 같은 schema id·command 이름·read 경로·worker kind는 거절한다.
export function assemble(modules: readonly TeamModule[]): Result<Assembled> {
  const assembled: Assembled = {
    schemaSteps: [],
    commands: [],
    reads: [],
    ports: [],
    workers: [],
  };
  const schema = new Set<string>();
  const commands = new Set<string>();
  const reads = new Set<string>();
  const workers = new Set<string>();
  for (const team of modules) {
    const direct = team.createCoreRegistration?.();
    const fromLedger = team.createLedgerRegistration
      ? asLoose(team.createLedgerRegistration({} as never))
      : undefined;
    const fromProblems = asLoose(team.problemsTestDefinitions);
    const fromCodingAgent = asLoose(team.codingAgentConnectionDefinitions);
    const fromLophnAgent = asLoose(team.lophnAgentDefinitions);
    const registration = asLoose(direct) ?? fromLedger ?? fromProblems ??
      fromCodingAgent ?? fromLophnAgent;
    if (!registration) continue;
    for (const step of registration.schemaSteps ?? registration.schema ?? []) {
      if (typeof step.id !== "string" || typeof step.sql !== "string") {
        return broken("schema step");
      }
      const check = taken(schema, step.id, step as SchemaStep);
      if (!check.ok) return check;
      assembled.schemaSteps.push(check.value);
    }
    for (const command of registration.commands ?? []) {
      const name = command.route?.name;
      if (typeof name !== "string") return broken("command");
      const check = taken(commands, name, command as CommandDefinition);
      if (!check.ok) return check;
      assembled.commands.push(check.value);
    }
    for (const read of registration.reads ?? []) {
      const resource = read.route?.resource;
      const method = read.route?.method;
      if (typeof resource !== "string" || typeof method !== "string") {
        return broken("read");
      }
      const check = taken(
        reads,
        `${resource}/${method}`,
        read as ReadDefinition,
      );
      if (!check.ok) return check;
      assembled.reads.push(check.value);
    }
    for (const port of portList(registration.ports)) assembled.ports.push(port);
    for (const worker of registration.workers ?? []) {
      const check = taken(workers, worker.kind, worker);
      if (!check.ok) return check;
      assembled.workers.push(worker);
    }
  }
  return { ok: true, value: assembled };
}
