import type { Result } from "../../../base/mod.ts";
import type {
  ApiReadDefinition,
  CommandDefinition,
  ReadDefinition,
  SchemaStep,
} from "../../../protocol/server/mod.ts";
import type { BlobFieldDefinition } from "../../../protocol/storage/mod.ts";
import type { Route } from "../../../protocol/base/mod.ts";
import type { TxPortRegistration } from "../../storage/ledger/mod.ts";
import type { TeamModule } from "../../storage/ledger/team-module.ts";

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
  blobFields?: readonly BlobFieldDefinition[];
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
  blobFields: BlobFieldDefinition[];
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

// 팀 모듈을 한 목록으로 모은다. 같은 schema id·command 이름·read 경로는 거절한다.
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
    blobFields: [],
  };
  const schema = new Set<string>();
  const commands = new Set<string>();
  const reads = new Set<string>();
  const routes = new Set<string>();
  for (const team of modules) {
    const direct = team.createCoreRegistration?.();
    const fromLedger = team.createLedgerRegistration
      ? asLoose(team.createLedgerRegistration(environment as never))
      : undefined;
    const fromLophnAgent = asLoose(team.lophnAgentDefinitions);
    // 한 모듈이 등록을 여러 키로 내보낼 수 있다. 첫 키만 고르면 뒤 등록의
    // schema·route가 core에 안 들어간다.
    const registrations = [
      asLoose(direct),
      fromLedger,
      fromLophnAgent,
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
    }
  }
  return { ok: true, value: assembled };
}
