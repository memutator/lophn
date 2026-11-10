// secret 자리의 해석이다. agent는 secret 이름이 아니라 자리를 넘기고, 여기서 이름·대상·목적지를 정의와 선언에서 읽는다.
// 어느 workspace의 session이 어느 자리를 청할 수 있는지도 여기서 가른다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { appGet } from "../../../../protocol/apps/apps.ts";
import { appGrantsList } from "../../../../protocol/apps/grants.ts";
import type { SecretSlot } from "../../../../protocol/lophn-agent/input-request.ts";
import {
  providerDefinitions,
  providerList,
} from "../../../../protocol/lophn-agent/providers.ts";
import type { Workspace } from "../../../../protocol/lophn-agent/workspaces.ts";
import type { RequestContent } from "../../../lophn-agent/tools/questions/wait.ts";

type SecretContent = Extract<RequestContent, { kind: "secret" }>;

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
};

export function createSecretSlots(deps: SecretSlotDeps) {
  // provider 자리: 내장 정의의 API key다. 이미 연결된 provider면 그 key를 바꾸고, 아니면 값이 저장된 뒤 shell main이
  // 연결까지 보낸다. 모든 workspace의 model 선택과 비용에 걸리므로 home에서만 청한다.
  const providerSlot = async (
    here: Workspace | null,
    key: string,
  ): Promise<Result<SecretContent>> => {
    if (here !== null) {
      return err({
        code: "forbidden",
        message:
          "A provider is connected from home only. Tell the person to ask lophn at home, or to use Settings > Providers.",
      });
    }
    const read = await deps.read<{
      definitions: {
        key: string;
        display_name: string;
        protocols: string[];
        auth_kinds: string[];
        models_endpoint: string | null;
      }[];
    }>(providerDefinitions, {});
    if (!read.ok) return read;
    const definition = read.value.definitions.find((d) => d.key === key);
    if (definition === undefined) {
      return err({
        code: "not_found",
        message: `No provider definition is named "${key}". Known: ${read.value.definitions.map((d) => d.key).join(", ")}.`,
      });
    }
    const endpoint = baseOf(definition.models_endpoint);
    const protocol = definition.protocols[0];
    if (
      !definition.auth_kinds.includes("api_key") ||
      endpoint === null ||
      protocol === undefined
    ) {
      return err({
        code: "invalid_input",
        message: `"${key}" does not connect with an API key. The person signs in from Settings > Providers.`,
      });
    }
    let existing: { id: string; endpoint: string } | undefined;
    let cursor: string | undefined;
    for (let page = 0; page < PAGE_LIMIT; page += 1) {
      const listed = await deps.read<{
        providers: {
          id: string;
          endpoint: string;
          definition: { key: string };
          credential: { auth_kind?: string };
        }[];
        next_cursor: string | null;
      }>(providerList, cursor === undefined ? {} : { cursor });
      if (!listed.ok) return listed;
      existing = listed.value.providers.find(
        (one) => one.definition.key === key,
      );
      if (existing !== undefined || listed.value.next_cursor === null) break;
      cursor = listed.value.next_cursor;
    }
    const id = existing?.id ?? deps.newProviderId();
    const name = `provider.${id.slice("pvd_".length)}`;
    return ok({
      kind: "secret",
      slot: { provider: key },
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

  // 앱 자리: 그 앱이 `secret.use`로 선언해 허락받은 이름이다. 앱 agent는 자기 앱만, home은 어느 앱이든 청한다.
  const appSlot = async (
    here: Workspace | null,
    slot: Extract<SecretSlot, { app: string }>,
  ): Promise<Result<SecretContent>> => {
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
      oauth?: unknown;
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
    if (declared.oauth !== undefined) {
      return err({
        code: "invalid_input",
        message: `"${slot.secret}" is an OAuth secret: the person signs in on the app's Access tab; there is no value to enter.`,
      });
    }
    return ok({
      kind: "secret",
      slot,
      name: slot.secret,
      subject: app.value.app.name.replace(/\p{Cc}/gu, "").slice(0, 100),
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

  return {
    // here가 null이면 home session이다.
    resolve(
      here: Workspace | null,
      slot: SecretSlot,
    ): Promise<Result<SecretContent>> {
      return "provider" in slot
        ? providerSlot(here, slot.provider)
        : appSlot(here, slot);
    },
  };
}
