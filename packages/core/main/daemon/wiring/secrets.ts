import { err, ok } from "../../../../base/mod.ts";
import {
  secretDelete,
  secretPut,
  secretStatus,
} from "../../../../protocol/secrets/mod.ts";
import { PROJECT_LAYER } from "../../../agent-workspaces/workspace/project-layer.ts";
import { secretAllowanceOver } from "../../../apps/permissions/mod.ts";
import { releaseFacts } from "../../../apps/releases/mod.ts";
import { mcpServerSnapshot } from "../../../lophn-agent/extensions/mcp-snapshot.ts";
import { providerSecretDestinations } from "../../../lophn-agent/providers/mod.ts";
import { createSecretDestinations } from "../../../lophn-agent/secret-destinations.ts";
import {
  createFileSecretAttach,
  createSecretFileStore,
  openSecretStore,
  type SecretStore,
  secretDeleteHandler,
  secretPutHandler,
  secretStatusHandler,
} from "../../../secrets/mod.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import { readAgentMcp } from "./agent-mcp.ts";
import type { WiringFactory } from "./context.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

export const secretsWiring: WiringFactory = () => {
  let store: SecretStore | undefined;
  return {
    name: "secrets",
    // 파일 저장소와 port를 런타임 전에 낸다. reader pool 통로는 runtime이 열린 뒤에야 있어 부를 때 읽는다.
    prepare(ctx) {
      const file = createSecretFileStore({
        root: ctx.root.path,
        log: (message) =>
          ctx.telemetry.logger.warn({
            component: "secrets",
            event: "file_store",
            message,
          }),
      });
      store = openSecretStore({
        file,
        channel: {
          register: (values) => ctx.runtime.readers.known.register(values),
          revoke: (values) => ctx.runtime.readers.known.revoke(values),
          setReady: (ready) => ctx.runtime.readers.known.setReady(ready),
        },
      });
      ctx.provide("secretStore", store);
      // 값을 다 알기 전(open 전, 못 읽는 동안)에는 ready가 false라서 redactor가 막는다.
      ctx.provide("knownSecrets", store.known);
      // provider·MCP credential은 목적지를 이름 공간(destinations)이 정한다. 앱 secret은 현재 선언 ∩ active grant가
      // 정하고, 앱 호출마다 읽기 연결을 열어 판정한다(apps build보다 먼저 만들어지므로 API port는 늦게 읽는다).
      // process는 관측한 감독 상태(io 또는 apps supervisor)로 보고, 같은 generation인지는 부르는 쪽(runtime-secret)이 따로 본다.
      // 목적지는 이름 공간마다 부를 때 읽는다(lophn-agent/secret-destinations.ts).
      ctx.provide(
        "secretAttach",
        createFileSecretAttach({
          file,
          allowance: (allowed) => {
            if (allowed.purpose !== "app_secret") {
              return allowed.purpose === "provider_credential" ||
                allowed.purpose === "external_mcp_credential"
                ? ok(undefined)
                : err({
                    code: "forbidden",
                    message: "secret 전송을 허용하지 않는다",
                  });
            }
            const opened = openConnection(ctx.ledgerPath);
            if (!opened.ok) return opened;
            const { sql } = opened.value;
            try {
              return secretAllowanceOver({
                sql,
                facts: (app) => releaseFacts.get(sql, app),
                platformPorts: () => {
                  const port = ctx.peek.server?.port ?? 0;
                  return port === 0 ? [] : [port];
                },
              })(allowed);
            } finally {
              opened.value.close();
            }
          },
          processes: (context) => {
            const process = context.conditions.process;
            return (
              process !== undefined &&
              (ctx.peek.io?.observation(process).available === true ||
                ctx.peek.appsSupervision?.observation(process).available ===
                  true)
            );
          },
          destinations: createSecretDestinations({
            providers(name) {
              const opened = openConnection(ctx.ledgerPath);
              if (!opened.ok) return [];
              try {
                return providerSecretDestinations(opened.value.sql, name);
              } finally {
                opened.value.close();
              }
            },
            mcpServers: () =>
              mcpServerSnapshot(ctx.ledgerPath, {
                projectLayer: PROJECT_LAYER,
                agents: () => readAgentMcp(ctx.ledgerPath),
              }),
            secrets: file,
          }),
        }),
      );
    },
    async build(ctx) {
      const secrets = store!;
      // 파일을 열고 값을 reader pool에 올린다. API가 열리기 전이라 첫 요청 전에 알려진 값이 맞다. 못 읽으면
      // secret 기능만 unavailable이고 redactor가 막힌 채 재시도한다.
      const opened = await secrets.open();
      if (!opened.ok) {
        ctx.telemetry.logger.error({
          component: "secrets",
          event: "open_failed",
          message: "secret 파일을 열지 못했다",
        });
      }
      // 다시 뜬 reader는 알려진 값을 모른다. 현재 값을 다시 올린다.
      ctx.runtime.onReaderRespawn(() => secrets.sync());
      return ok({
        memory: [
          [key(secretStatus), secretStatusHandler(secrets)],
          [key(secretDelete), secretDeleteHandler(secrets)],
        ],
        uploads: [[key(secretPut), secretPutHandler(secrets)]],
      });
    },
    closeIntake() {
      store?.stop();
    },
  };
};
