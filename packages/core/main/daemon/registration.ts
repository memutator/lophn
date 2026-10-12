import type { Clock, IdSource, Result } from "../../../base/mod.ts";
import type {
  ApiReadDefinition,
  CommandDefinition,
  ReadDefinition,
  SchemaStep,
} from "../../../protocol/server/mod.ts";
import type { BlobFieldDefinition } from "../../../protocol/storage/mod.ts";
import type {
  FileRoute,
  MemoryRoute,
  Route,
  UploadRoute,
  WorkerRoute,
} from "../../../protocol/base/mod.ts";
import type { KindLaunchSpec } from "../../../protocol/supervision/mod.ts";
import type { TxPortRegistration } from "../../storage/ledger/mod.ts";
import type { SecretRefSource } from "../../secrets/mod.ts";

// 최상위 팀의 등록 파일이 내놓는 모양. main.ts는 이 목록만 부르고 팀 내용을 모른다.
// 팀 파일은 지금 자기 모양을 그대로 내보내므로, 여기 조립은 있는 항목만 읽는다.
export type TeamRegistration = {
  schemaSteps?: readonly SchemaStep[];
  commands?: readonly CommandDefinition[];
  reads?: readonly ReadDefinition[];
  // ledger snapshot 없이 core가 바로 여는 read. dispatcher가 기다리므로 async여도 된다.
  // 경로는 같은 registry에서 모으므로 reads·files와 겹치면 거절한다.
  apiReads?: readonly ApiReadDefinition[];
  // HTTP route registry가 command·read와 같은 출처에서 모으는 file·worker route.
  // command·read route는 definitions에서 온다. 여기 적힌 것은 그것과 겹치면 거절한다.
  files?: readonly FileRoute[];
  workerRoutes?: readonly WorkerRoute[];
  // 바이트 body route. handler는 core 조립(core.ts)이 route 이름으로 붙인다.
  uploadRoutes?: readonly UploadRoute[];
  // ledger를 쓰지 않는 core 메모리 route. handler는 core 조립(core.ts)이 route 이름으로 붙인다.
  memoryRoutes?: readonly MemoryRoute[];
  ports?: readonly TxPortRegistration[];
  workers?: readonly KindLaunchSpec[];
  blobFields?: readonly BlobFieldDefinition[];
  // 자기 ledger 표에 secret 참조를 두는 concern(provider credential 등)이 그 참조를 읽는 함수를
  // 낸다. core가 같은 keychain에서 값을 읽어 알려진 값 registry에 등록·회수한다.
  secretRefs?: readonly SecretRefSource[];
  clock?: Clock;
  ids?: IdSource;
};

// 팀 파일은 지금 자기 타입으로 내보낸다. 조립은 아래 키만 읽고 값은 등록 시점에 검사한다.
export type TeamModule = {
  createCoreRegistration?: () => TeamRegistration;
  createLedgerRegistration?: (environment: never) => unknown;
  problemsTestDefinitions?: unknown;
  problemsReportDefinitions?: unknown;
  codingAgentConnectionDefinitions?: unknown;
  lophnAgentDefinitions?: unknown;
  ticketDefinitions?: unknown;
};

type Loose = {
  schemaSteps?: readonly { id?: unknown; sql?: unknown }[];
  schema?: readonly { id?: unknown; sql?: unknown }[];
  commands?: readonly { route?: { name?: unknown } }[];
  reads?: readonly { route?: { resource?: unknown; method?: unknown } }[];
  apiReads?: readonly { route?: { resource?: unknown; method?: unknown } }[];
  files?: readonly { resource?: unknown; method?: unknown }[];
  workerRoutes?: readonly { resource?: unknown; method?: unknown }[];
  uploadRoutes?: readonly { resource?: unknown; method?: unknown }[];
  memoryRoutes?: readonly { resource?: unknown; method?: unknown }[];
  ports?: readonly TxPortRegistration[];
  workers?: readonly KindLaunchSpec[];
  blobFields?: readonly BlobFieldDefinition[];
  secretRefs?: readonly SecretRefSource[];
};

export type Assembled = {
  schemaSteps: SchemaStep[];
  commands: CommandDefinition[];
  reads: ReadDefinition[];
  // pool 밖에서 바로 여는 read. dispatcher가 기다린다.
  apiReads: ApiReadDefinition[];
  // command·read·file·worker route를 한 목록으로 모은 것. HTTP registry의 출처다.
  routes: Route[];
  ports: TxPortRegistration[];
  workers: KindLaunchSpec[];
  blobFields: BlobFieldDefinition[];
  // 다른 concern의 secret 참조를 읽는 함수. owner가 겹치면 거절한다.
  secretRefs: SecretRefSource[];
};

// command·read·file·worker route를 같은 경로 집합에 넣는다. 같은 resource/method는 거절한다.
function routeOf(seen: Set<string>, route: Route): Result<Route> {
  const resource = (route as { resource?: unknown }).resource;
  const method = (route as { method?: unknown }).method;
  if (typeof resource !== "string" || typeof method !== "string") {
    return broken("route");
  }
  return taken(seen, `${resource}/${method}`, route);
}

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
// environment는 core가 기동 때 만든 port 묶음이다. 팀 등록이 읽고 싶은 것만 읽는다
// (문서 FileStatus 메모리처럼 core 프로세스 안에서만 닿는 것).
export function assemble(
  modules: readonly TeamModule[],
  environment: unknown = {},
): Result<Assembled> {
  const assembled: Assembled = {
    schemaSteps: [],
    commands: [],
    reads: [],
    apiReads: [],
    routes: [],
    ports: [],
    workers: [],
    blobFields: [],
    secretRefs: [],
  };
  const secretOwners = new Set<string>();
  const schema = new Set<string>();
  const commands = new Set<string>();
  const reads = new Set<string>();
  const routes = new Set<string>();
  const workers = new Set<string>();
  for (const team of modules) {
    const direct = team.createCoreRegistration?.();
    const fromLedger = team.createLedgerRegistration
      ? asLoose(team.createLedgerRegistration(environment as never))
      : undefined;
    const fromProblems = asLoose(team.problemsTestDefinitions);
    const fromProblemsReport = asLoose(team.problemsReportDefinitions);
    const fromCodingAgent = asLoose(team.codingAgentConnectionDefinitions);
    const fromLophnAgent = asLoose(team.lophnAgentDefinitions);
    const fromTickets = asLoose(team.ticketDefinitions);
    // 한 모듈이 등록을 여러 키로 내보낼 수 있다. 첫 키만 고르면 뒤 등록의
    // schema·route가 core에 안 들어간다(tickets는 T18부터 빠졌다).
    const registrations = [
      asLoose(direct),
      fromLedger,
      fromProblems,
      fromProblemsReport,
      fromCodingAgent,
      fromLophnAgent,
      fromTickets,
    ].filter((item): item is Loose => item !== undefined);
    for (const registration of registrations) {
      for (
        const step of registration.schemaSteps ?? registration.schema ?? []
      ) {
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
        const route = routeOf(routes, check.value.route);
        if (!route.ok) return route;
        assembled.commands.push(check.value);
        assembled.routes.push(route.value);
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
        const route = routeOf(routes, check.value.route);
        if (!route.ok) return route;
        assembled.reads.push(check.value);
        assembled.routes.push(route.value);
      }
      for (const read of registration.apiReads ?? []) {
        const resource = read.route?.resource;
        const method = read.route?.method;
        if (typeof resource !== "string" || typeof method !== "string") {
          return broken("api read");
        }
        const check = taken(reads, `${resource}/${method}`, read);
        if (!check.ok) return check;
        const route = routeOf(routes, check.value.route as Route);
        if (!route.ok) return route;
        assembled.apiReads.push(check.value as ApiReadDefinition);
        assembled.routes.push(route.value);
      }
      for (const file of registration.files ?? []) {
        const route = routeOf(routes, file as Route);
        if (!route.ok) return route;
        assembled.routes.push(route.value);
      }
      for (const worker of registration.workerRoutes ?? []) {
        const route = routeOf(routes, worker as Route);
        if (!route.ok) return route;
        assembled.routes.push(route.value);
      }
      for (const upload of registration.uploadRoutes ?? []) {
        const route = routeOf(routes, upload as Route);
        if (!route.ok) return route;
        assembled.routes.push(route.value);
      }
      for (const memory of registration.memoryRoutes ?? []) {
        const route = routeOf(routes, memory as Route);
        if (!route.ok) return route;
        assembled.routes.push(route.value);
      }
      for (const port of portList(registration.ports)) {
        assembled.ports.push(port);
      }
      assembled.blobFields.push(...registration.blobFields ?? []);
      for (const source of registration.secretRefs ?? []) {
        const check = taken(secretOwners, source.owner, source);
        if (!check.ok) return check;
        assembled.secretRefs.push(check.value);
      }
      for (const worker of registration.workers ?? []) {
        const check = taken(workers, worker.kind, worker);
        if (!check.ok) return check;
        assembled.workers.push(worker);
      }
    }
  }
  return { ok: true, value: assembled };
}
