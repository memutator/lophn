import { err, ok, type Result } from "../../../base/mod.ts";
import {
  AGENT_RUNTIME_PRINCIPAL,
  agentSessionRead,
  providerList,
  turnRead,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import {
  type Frame,
  type ReadRoute,
  routePath,
} from "../../../protocol/base/mod.ts";
import { settingsList } from "../../../protocol/config/mod.ts";
import type {
  ChildMessage,
  KindLaunchSpec,
  ParentMessage,
} from "../../../protocol/supervision/mod.ts";
import { BUILTIN_TOOLS, runOperations } from "../tools/mod.ts";
import {
  type AgentCredentialIssuer,
  EXTERNAL_TOOL_OPERATIONS,
  RUNTIME_MACHINE_OPERATIONS,
} from "./mod.ts";
import type {
  CredentialRegistry,
  OperationPolicy,
} from "../../server/identity/mod.ts";
import type { Supervisor } from "../../supervision/responsiveness/mod.ts";
import { answerRedactRequest } from "./runtime-redaction.ts";
import type { AgentRuntimeSecrets } from "./runtime-secret.ts";
import {
  createAgentCredentialLink,
  roleOperations,
} from "./agent-credentials.ts";
import {
  type ChildBlobPrepare,
  createChildBlobPrepare,
} from "../../storage/blobs/child-prepare.ts";
import type { BlobPrepareCall } from "../../main/daemon/core.ts";
import type {
  BufferGauge,
  PreparedRelayResult,
} from "../../storage/blobs/prepare-relay.ts";
import type { KnownSecretMatch } from "../../storage/ledger/mod.ts";
import { agentRuntimeLaunchSpec } from "../register.ts";
import { ROLES } from "../../../protocol/lophn-agent/mod.ts";
import type { McpRuntimeServer as McpServerConfig } from "../extensions/mod.ts";
import { allowNetList, allowRunList } from "../extensions/mod.ts";
import type { AgentEvent } from "../../../protocol/events/mod.ts";
import { createTurnPipe } from "./turn-pipe.ts";
import type { TurnSource } from "./ports.ts";

// 제품 core가 agent runtime child를 띄우고 감독하는 자리. child는
// 상시 신뢰 process이고 core 안의 인증 경계(CredentialRegistry)가 두 가지 자격을 발급한다.
// - hello에 싣는 machine credential: principal `machine:agent-runtime`, scope는 runtime이 부르는
//   machine route의 operation 목록(`RUNTIME_MACHINE_OPERATIONS`)이다.
// - turn마다 `agent:<ses>` credential: child가 감독 pipe로 청하고, core가 자기 기록으로
//   대조한 뒤 발급한다(`createAgentCredentialLink`).
// 감독 pipe의 blob 준비 요청은 child kind의 정책(child-blob-prepare)으로 받는다. 등록한 provider
// 목적지가 바뀌면 권한 목록이 달라지므로 core가 옛 child를 멈추고 새 목록으로 다시 띄운다.

export const AGENT_RUNTIME_KIND = "lophn-agent/runtime";
export const AGENT_RUNTIME_TASK = "lophn-agent";
// agent credential의 process 조건이다. child가 끝나면 이 조건의 credential을 모두 끝낸다.
const AGENT_RUNTIME_PROCESS = "agent-runtime";
// 등록 provider 목적지가 바뀌었는지 보는 주기.
const AGENT_RUNTIME_HOSTS_POLL_MS = 1_000;

type RouteLike = { name: string; kind: string };

// 제품 registry의 발급 상한. machine은 command 정책에만 닿으므로 runtime의 machine route는 모두
// command 정책으로 올리고, agent는 내장 tool이 쓰는 contract를 route의 종류 그대로 올린다.
// external_mcp_call은 route 이름이 없는 소유 contract라 command 정책으로 두고, ask가 쓰는
// approval request 생성(create_approval_request)을 같이 올린다. 역할 상한(roleOperations)이 닿는
// operation은 모든 역할의 합집합으로 올려 상한과 발급 policy가 어긋나지 않게 한다.
export function agentRuntimePolicies(
  routes: readonly RouteLike[],
): OperationPolicy[] {
  const kinds = new Map(routes.map((route) => [route.name, route.kind]));
  const agent = [
    ...new Set([
      ...runOperations(BUILTIN_TOOLS),
      ...EXTERNAL_TOOL_OPERATIONS,
      ...ROLES.flatMap((role) => roleOperations(role)),
    ]),
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
function agentCredentialIssuer(
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
      const recorded = await record(current.value);
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

// 등록한 skill 폴더를 읽는 자격이다. 이 폴더만 child의 읽기 허락에 더한다.
const SKILL_ROOTS_READER: RequestContext = {
  principal: "machine:agent-runtime-skill-roots",
  actor: "machine",
  scope: { operations: [settingsList.name], targets: {} },
  conditions: {},
  credential_ref: "machine:agent-runtime-skill-roots",
};

// 발급 판정이 읽는 route뿐이다. 요청한 turn과 session을 core 자신의 기록과 대조한다.
const LINK_READS: ReadonlyMap<string, ReadRoute> = new Map(
  ([turnRead, agentSessionRead] as ReadRoute[]).map((
    route,
  ) => [routePath(route), route]),
);

export type AgentRuntimeChild = {
  // 목적지 점검을 멈춘다. child 정지는 감독의 stopAll이 한다.
  stop(): void;
  // 가장 최근에 띄운 spec의 허용 목적지다.
  hosts(): readonly string[];
};

type AgentRuntimeDeps = {
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
  // 사람이 등록한 MCP server 설정(설정 registry의 snapshot). 없으면 MCP 권한은 없다. enabled인 stdio
  // 실행 경로와 HTTP `host:port`만 child 권한이 되고, 이 목록이 바뀌면 child를 다시 띄운다.
  readMcpServers?(): Promise<Result<readonly McpServerConfig[]>>;
  // 사람이 등록한 skill 폴더(절대 경로, 등록 순서). 읽기 허락에 더한다.
  readSkillRoots?(
    context: RequestContext,
  ): Promise<Result<readonly string[]>>;
  // machine credential의 자격으로 ledger reader를 직접 읽는다(발급 판정이 쓰는 turn·session).
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
  // child가 감독 pipe로 읽는 입력함(`createTurnSource`)과 agent event를 내는 Bus. 없으면 child는 시작할 turn을
  // 읽지 못하고 event는 버려진다.
  turns?: TurnSource;
  publish?: (event: AgentEvent) => void;
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

  const pipe = deps.turns === undefined ? undefined : createTurnPipe({
    source: deps.turns,
    publish: deps.publish ?? (() => {}),
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
        const piped = pipe?.onMessage(message);
        if (piped?.handled) {
          void piped.response?.then((response) =>
            deps.io.send(AGENT_RUNTIME_KIND, response)
          ).catch(() => {});
          return;
        }
        void link.onMessage(message).then((response) => {
          if (response !== undefined) {
            return deps.io.send(AGENT_RUNTIME_KIND, response);
          }
        }).catch(() => {});
      },
      onFrame: (frame: Frame) => handler.onFrame(frame),
      // child가 끝났다. 그 child가 쥐고 있던 turn의 agent credential은 더 쓰이지 않는다.
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
  let mcp: readonly McpServerConfig[] = [];
  let skillRoots: readonly string[] = [];
  const readSkillRoots = async (): Promise<readonly string[] | undefined> => {
    if (deps.readSkillRoots === undefined) return skillRoots;
    const read = await deps.readSkillRoots(SKILL_ROOTS_READER);
    return read.ok ? read.value : undefined;
  };
  const specFor = (
    list: readonly string[],
    roots: readonly string[],
    servers: readonly McpServerConfig[],
  ): KindLaunchSpec =>
    agentRuntimeLaunchSpec({
      dataRoot: deps.dataRoot,
      apiPort: deps.apiPort,
      socketRoot: deps.socketRoot,
      hosts: list,
      mcpServers: servers,
      skillRoots: roots,
      placeFolders: { read: [], write: [] },
    });
  // 읽지 못한 목록은 바꾸지 않은 것으로 본다. 권한은 읽은 목록으로만 정해진다.
  const readMcp = async (): Promise<readonly McpServerConfig[] | undefined> => {
    if (deps.readMcpServers === undefined) return [];
    const read = await deps.readMcpServers();
    return read.ok ? read.value : undefined;
  };
  const initial = await deps.readProviders(HOSTS_READER);
  if (initial.ok) hosts = initial.value;
  skillRoots = (await readSkillRoots()) ?? [];
  mcp = await readMcp() ?? [];
  const started = await deps.io.start(
    specFor(hosts, skillRoots, mcp),
    hello,
    callbacks(),
  );
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
      const roots = await readSkillRoots();
      if (!read.ok || roots === undefined || stopped) return;
      const servers = await readMcp();
      if (servers === undefined || stopped) return;
      // 권한에 닿는 것은 provider 목적지, skill 폴더, MCP의 net·run 목록뿐이다. 다른 설정 변경은 다시 띄우지 않는다.
      if (
        same(read.value, hosts) && same(roots, skillRoots) &&
        same(allowNetList(servers), allowNetList(mcp)) &&
        same(allowRunList(servers), allowRunList(mcp))
      ) return;
      const restarted = await deps.io.updateSpec(
        specFor(read.value, roots, servers),
        hello,
        callbacks(),
      );
      if (restarted.ok) {
        hosts = read.value;
        mcp = servers;
        skillRoots = roots;
      }
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
