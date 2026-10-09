import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  AGENT_RUNTIME_PRINCIPAL,
  assignmentRead,
  providerList,
  runRead,
} from "../../packages/contracts/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  ChildMessage,
  Frame,
  KindLaunchSpec,
  ParentMessage,
  ReadRoute,
  RequestContext,
} from "../../packages/contracts/platform/mod.ts";
import {
  eventsList,
  routePath,
} from "../../packages/contracts/platform/mod.ts";
import {
  BUILTIN_TOOLS,
  runOperations,
} from "../../packages/lophn-agent/harness/tools/mod.ts";
import {
  type AgentCredentialIssuer,
  EXTERNAL_TOOL_OPERATIONS,
  RUNTIME_MACHINE_OPERATIONS,
} from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import type {
  CredentialRegistry,
  OperationPolicy,
} from "../../packages/platform/identity/mod.ts";
import type { Supervisor } from "../../packages/platform/responsiveness/mod.ts";
import { answerRedactRequest } from "./agent-runtime-redaction.ts";
import type { AgentRuntimeSecrets } from "./agent-runtime-secret.ts";
import { createAgentCredentialLink } from "./agent-credentials.ts";
import {
  type ChildBlobPrepare,
  createChildBlobPrepare,
} from "./child-blob-prepare.ts";
import type { BlobPrepareCall } from "./core.ts";
import type { BufferGauge, PreparedRelayResult } from "./blob-prepare.ts";
import type { KnownSecretMatch } from "../../packages/platform/ledger/mod.ts";
import { agentRuntimeLaunchSpec } from "./lophn-agent.ts";

// 제품 core가 agent runtime child를 띄우고 감독하는 자리(lophn-agent/harness/run-loop). child는
// 상시 신뢰 process이고 core 안의 인증 경계(CredentialRegistry)가 두 가지 자격을 발급한다.
// - hello에 싣는 machine credential: principal `machine:agent-runtime`, scope는 runtime이 부르는
//   machine route의 operation 목록(`RUNTIME_MACHINE_OPERATIONS`)이다.
// - run마다 `agent:<asg>` credential: child가 감독 pipe로 청하고, core가 자기 ledger 기록으로
//   대조한 뒤 발급한다(`createAgentCredentialLink`).
// 감독 pipe의 blob 준비 요청은 child kind의 정책(child-blob-prepare)으로 받는다. 등록한 provider
// 목적지가 바뀌면 권한 목록이 달라지므로 core가 옛 child를 멈추고 새 목록으로 다시 띄운다.

export const AGENT_RUNTIME_KIND = "lophn-agent/runtime";
export const AGENT_RUNTIME_TASK = "lophn-agent";
// agent credential의 process 조건이다. child가 끝나면 이 조건의 credential을 모두 끝낸다.
export const AGENT_RUNTIME_PROCESS = "agent-runtime";
// 등록 provider 목적지가 바뀌었는지 보는 주기.
export const AGENT_RUNTIME_HOSTS_POLL_MS = 1_000;

type RouteLike = { name: string; kind: string };

// 제품 registry의 발급 상한. machine은 command 정책에만 닿으므로 runtime의 machine route는 모두
// command 정책으로 올리고, agent는 내장 tool이 쓰는 contract를 route의 종류 그대로 올린다.
// external_mcp_call은 route 이름이 없는 T37의 소유 contract라 command 정책으로 두고, ask가 쓰는
// approval request 생성(create_approval_request)을 같이 올린다(T37).
export function agentRuntimePolicies(
  routes: readonly RouteLike[],
): OperationPolicy[] {
  const kinds = new Map(routes.map((route) => [route.name, route.kind]));
  const agent = [
    ...new Set([...runOperations(BUILTIN_TOOLS), ...EXTERNAL_TOOL_OPERATIONS]),
  ];
  return [
    ...RUNTIME_MACHINE_OPERATIONS.map((name): OperationPolicy => ({
      name,
      actors: ["machine"],
      kind: "command",
    })),
    ...agent.map((name): OperationPolicy => ({
      name,
      actors: ["agent"],
      kind: kinds.get(name) === "read" ? "read" : "command",
    })),
  ];
}

// registry가 발급한 자격은 core 프로세스 메모리의 token과 ledger의 기록 둘이 있어야 쓰인다.
export function agentCredentialIssuer(
  registry: CredentialRegistry,
  record: (context: AuthenticatedContext) => Promise<Result<void>>,
): AgentCredentialIssuer {
  return {
    async issue(input) {
      const issued = await registry.issue(input);
      if (!issued.ok) return issued;
      const current = registry.revalidate({
        credential_ref: issued.value.credential_ref,
      });
      if (!current.ok) return current;
      // ledger 기록의 scope는 operation과 target뿐이다(strict). AgentAppScope는 StartRun의
      // `RunStarted` event가 고정한 값이고 발급 경계가 그 값과 대조해 발급했다.
      const { agent: _agent, ...scope } = current.value.scope as
        & AuthenticatedContext["scope"]
        & { agent?: unknown };
      const recorded = await record({ ...current.value, scope });
      if (!recorded.ok) {
        registry.end(issued.value.credential_ref);
        return recorded;
      }
      return issued;
    },
    endBy: (condition, value) => registry.endBy(condition, value),
  };
}

// provider endpoint 하나가 열어야 하는 목적지. https의 기본 port는 443, http는 80이다.
export function providerHost(endpoint: string): string | undefined {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return undefined;
  }
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `${url.hostname.replace(/^\[|\]$/g, "")}:${port}`;
}

// 읽기 자격. 발급한 credential이 아니라 reader에 넘기는 context다.
const HOSTS_READER: RequestContext = {
  principal: "machine:agent-runtime-hosts",
  actor: "machine",
  scope: { operations: [providerList.name], targets: {} },
  conditions: {},
  credential_ref: "machine:agent-runtime-hosts",
};

// 발급 판정이 읽는 route뿐이다. 요청한 run·assignment·scope를 core 자신의 기록과 대조한다.
const LINK_READS: ReadonlyMap<string, ReadRoute> = new Map(
  ([runRead, assignmentRead, eventsList] as ReadRoute[]).map((
    route,
  ) => [routePath(route), route]),
);

export type AgentRuntimeChild = {
  // 목적지 점검을 멈춘다. child 정지는 감독의 stopAll이 한다.
  stop(): void;
  // 가장 최근에 띄운 spec의 허용 목적지다.
  hosts(): readonly string[];
};

export type AgentRuntimeDeps = {
  io: Supervisor;
  registry: CredentialRegistry;
  record(context: AuthenticatedContext): Promise<Result<void>>;
  epoch: string;
  dataRoot: string;
  apiPort: number;
  gauge: BufferGauge;
  prepareBlob(call: BlobPrepareCall): Promise<Result<PreparedRelayResult>>;
  // 등록한 provider endpoint 목록(ledger reader).
  readProviders(context: RequestContext): Promise<Result<readonly string[]>>;
  // machine credential의 자격으로 ledger reader를 직접 읽는다(발급 판정이 쓰는 run·assignment·event).
  read(
    route: ReadRoute,
    context: RequestContext,
    input: unknown,
  ): Promise<Result<unknown>>;
  // 알려진 secret 값의 matcher. child가 보낼 글의 안전화(`redact_request`)가 쓴다.
  known(): KnownSecretMatch | undefined;
  // provider API key의 전송 부착(`secret_send_request`). child가 청하면 값을 한 번 건넨다.
  secrets: AgentRuntimeSecrets;
  // 앱 direct socket 폴더. supervisor의 `appSocketRoot`와 같은 값이다.
  socketRoot: string;
  // 목적지 점검 주기. 시험이 줄인다.
  pollMs?: number;
};

export async function startAgentRuntimeChild(
  deps: AgentRuntimeDeps,
): Promise<Result<AgentRuntimeChild>> {
  const issued = await deps.registry.issue({
    actor: "machine",
    principal: AGENT_RUNTIME_PRINCIPAL,
    scope: {
      operations: [...RUNTIME_MACHINE_OPERATIONS],
      targets: { task: AGENT_RUNTIME_TASK },
    },
    conditions: { task: AGENT_RUNTIME_TASK, process: AGENT_RUNTIME_KIND },
  });
  if (!issued.ok) return issued;
  const current = deps.registry.revalidate({
    credential_ref: issued.value.credential_ref,
  });
  if (!current.ok) return current;
  const recorded = await deps.record(current.value);
  if (!recorded.ok) return recorded;
  const token = issued.value.token;

  const hello: ParentMessage = {
    type: "hello",
    core_epoch: deps.epoch,
    process_identity: deps.epoch,
    kind: AGENT_RUNTIME_KIND,
    task: AGENT_RUNTIME_TASK,
    scope: { operations: [], targets: {} },
    credential: token,
    api_port: deps.apiPort,
  };
  const link = createAgentCredentialLink({
    issuer: agentCredentialIssuer(deps.registry, deps.record),
    machine: (path, body) => {
      const route = LINK_READS.get(path);
      return route === undefined
        ? Promise.resolve(
          err({ code: "invalid_input", message: "route is not open" }),
        )
        : deps.read(route, current.value, body);
    },
    process: AGENT_RUNTIME_PROCESS,
  });

  // 자식의 blob 준비 요청은 시작마다 새 handler가 받는다. 자식이 끝나면 열린 준비를 닫는다.
  let blob: ChildBlobPrepare | undefined;
  const newBlob = () =>
    createChildBlobPrepare({
      kind: AGENT_RUNTIME_KIND,
      gauge: deps.gauge,
      send: (message) =>
        deps.io.send(AGENT_RUNTIME_KIND, message).then((sent) => sent.ok),
      prepareBlob: deps.prepareBlob,
    });
  const callbacks = () => {
    blob?.close();
    let handler = newBlob();
    blob = handler;
    // 이 child generation이 감독 중인 동안만 값을 건넨다.
    let alive = true;
    return {
      onMessage(message: ChildMessage) {
        if (handler.onMessage(message)) return;
        if (message.type === "redact_request") {
          const response = answerRedactRequest(message, deps.known());
          if (response !== undefined) {
            void deps.io.send(AGENT_RUNTIME_KIND, response).catch(() => {});
          }
          return;
        }
        if (message.type === "secret_send_request") {
          void deps.secrets.answer(message, () => alive).then((response) => {
            if (response !== undefined && alive) {
              return deps.io.send(AGENT_RUNTIME_KIND, response);
            }
          }).catch(() => {});
          return;
        }
        void link.onMessage(message).then((response) => {
          if (response !== undefined) {
            return deps.io.send(AGENT_RUNTIME_KIND, response);
          }
        }).catch(() => {});
      },
      onFrame: (frame: Frame) => handler.onFrame(frame),
      // child가 끝났다. 그 child가 쥐고 있던 run의 agent credential은 더 쓰이지 않는다.
      onEnd() {
        alive = false;
        handler.close();
        deps.registry.endBy("process", AGENT_RUNTIME_PROCESS);
        if (blob === handler) {
          handler = newBlob();
          blob = handler;
        }
      },
    };
  };

  let hosts: readonly string[] = [];
  const specFor = (list: readonly string[]): KindLaunchSpec =>
    agentRuntimeLaunchSpec({
      dataRoot: deps.dataRoot,
      apiPort: deps.apiPort,
      socketRoot: deps.socketRoot,
      hosts: list,
    });
  const initial = await deps.readProviders(HOSTS_READER);
  if (initial.ok) hosts = initial.value;
  const started = await deps.io.start(specFor(hosts), hello, callbacks());
  if (!started.ok) {
    return err({
      code: "unavailable",
      message: "agent runtime을 시작하지 못했다",
    });
  }

  // 등록한 provider가 바뀌면 권한 목록이 달라지므로 새 목록으로 다시 띄운다.
  let stopped = false;
  let checking = false;
  const timer = setInterval(() => {
    if (stopped || checking) return;
    checking = true;
    void (async () => {
      const read = await deps.readProviders(HOSTS_READER);
      if (!read.ok || stopped) return;
      if (same(read.value, hosts)) return;
      const restarted = await deps.io.updateSpec(
        specFor(read.value),
        hello,
        callbacks(),
      );
      if (restarted.ok) hosts = read.value;
    })().catch(() => {}).finally(() => {
      checking = false;
    });
  }, deps.pollMs ?? AGENT_RUNTIME_HOSTS_POLL_MS);

  return ok({
    stop() {
      stopped = true;
      clearInterval(timer);
      blob?.close();
    },
    hosts: () => hosts,
  });
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}
