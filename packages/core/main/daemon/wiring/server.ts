import { ok } from "../../../../base/mod.ts";
import {
  connectionConnect,
  connectionEndChild,
  connectionEndConnection,
  connectionRegisterChild,
} from "../../../../protocol/coding-agent/mod.ts";
import { codingAgentOperationPolicies } from "../../../apps/connections/operations.ts";
import { CREDENTIAL_SCHEMA } from "../../../server/credentials.ts";
import {
  CredentialRegistry,
  type OperationPolicy,
} from "../../../server/identity/mod.ts";
import {
  connectHandler,
  createCodingCredentials,
  endChildHandler,
  endConnectionHandler,
  registerChildHandler,
  withRevocationSweep,
} from "../../../server/identity/coding-credential-assembly.ts";
import type { WiringFactory } from "./context.ts";

// 마지막 wiring이다. 쓰기 앞 처리기 가운데 가장 바깥이고, 앞 wiring의 operation을 모두 본 뒤에 registry를 연다.
export const serverWiring: WiringFactory = () => ({
  name: "server",
  schemaSteps: [CREDENTIAL_SCHEMA],
  operations(ctx) {
    return [
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
      // 파일 작업 결과 기록. 사람 요청에 결합해 받은 worker만 쓴다.
      { name: "file.record_result", actors: ["machine"], kind: "command" },
      // 사람 token 상한. user를 허용하는 route만 올라가고 다른 actor의 상한은 그대로다.
      ...ctx.allRoutes.filter((route) => route.actors.includes("user")).map((
        route,
      ): OperationPolicy => ({
        name: route.name,
        actors: ["user"],
        kind: route.kind === "command" ? "command" : "read",
      })),
    ];
  },
  prepare(ctx) {
    // machine은 command kind 정책에만 닿는다(identity model operationCeiling).
    const coding = createCodingCredentials({
      ledgerPath: ctx.ledgerPath,
      dataRoot: ctx.root.path,
      keychain: ctx.options.codingKeychain,
      clock: ctx.clock,
      random: ctx.random,
      loaders: ctx.options.codingLoaders,
    });
    ctx.provide("coding", coding);
    ctx.provide(
      "registry",
      new CredentialRegistry({
        epoch: ctx.epoch,
        clock: ctx.clock,
        random: ctx.random,
        external: coding.authority,
        // coding_agent 상한은 route가 선언한 actors를 따른다(blobs 제외).
        operations: [
          ...ctx.operations,
          ...codingAgentOperationPolicies(ctx.allRoutes, ctx.operations),
        ],
      }),
    );
  },
  build(ctx) {
    const coding = ctx.coding;
    return ok({
      writer: (inner) =>
        withRevocationSweep(
          inner,
          () => ctx.appsControl.connector.sweep(),
          // 회수된 connection 아래 등록된 MCP·CLI child도 바로 닫는다.
          (connection) => coding.authority.endConnection(connection),
        ),
      memory: [
        // 사람의 연결 결정 입구.
        [
          `${connectionConnect.resource}/${connectionConnect.method}`,
          connectHandler(coding, () => ctx.runtime.writer),
        ],
        // 신뢰 감독(shell main, 사람 credential)이 TUI 아래 MCP·CLI child를 등록·해제한다.
        [
          `${connectionRegisterChild.resource}/${connectionRegisterChild.method}`,
          registerChildHandler(coding),
        ],
        [
          `${connectionEndChild.resource}/${connectionEndChild.method}`,
          endChildHandler(coding),
        ],
        [
          `${connectionEndConnection.resource}/${connectionEndConnection.method}`,
          endConnectionHandler(coding),
        ],
      ],
    });
  },
  start(ctx) {
    // 고아 정리와 active connection 색인 복원은 기동을 기다리게 하지 않는다. 실패는 진단 log뿐이다.
    void ctx.coding.start(
      ctx.registry,
      (context) => ctx.runtime.record(context),
    )
      .catch(() => {});
    return Promise.resolve(ok(undefined));
  },
});
