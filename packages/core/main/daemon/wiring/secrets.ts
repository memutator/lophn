import { err, ok } from "../../../../base/mod.ts";
import { providerSecretDestinations } from "../../../lophn-agent/providers/mod.ts";
import { createSecretDestinations } from "../../../lophn-agent/secret-destinations.ts";
import { mcpServerSnapshot } from "../../../lophn-agent/extensions/mcp-snapshot.ts";
import { readOperatorMcp } from "./operator-mcp.ts";
import { PROJECT_LAYER } from "../../../agent-roles/place/project-layer.ts";
import {
  secretDelete,
  secretPut,
  secretStatus,
} from "../../../../protocol/secrets/mod.ts";
import {
  createFileSecretAttach,
  createSecretFileStore,
  openSecretStore,
  secretDeleteHandler,
  secretPutHandler,
  secretStatusHandler,
  type SecretStore,
} from "../../../secrets/mod.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
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
        log: (message) => console.error(`secrets: ${message}`),
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
      // provider와 MCP credential만 허용한다. 앱 secret은 아직 소유 concern이 없어 거절한다(fail-closed).
      // process는 관측한 감독 상태로 보고, 같은 generation인지는 부르는 쪽(runtime-secret)이 따로 본다.
      // 목적지는 이름 공간마다 부를 때 읽는다(lophn-agent/secret-destinations.ts).
      ctx.provide(
        "secretAttach",
        createFileSecretAttach({
          file,
          allowance: (allowed) =>
            allowed.purpose === "provider_credential" ||
              allowed.purpose === "external_mcp_credential"
              ? ok(undefined)
              : err({
                code: "forbidden",
                message: "secret 전송을 허용하지 않는다",
              }),
          processes: (context) =>
            context.conditions.process !== undefined &&
            ctx.peek.io?.observation(context.conditions.process).available ===
              true,
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
                operators: () => readOperatorMcp(ctx.ledgerPath),
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
      if (!opened.ok) console.error("secrets: secret 파일을 열지 못했다");
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
