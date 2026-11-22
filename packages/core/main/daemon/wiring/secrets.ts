import { createIdSource, err, ok } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import type { TabOwner } from "../../../host-queue/mod.ts";
import { publishStateChanged } from "../../../../protocol/events/changes.ts";
import {
  browserProfilesCleared,
  browserProfilesDelete,
  browserProfilesList,
  browserProfilesSave,
  LOGIN_FIELDS,
  type LoginField,
  loginIdSchema,
  LOGIN_SECRET_PREFIX,
  loginsDelete,
  loginsList,
  loginsRelease,
  loginsSave,
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
  type BrowserVault,
  browserProfilesClearedHandler,
  browserProfilesDeleteHandler,
  browserProfilesListHandler,
  browserProfilesSaveHandler,
  createBrowserVault,
  createFileSecretAttach,
  createSecretFileStore,
  loginsDeleteHandler,
  loginsListHandler,
  loginsReleaseHandler,
  loginsSaveHandler,
  openSecretStore,
  type SecretStore,
  secretDeleteHandler,
  secretPutHandler,
  secretStatusHandler,
  touchLoginValue,
} from "../../../secrets/mod.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import { readAgentMcp } from "./agent-mcp.ts";
import { agentBrowserProfile } from "./browser-profile.ts";
import { browserVaultStep } from "./browser-vault-step.ts";
import { createProductRedactor, type WiringFactory } from "./context.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

// `login.<id>.<field>`이면 그 login과 칸이다.
function loginValueName(
  name: string,
): { id: string; field: LoginField } | undefined {
  if (!name.startsWith(LOGIN_SECRET_PREFIX)) return undefined;
  const [id, field, ...rest] = name
    .slice(LOGIN_SECRET_PREFIX.length)
    .split(".");
  return rest.length === 0 &&
    loginIdSchema.safeParse(id).success &&
    (LOGIN_FIELDS as readonly string[]).includes(field ?? "")
    ? { id: id!, field: field as LoginField }
    : undefined;
}

export const secretsWiring: WiringFactory = () => {
  let store: SecretStore | undefined;
  let vault: BrowserVault | undefined;
  return {
    name: "secrets",
    dataSteps: [browserVaultStep],
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
      vault = createBrowserVault({ root: ctx.root.path, clock: ctx.clock });
      ctx.provide("browserVault", vault);
      // 값을 다 알기 전(open 전, 못 읽는 동안)에는 ready가 false라서 redactor가 막는다.
      ctx.provide("knownSecrets", store.known);
      // log가 file에 남으므로 알려진 secret 원문도 지운다. 아직 다 모르면(ready 전) pattern 규칙만 적용된다.
      const redactKnown = createProductRedactor(store.known);
      const logSource = {
        concern: "diagnostics/log",
        revision: "1",
        scope: "log",
      };
      ctx.telemetry.useRedactor(
        (text) => redactKnown(logSource, "text/plain", text) ?? text,
      );
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
      const logins = vault!;
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      // site login 값을 넣거나 지우면 그 칸의 stamp를 올린다(다른 컴퓨터와 칸마다 합친다).
      const valueChanged = (name: string) => {
        const login = loginValueName(name);
        if (login === undefined) return;
        const touched = touchLoginValue(logins, login.id, login.field);
        if (!touched.ok) {
          ctx.telemetry.logger.warn({
            component: "secrets",
            event: "login_value_stamp_failed",
            message: touched.error.message,
          });
          return;
        }
        if (touched.value) {
          publishStateChanged(ctx.bus, ctx.clock.now(), [
            { name: "logins", id: login.id },
          ]);
        }
      };
      return ok({
        memory: [
          [
            key(loginsList),
            loginsListHandler({
              vault: logins,
              secrets,
              // 탭 표는 host-queue wiring이 늦게 낸다. 부를 때 읽고, 아직 없으면 그 탭은 없다.
              tabProfile: (tab, caller) =>
                ctx.peek.hostQueue?.tabProfile(
                  tab as Id<"tab">,
                  caller as TabOwner,
                ) ?? err({ code: "not_found", message: "no such tab" }),
              agentBrowserProfile: (session) =>
                agentBrowserProfile(ctx, session),
            }),
          ],
          [key(loginsSave), loginsSaveHandler({ vault: logins, ids })],
          [key(loginsDelete), loginsDeleteHandler({ vault: logins, secrets })],
          [
            key(loginsRelease),
            loginsReleaseHandler({
              vault: logins,
              secrets,
              // 늦게 읽는다. 아직 없으면 아무도 통과하지 못한다.
              capabilities: {
                has: (capability) =>
                  ctx.peek.shellCapabilities?.has(capability) ?? false,
              },
              clock: ctx.clock,
            }),
          ],
          [
            key(browserProfilesList),
            browserProfilesListHandler({ vault: logins }),
          ],
          [
            key(browserProfilesSave),
            browserProfilesSaveHandler({ vault: logins, ids }),
          ],
          [
            key(browserProfilesDelete),
            browserProfilesDeleteHandler({ vault: logins, secrets }),
          ],
          [
            key(browserProfilesCleared),
            browserProfilesClearedHandler({ vault: logins }),
          ],
          [key(secretStatus), secretStatusHandler(secrets)],
          [key(secretDelete), secretDeleteHandler(secrets, valueChanged)],
        ],
        uploads: [[key(secretPut), secretPutHandler(secrets, valueChanged)]],
      });
    },
    closeIntake() {
      store?.stop();
    },
  };
};
