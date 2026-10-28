import { err, ok, type Result } from "../../../base/mod.ts";
import {
  AGENT_RUNTIME_PRINCIPAL,
  type PlaceKind,
  placeSessionRead,
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
import type {
  ChildMessage,
  Diagnostic,
  ModelOutputMessage,
  ParentMessage,
} from "../../../protocol/supervision/mod.ts";
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
import { createAgentCredentialLink } from "./agent-credentials.ts";
import {
  type ChildBlobPrepare,
  createChildBlobPrepare,
} from "../../storage/blobs/child-prepare.ts";
import type {
  BlobPrepareCall,
  BufferGauge,
  PreparedRelayResult,
} from "../../storage/blobs/prepare-relay.ts";
import type { KnownSecretMatch } from "../../storage/ledger/mod.ts";
import { agentRuntimeLaunchSpec } from "../register.ts";
import type { AgentEvent } from "../../../protocol/events/mod.ts";
import { createTurnPipe } from "./turn-pipe.ts";
import type { TurnSource } from "./ports.ts";
import type { Inbox } from "./inbox.ts";

// 제품 core가 agent runtime child를 띄우고 감독하는 자리. child는
// 상시 신뢰 process이고 core 안의 인증 경계(CredentialRegistry)가 두 가지 자격을 발급한다.
// - hello에 싣는 machine credential: principal `machine:agent-runtime`, scope는 runtime이 부르는
//   machine route의 operation 목록(`RUNTIME_MACHINE_OPERATIONS`)이다.
// - turn마다 `agent:<ses>` credential: child가 감독 pipe로 청하고, core가 자기 기록으로
//   대조한 뒤 발급한다(`createAgentCredentialLink`).
// 감독 pipe의 blob 준비 요청은 child kind의 정책(child-blob-prepare)으로 받는다. child가 crash하면 돌던
// turn은 core가 interrupted(restarted)로 닫는다.

export const AGENT_RUNTIME_KIND = "lophn-agent/runtime";
export const AGENT_RUNTIME_TASK = "lophn-agent";
// agent credential의 process 조건이다. child가 끝나면 이 조건의 credential을 모두 끝낸다.
const AGENT_RUNTIME_PROCESS = "agent-runtime";

type RouteLike = { name: string; kind: string };

// 제품 registry의 발급 상한. machine은 command 정책에만 닿으므로 runtime의 machine route는 모두
// command 정책으로 올리고, agent는 tool이 부르는 route를 route의 종류 그대로 올린다.
// external_mcp_call은 route 이름이 없는 소유 contract라 command 정책으로 둔다. `agentOperations`는 모든 place 종류의 상한 합집합이라
// 상한과 발급 policy가 어긋나지 않는다.
export function agentRuntimePolicies(
  routes: readonly RouteLike[],
  agentOperations: readonly string[],
): OperationPolicy[] {
  const kinds = new Map(routes.map((route) => [route.name, route.kind]));
  const agent = [...new Set([...EXTERNAL_TOOL_OPERATIONS, ...agentOperations])];
  return [
    ...RUNTIME_MACHINE_OPERATIONS.map(
      (name): OperationPolicy => ({
        name,
        actors: ["machine"],
        kind: "command",
      }),
    ),
    ...agent.map(
      (name): OperationPolicy => ({
        name,
        actors: ["agent"],
        kind: kinds.get(name) === "read" ? "read" : "command",
      }),
    ),
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

// 발급 판정이 읽는 route뿐이다. 요청한 turn과 session을 core 자신의 기록과 대조한다.
const LINK_READS: ReadonlyMap<string, ReadRoute> = new Map(
  ([turnRead, placeSessionRead] as ReadRoute[]).map((route) => [
    routePath(route),
    route,
  ]),
);

export type AgentRuntimeChild = {
  // child 정지는 감독의 stopAll이 한다. 여기서는 남은 blob 준비만 닫는다.
  stop(): void;
};

type AgentRuntimeDeps = {
  io: Supervisor;
  // place 종류의 operation 상한과 agent credential의 조건. place 층이 정한다.
  operationsFor: (kind: PlaceKind) => readonly string[];
  conditionsFor: Parameters<
    typeof createAgentCredentialLink
  >[0]["conditionsFor"];
  // child가 보낸 lophn_internal 분류(처리 못한 예외로 죽기 직전). 다른 kind는 받지 않는다.
  diagnostic?(message: Extract<Diagnostic, { kind: "lophn_internal" }>): void;
  // child가 stderr에 쓴 줄. 진단 원문은 child가 이미 안전화해서 쓴다.
  stderr?(line: string): void;
  registry: CredentialRegistry;
  record(context: AuthenticatedContext): Promise<Result<void>>;
  epoch: string;
  apiPort: number;
  gauge: BufferGauge;
  prepareBlob(call: BlobPrepareCall): Promise<Result<PreparedRelayResult>>;
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
  // child가 감독 pipe로 읽는 입력함(`createTurnSource`)과 agent event를 내는 Bus. 없으면 child는 시작할 turn을
  // 읽지 못하고 event는 버려진다.
  turns?: TurnSource;
  // child가 사라질 때 입력함의 도는 표시를 푸는 길이다. 정본은 입력함이다.
  inbox?: Pick<Inbox, "endAll">;
  // child가 사라졌다. 그 child가 돌리던 turn을 ledger에서 interrupted(restarted)로 닫는다.
  interruptTurns?: () => Promise<Result<unknown>>;
  publish?: (event: AgentEvent) => void;
  // child가 보낸 쓰는 중인 model 날 글이다. core가 redaction해 내므로 Bus에 싣지 않는다. 없으면 버린다.
  output?: (batch: ModelOutputMessage) => void;
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
    operationsFor: deps.operationsFor,
    conditionsFor: deps.conditionsFor,
  });

  const pipe =
    deps.turns === undefined
      ? undefined
      : createTurnPipe({
          source: deps.turns,
          publish: deps.publish ?? (() => {}),
          output: deps.output ?? (() => {}),
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
        if (message.type === "diagnostic") {
          if (message.kind === "lophn_internal") deps.diagnostic?.(message);
          return;
        }
        if (handler.onMessage(message)) return;
        if (message.type === "redact_request") {
          const response = answerRedactRequest(message, deps.known());
          if (response !== undefined) {
            void deps.io.send(AGENT_RUNTIME_KIND, response).catch(() => {});
          }
          return;
        }
        if (message.type === "secret_send_request") {
          void deps.secrets
            .answer(message, () => alive)
            .then((response) => {
              if (response !== undefined && alive) {
                return deps.io.send(AGENT_RUNTIME_KIND, response);
              }
            })
            .catch(() => {});
          return;
        }
        const piped = pipe?.onMessage(message);
        if (piped?.handled) {
          void piped.response
            ?.then((response) => deps.io.send(AGENT_RUNTIME_KIND, response))
            .catch(() => {});
          return;
        }
        void link
          .onMessage(message)
          .then((response) => {
            if (response !== undefined) {
              return deps.io.send(AGENT_RUNTIME_KIND, response);
            }
          })
          .catch(() => {});
      },
      onFrame: (frame: Frame) => handler.onFrame(frame),
      onStderr: (line: string) => deps.stderr?.(line),
      // child가 끝났다. 그 child가 쥐고 있던 turn의 agent credential은 더 쓰이지 않고, 돌던 turn은 닫힌다.
      // 입력함의 도는 표시는 ledger가 닫힌 뒤에 푼다: 먼저 풀면 새 입력이 아직 running인 행과 겹친다.
      onEnd() {
        alive = false;
        handler.close();
        deps.registry.endBy("process", AGENT_RUNTIME_PROCESS);
        void (deps.interruptTurns?.() ?? Promise.resolve())
          .catch(() => {})
          .finally(() => deps.inbox?.endAll());
        if (blob === handler) {
          handler = newBlob();
          blob = handler;
        }
      },
    };
  };

  const started = await deps.io.start(
    agentRuntimeLaunchSpec(),
    hello,
    callbacks(),
  );
  if (!started.ok) {
    return err({
      code: "unavailable",
      message: "agent runtime을 시작하지 못했다",
    });
  }

  return ok({
    stop() {
      blob?.close();
    },
  });
}
