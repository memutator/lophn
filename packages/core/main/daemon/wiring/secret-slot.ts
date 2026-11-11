// secret 자리의 해석이다. agent는 secret 이름이 아니라 자리를 넘기고, 여기서 이름·대상·목적지를 정의·선언·설정에서 읽는다.
// 어느 workspace의 session이 어느 자리를 청할 수 있는지도 여기서 가른다. 값을 넣는 자리는 secret 요청으로,
// 넣을 값이 없고 로그인하는 자리(구독 provider, 앱 OAuth, MCP OAuth)는 sign_in 요청으로 풀린다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { appGet } from "../../../../protocol/apps/apps.ts";
import { appGrantsList } from "../../../../protocol/apps/grants.ts";
import { appOAuthNames } from "../../../../protocol/apps/oauth.ts";
import type { SecretSlot } from "../../../../protocol/lophn-agent/input-request.ts";
import {
  CUSTOM_ID_SHAPE,
  customBaseUrl,
  customDefinition,
  customNeedsKey,
} from "../../../../protocol/lophn-agent/custom-provider.ts";
import {
  providerDefinitions,
  providerList,
} from "../../../../protocol/lophn-agent/providers.ts";
import type { Workspace } from "../../../../protocol/lophn-agent/workspaces.ts";
import type { RegisteredMcpServer } from "../../../lophn-agent/extensions/mcp-snapshot.ts";
import type { RequestContent } from "../../../lophn-agent/tools/questions/wait.ts";

type SecretContent = Extract<RequestContent, { kind: "secret" }>;
type SignInContent = Extract<RequestContent, { kind: "sign_in" }>;
type SlotContent = SecretContent | SignInContent;

// 내장 정의의 model 목록 주소는 API base 바로 아래 한 칸이다(`<base>/models`). Settings › Providers의 연결과 같은 규칙이다.
function baseOf(modelsEndpoint: string | null): string | null {
  if (modelsEndpoint === null) return null;
  const cut = modelsEndpoint.lastIndexOf("/");
  return cut > "https://".length ? modelsEndpoint.slice(0, cut) : null;
}

const PAGE_LIMIT = 20;

type SecretSlotDeps = {
  // core의 read route를 요청 wiring의 machine 자격으로 읽는다.
  read<T>(
    route: { resource: string; method: string },
    input: unknown,
  ): Promise<Result<T>>;
  newProviderId(): string;
  // 그 이름의 값이 이미 있는가.
  configured(name: string): boolean;
  // 등록된 모든 층의 MCP server와 그 소유자다.
  mcpServers(): Promise<Result<readonly RegisteredMcpServer[]>>;
};

type ProviderRow = {
  id: string;
  endpoint: string;
  definition: { key: string };
  credential: { kind?: string };
};

type Definition = {
  key: string;
  display_name: string;
  protocols: string[];
  auth_kinds: string[];
  models_endpoint: string | null;
  oauth: { product: string; inference_endpoint?: string } | null;
};

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

const originOf = (url: string) => new URL(url).origin;

export function createSecretSlots(deps: SecretSlotDeps) {
  const homeOnly = (here: Workspace | null): Result<void> =>
    here === null
      ? ok(undefined)
      : err({
          code: "forbidden",
          message:
            "A provider is connected from home only. Tell the person to ask lophn at home, or to use Settings > Providers.",
        });

  const readDefinitions = async (): Promise<Result<Definition[]>> => {
    const read = await deps.read<{ definitions: Definition[] }>(
      providerDefinitions,
      {},
    );
    return read.ok ? ok(read.value.definitions) : read;
  };

  // 같은 정의로 이미 연결된 provider다.
  const connectedWith = async (
    key: string,
  ): Promise<Result<ProviderRow | undefined>> => {
    let cursor: string | undefined;
    for (let page = 0; page < PAGE_LIMIT; page += 1) {
      const listed = await deps.read<{
        providers: ProviderRow[];
        next_cursor: string | null;
      }>(providerList, cursor === undefined ? {} : { cursor });
      if (!listed.ok) return listed;
      const found = listed.value.providers.find(
        (one) => one.definition.key === key,
      );
      if (found !== undefined || listed.value.next_cursor === null) {
        return ok(found);
      }
      cursor = listed.value.next_cursor;
    }
    return ok(undefined);
  };

  // API key로 연결하는 provider의 secret 요청이다. 이미 연결된 provider면 그 key를 바꾸고, 아니면 값이 저장된 뒤 shell main이
  // 연결까지 보낸다. 모든 workspace의 model 선택과 비용에 걸리므로 home에서만 청한다.
  const keySlot = async (
    slot: SecretSlot,
    definition: Definition,
    endpoint: string,
    protocol: string,
  ): Promise<Result<SecretContent>> => {
    const found = await connectedWith(definition.key);
    if (!found.ok) return found;
    const existing = found.value;
    if (existing !== undefined && existing.credential.kind !== "api_key") {
      return err({
        code: "conflict",
        message: `"${definition.key}" is already connected with a sign-in. The person disconnects it in Settings > Providers first.`,
      });
    }
    const id = existing?.id ?? deps.newProviderId();
    const name = `provider.${id.slice("pvd_".length)}`;
    return ok({
      kind: "secret",
      slot,
      name,
      subject: definition.display_name.slice(0, 100),
      destinations: [existing?.endpoint ?? endpoint],
      configured: deps.configured(name),
      connect:
        existing !== undefined
          ? null
          : {
              id,
              name: definition.display_name,
              definition,
              endpoint,
              protocol,
            },
    });
  };

  // 구독 계정으로 연결하는 provider의 sign_in 요청이다. 로그인이 끝나면 core가 token을 저장하고 연결까지 한다.
  const providerSignIn = async (
    slot: SecretSlot,
    definition: Definition,
    endpoint: string,
    protocol: string,
  ): Promise<Result<SignInContent>> => {
    if (definition.oauth === null) {
      return err({
        code: "invalid_input",
        message: `"${definition.key}" has no sign-in. Connect it with an API key.`,
      });
    }
    const found = await connectedWith(definition.key);
    if (!found.ok) return found;
    if (found.value !== undefined) {
      return err({
        code: "conflict",
        message: `"${definition.key}" is already connected. The person disconnects it in Settings > Providers first to sign in again.`,
      });
    }
    // ChatGPT 로그인 token은 Codex backend로 보낸다. 그 밖의 구독은 API key와 같은 주소다.
    const target =
      definition.oauth.product === "chatgpt" &&
      definition.oauth.inference_endpoint !== undefined
        ? definition.oauth.inference_endpoint
        : endpoint;
    return ok({
      kind: "sign_in",
      slot,
      target: {
        type: "provider",
        login: {
          provider: deps.newProviderId(),
          name: definition.display_name,
          definition,
          endpoint: target,
          protocol,
        },
      } as SignInContent["target"],
      subject: definition.display_name.slice(0, 100),
      destinations: [originOf(target)],
    });
  };

  // provider 자리: 내장 정의의 key다. API key와 로그인을 둘 다 가진 정의는 기본이 API key이고 sign_in을 주면 로그인이다.
  const providerSlot = async (
    here: Workspace | null,
    slot: Extract<SecretSlot, { provider: string }>,
  ): Promise<Result<SlotContent>> => {
    const home = homeOnly(here);
    if (!home.ok) return home;
    const read = await readDefinitions();
    if (!read.ok) return read;
    const definition = read.value.find((d) => d.key === slot.provider);
    if (definition === undefined) {
      return err({
        code: "not_found",
        message: `No provider definition is named "${slot.provider}". Known: ${read.value.map((d) => d.key).join(", ")}.`,
      });
    }
    const endpoint = baseOf(definition.models_endpoint);
    const protocol = definition.protocols[0];
    if (endpoint === null || protocol === undefined) {
      return err({
        code: "invalid_input",
        message: `"${slot.provider}" cannot be connected from a request.`,
      });
    }
    const keyOk = definition.auth_kinds.includes("api_key");
    if (slot.sign_in === true || !keyOk) {
      return await providerSignIn(slot, definition, endpoint, protocol);
    }
    return await keySlot(slot, definition, endpoint, protocol);
  };

  // custom provider 자리: agent가 base URL과 protocol을 넘긴다. Settings의 Custom 연결과 같은 규칙으로 검사하고 key를 받는다.
  // 인증 없는 연결은 이 컴퓨터의 주소에만 있고 값을 넣는 자리가 아니라서 요청하지 않는다.
  const customSlot = async (
    here: Workspace | null,
    slot: Extract<SecretSlot, { base_url: string }>,
  ): Promise<Result<SecretContent>> => {
    const home = homeOnly(here);
    if (!home.ok) return home;
    const base = customBaseUrl(slot.base_url);
    if (base === null) {
      return err({
        code: "invalid_input",
        message:
          "base_url must be an https address (or an http address on this computer).",
      });
    }
    if (!customNeedsKey(base)) {
      return err({
        code: "invalid_input",
        message:
          "An address on this computer connects without a key. The person connects it in Settings > Providers.",
      });
    }
    const id = slug(slot.display_name);
    if (!CUSTOM_ID_SHAPE.test(id)) {
      return err({
        code: "invalid_input",
        message: "display_name needs letters or digits.",
      });
    }
    const read = await readDefinitions();
    if (!read.ok) return read;
    if (read.value.some((d) => d.key === id)) {
      return err({
        code: "invalid_input",
        message: `"${slot.display_name}" is a built-in provider: ask with --provider ${id}, or choose another display name.`,
      });
    }
    const found = await connectedWith(id);
    if (!found.ok) return found;
    if (found.value !== undefined && found.value.endpoint !== base) {
      return err({
        code: "conflict",
        message: `A custom provider named "${id}" is already connected to another address. Choose another display name.`,
      });
    }
    return await keySlot(
      slot,
      customDefinition({
        id,
        name: slot.display_name,
        base,
        protocol: slot.protocol,
        withKey: true,
      }),
      base,
      slot.protocol,
    );
  };

  // 앱 자리: 그 앱이 `secret.use`로 선언해 허락받은 이름이다. 앱 agent는 자기 앱만, home은 어느 앱이든 청한다.
  // OAuth를 선언한 이름은 넣을 값이 없고 로그인이다.
  const appSlot = async (
    here: Workspace | null,
    slot: Extract<SecretSlot, { app: string }>,
  ): Promise<Result<SlotContent>> => {
    if (here !== null && (here.kind !== "app" || here.id !== slot.app)) {
      return err({
        code: "forbidden",
        message:
          "An app secret is requested from that app's workspace or from home.",
      });
    }
    const app = await deps.read<{ app: { name: string } }>(appGet, {
      app: slot.app,
    });
    if (!app.ok) return app;
    const scopes: {
      kind: string;
      name?: string;
      oauth?: { authorization_endpoint: string };
      host?: string;
      port?: number;
    }[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < PAGE_LIMIT; page += 1) {
      const listed = await deps.read<{
        grants: { scope: (typeof scopes)[number] }[];
        next_cursor?: string | null;
      }>(appGrantsList, {
        app: slot.app,
        status: "active",
        limit: 200,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!listed.ok) return listed;
      scopes.push(...listed.value.grants.map((grant) => grant.scope));
      if (listed.value.next_cursor == null) break;
      cursor = listed.value.next_cursor;
    }
    const declared = scopes.find(
      (scope) => scope.kind === "secret.use" && scope.name === slot.secret,
    );
    if (declared === undefined) {
      return err({
        code: "not_found",
        message: `This app has no granted secret.use named "${slot.secret}". Declare it, release the app and let the person grant it first.`,
      });
    }
    const subject = app.value.app.name.replace(/\p{Cc}/gu, "").slice(0, 100);
    if (declared.oauth !== undefined) {
      if (!deps.configured(appOAuthNames(slot.secret).client_id)) {
        return err({
          code: "conflict",
          message: `The OAuth client id of "${slot.secret}" is not set. The person sets the client id (and the client secret if the provider needs one) on the app's Access tab; then request again.`,
        });
      }
      return ok({
        kind: "sign_in",
        slot,
        target: { type: "app", app: slot.app, name: slot.secret },
        subject,
        destinations: [originOf(declared.oauth.authorization_endpoint)],
      } as SignInContent);
    }
    return ok({
      kind: "secret",
      slot,
      name: slot.secret,
      subject,
      destinations: scopes
        .flatMap((scope) =>
          scope.kind === "net.fetch" && scope.host !== undefined
            ? [`${scope.host}:${scope.port}`]
            : [],
        )
        .slice(0, 32),
      configured: deps.configured(slot.secret),
      connect: null,
    });
  };

  // MCP server 자리: 설정에 이미 있는 server가 가리키는 `mcp.` secret이나 OAuth 로그인이다. 이 session이 닿는 층만 본다:
  // home은 전역, Home 층, 자기 agent 정의 층. project·앱 session은 자기 agent 정의 층과 자기 workspace 층(다른 workspace는 닿지 않는다).
  // 같은 이름이 여러 층에 있으면 실제로 쓰이는 층(agent > workspace > 전역)이 이긴다.
  const mcpSlot = async (
    here: Workspace | null,
    agent: string,
    slot: Extract<SecretSlot, { mcp: string }>,
  ): Promise<Result<SlotContent>> => {
    const listed = await deps.mcpServers();
    if (!listed.ok) return listed;
    const rank = (entry: RegisteredMcpServer): number | null => {
      if (entry.agent !== null) return entry.agent === agent ? 2 : null;
      if (entry.workspace === null) return here === null ? 0 : null;
      if (entry.workspace.kind === "home") return here === null ? 1 : null;
      return here !== null &&
        here.kind === entry.workspace.kind &&
        here.id === entry.workspace.id
        ? 1
        : null;
    };
    const entry = listed.value
      .filter((one) => one.server.name === slot.mcp && rank(one) !== null)
      .sort((a, b) => rank(b)! - rank(a)!)[0];
    const none = () =>
      err({
        code: "not_found" as const,
        message: `No MCP server "${slot.mcp}" with a secret or a sign-in is configured where this session can reach it. The person adds it in Settings > Agents or the agent's editor.`,
      });
    if (entry === undefined || entry.server.transport !== "http") return none();
    const { http } = entry.server;
    const parts: { part: string; secret: string | null }[] = [];
    if (http.auth.kind === "bearer" || http.auth.kind === "api_key") {
      parts.push({ part: "credential", secret: http.auth.secret });
    } else if (http.auth.kind === "oauth2") {
      parts.push({ part: "sign_in", secret: null });
      if (http.auth.client_secret !== null) {
        parts.push({ part: "client", secret: http.auth.client_secret });
      }
    }
    for (const [header, value] of Object.entries(http.headers)) {
      if (value.kind === "secret") {
        parts.push({ part: `header:${header}`, secret: value.secret });
      }
    }
    if (parts.length === 0) return none();
    const choices = parts.map((one) => one.part).join(", ");
    const chosen =
      slot.part === undefined
        ? parts.length === 1
          ? parts[0]
          : undefined
        : parts.find((one) => one.part === slot.part);
    if (chosen === undefined) {
      return err({
        code: "invalid_input",
        message: `"${slot.mcp}" has ${parts.length === 1 ? "one thing to ask for" : "several things to ask for"}: pass --part with one of: ${choices}.`,
      });
    }
    const subject = entry.server.name;
    const server = originOf(http.url);
    if (chosen.secret === null) {
      if (http.auth.kind !== "oauth2") return none();
      return ok({
        kind: "sign_in",
        slot,
        target: {
          type: "mcp",
          begin: {
            name: entry.server.name,
            workspace: entry.workspace,
            agent: entry.agent,
            client_id: http.auth.client_id,
            scopes: http.auth.scopes,
          },
        },
        subject,
        destinations: [originOf(http.auth.issuer)],
      } as SignInContent);
    }
    return ok({
      kind: "secret",
      slot,
      name: chosen.secret,
      subject,
      // client secret은 server가 아니라 발급자의 token endpoint로 간다.
      destinations: [
        chosen.part === "client" && http.auth.kind === "oauth2"
          ? originOf(http.auth.issuer)
          : server,
      ],
      configured: deps.configured(chosen.secret),
      connect: null,
    });
  };

  return {
    // here가 null이면 home session이다. agent는 그 session의 agent id다.
    resolve(
      here: Workspace | null,
      agent: string,
      slot: SecretSlot,
    ): Promise<Result<SlotContent>> {
      if ("provider" in slot) return providerSlot(here, slot);
      if ("base_url" in slot) return customSlot(here, slot);
      if ("app" in slot) return appSlot(here, slot);
      return mcpSlot(here, agent, slot);
    },
  };
}
