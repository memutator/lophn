// provider를 잇는 순서의 core 쪽이다(`providers/connect-key`, `providers/connect-local`, `input_request/answer_secret`).
// 화면은 id를 만들거나 값을 옮기지 않는다: 여기서 정의 key로 연결 대상을 정하고, id를 고르고(이미 이어진 정의면 conflict),
// key는 임시 이름 `provider.<id>.new.<무작위>`에 올린 뒤 그 이름으로 ConnectProvider를 writer에 보낸다. 임시 값을
// `provider.<id>`로 옮기거나 버리는 것은 writer 앞의 withProviderLogin(login.ts)이다. ConnectProvider는 route를 부른 사람의
// context(기기면 기기 자격)로 간다. 값은 secret 저장소에만 가고 envelope·event·log·결과·오류에 없다.

import { err, ok, type Result } from "../../../base/mod.ts";
import {
  connectProvider,
  inputRequestAnswerSecret,
  type InputRequestResult,
  type InputRequestView,
  type ProviderConnectTarget,
  providerConnectKey,
  providerConnectLocal,
  type ProviderDefinition,
  type ProviderProtocol,
  type ProviderRecord,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  customBaseUrl,
  customDefinition,
  customNeedsKey,
} from "../../../protocol/lophn-agent/custom-provider.ts";
import type { SecretStorePort } from "../../../protocol/secrets/secret-file.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { MemoryHandler, UploadHandler } from "../../server/mod.ts";
import type { Writer } from "../../storage/ledger/mod.ts";
import { builtinProviderDefinition } from "./definitions.ts";
import { providerSecretName } from "./oauth-secrets.ts";

export type ConnectTarget = {
  name: string;
  definition: ProviderDefinition;
  endpoint: string;
  protocol: ProviderProtocol;
};

export type ConnectWay = "api_key" | "oauth";

// core env 이름. 값은 `{"<정의 key>": {definition, endpoint, protocol}}` JSON이고, 그 key의 연결 대상을 이것으로 바꾼다.
// e2e가 fake 발급자와 fake model server로 구독 로그인을 돌릴 때만 쓴다.
export const TEST_PROVIDER_TARGETS = "LOPHN_TEST_PROVIDER_TARGETS";

// 내장 정의의 model 목록 주소는 API base 바로 아래 한 칸이다(`<base>/models`, Cloud Code는 `<base>/v1internal:...`).
function baseOf(modelsEndpoint: string | null): string | null {
  if (modelsEndpoint === null) return null;
  const cut = modelsEndpoint.lastIndexOf("/");
  return cut > "https://".length ? modelsEndpoint.slice(0, cut) : null;
}

// 정의의 연결 주소와 protocol(첫 것). 주소를 알 수 없는 정의는 null이다. ChatGPT 로그인 token은 Codex backend로 보내고
// 그 밖의 구독은 API key와 같은 주소다.
export function providerTargetOf(
  definition: ProviderDefinition,
  way: ConnectWay,
): ConnectTarget | null {
  const base = baseOf(definition.models_endpoint);
  const protocol = definition.protocols[0];
  if (base === null || protocol === undefined) return null;
  const endpoint =
    way === "oauth" && definition.oauth?.product === "chatgpt"
      ? definition.oauth.inference_endpoint
      : base;
  return { name: definition.display_name, definition, endpoint, protocol };
}

// 내장 정의 key의 연결 대상. 모르는 key는 not_found, 주소를 알 수 없거나 그 방식이 없는 정의는 invalid_input이다.
export function builtinTarget(
  key: string,
  way: ConnectWay,
): Result<ConnectTarget> {
  const found = builtinProviderDefinition(key);
  if (!found.ok) {
    return err({
      code: "not_found",
      message: `no provider definition "${key}"`,
    });
  }
  const target = providerTargetOf(found.value, way);
  if (target === null || !found.value.auth_kinds.includes(way)) {
    return err({
      code: "invalid_input",
      message: `"${key}" cannot be connected this way`,
    });
  }
  return ok(target);
}

// upload body를 UTF-8 문자열로 읽는다. 선언한 길이와 다르거나 UTF-8이 아니면 invalid_input이다. 값은 오류에 싣지 않는다.
export async function readSecretBody(
  declared: number,
  body: Parameters<UploadHandler>[2],
): Promise<Result<string>> {
  const wrong = err({
    code: "invalid_input" as const,
    message: "secret input does not match the body",
  });
  if (body.length !== undefined && body.length !== declared) {
    await body.bytes.cancel().catch(() => {});
    return wrong;
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await new Response(body.bytes).arrayBuffer());
  } catch {
    return wrong;
  }
  if (bytes.byteLength !== declared) return wrong;
  try {
    return ok(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return err({
      code: "invalid_input",
      message: "secret input is not valid UTF-8",
    });
  } finally {
    bytes.fill(0);
  }
}

type KeyConnectDeps = {
  // 쓰기 앞 처리기를 모두 접은 writer다. 임시 이름을 옮기는 withProviderLogin이 그 안에 있다. 부를 때 읽는다.
  writer(): Writer;
  secrets: Pick<SecretStorePort, "put" | "delete">;
  newKey(): string;
  // 임시 이름의 무작위 꼬리다.
  tail(): string;
};

// key 하나로 잇는 두 걸음이다. 값을 올리는 것(stage)과 잇는 것(connectStaged)을 나눈 것은 agent 요청의 답이 값을 저장하지
// 못한 것(요청이 열린 채)과 잇지 못한 것(요청이 오류로 끝남)을 가르기 때문이다.
export function createKeyConnect(deps: KeyConnectDeps) {
  // 값을 임시 이름에 올린다. 실패하면 아무것도 남지 않는다(저장소는 파일 전체를 바꾼다).
  async function stage(id: string, value: string): Promise<Result<string>> {
    const staged = `${providerSecretName(id)}.new.${deps.tail()}`;
    const put = await deps.secrets.put(staged, value);
    return put.ok
      ? ok(staged)
      : err({ code: "unavailable", message: "the key could not be stored" });
  }

  async function send(
    who: AuthenticatedContext,
    input: Record<string, unknown>,
  ): Promise<Result<ProviderRecord>> {
    const sent = await deps.writer().command(who, {
      command: connectProvider.name,
      input,
      idempotency_key: deps.newKey(),
      compare: {},
      prepared: [],
    });
    return sent.ok
      ? ok((sent.value.result as { provider: ProviderRecord }).provider)
      : sent;
  }

  // 임시 이름으로 잇는다. 어느 갈래로 끝나도(성공, writer 오류, 던짐) 임시 이름을 지운다. 성공이면 writer 앞 처리기가 이미 옮겼다.
  async function connectStaged(
    who: AuthenticatedContext,
    target: ConnectTarget & { id: string },
    staged: string,
  ): Promise<Result<ProviderRecord>> {
    try {
      return await send(who, {
        ...target,
        auth_kind: "api_key",
        credential: { secret: staged },
      });
    } catch {
      return err({ code: "internal", message: "connecting failed" });
    } finally {
      await deps.secrets.delete(staged).catch(() => {});
    }
  }

  async function connectWithKey(
    who: AuthenticatedContext,
    target: ConnectTarget & { id: string },
    value: string,
  ): Promise<Result<ProviderRecord>> {
    const staged = await stage(target.id, value);
    if (!staged.ok) return staged;
    return await connectStaged(who, target, staged.value);
  }

  return { send, stage, connectStaged, connectWithKey };
}

export type KeyConnect = ReturnType<typeof createKeyConnect>;

// `input_request/answer_secret`: agent의 secret 요청에 사람이 넣은 값을 답한다. 값은 core가 자리에서 정한 이름에 넣고, 새로
// 잇는 provider 자리(view의 connect)면 `providers/connect-key`와 같은 두 걸음으로 잇는다. 연결이 실패하면 값을 남기지 않고
// 요청을 그 오류로 끝낸다. 값을 저장하지 못하면 오류를 돌려주고 요청은 열린 채다(사람이 다시 넣는다).
export function secretAnswerHandler(deps: {
  keys: KeyConnect;
  secrets: Pick<SecretStorePort, "put">;
  requests: {
    readRequest(session: string, toolCall: string): Result<InputRequestView>;
    finishRequest(
      session: string,
      toolCall: string,
      result: Result<InputRequestResult>,
    ): Result<void>;
  };
}): UploadHandler {
  return async (who, raw, body) => {
    const input = inputRequestAnswerSecret.input.safeParse(raw);
    if (who.actor !== "user" || !input.success) {
      await body.bytes.cancel().catch(() => {});
      return who.actor !== "user"
        ? err({ code: "forbidden", message: "only the user answers" })
        : err({ code: "invalid_input", message: "answer input is wrong" });
    }
    const value = await readSecretBody(input.data.bytes, body);
    if (!value.ok) return value;
    const { session, tool_call } = input.data;
    const open = deps.requests.readRequest(session, tool_call);
    if (!open.ok) return open;
    if (open.value.kind !== "secret") {
      return err({
        code: "invalid_input",
        message: "only a secret request takes a value",
      });
    }
    const finish = (result: Result<InputRequestResult>) => {
      deps.requests.finishRequest(session, tool_call, result);
      return ok({});
    };
    const connect = open.value.connect as
      | (ConnectTarget & { id: string })
      | null;
    if (connect === null) {
      const put = await deps.secrets.put(open.value.name, value.value);
      return put.ok
        ? finish(ok({ stored: true }))
        : err({ code: "unavailable", message: "the value was not stored" });
    }
    const staged = await deps.keys.stage(connect.id, value.value);
    if (!staged.ok) return staged;
    const connected = await deps.keys.connectStaged(who, connect, staged.value);
    return finish(
      connected.ok
        ? ok({ stored: true })
        : err({
            code: connected.error.code,
            message:
              "The key was entered but connecting the provider failed, so the key was not kept.",
          }),
    );
  };
}

export type ProviderConnectDeps = KeyConnectDeps & {
  // 부른 사람의 자격으로 읽은 provider 전부.
  listProviders(
    who: AuthenticatedContext,
  ): Promise<Result<readonly { id: string; definition: { key: string } }[]>>;
  // 정의 key의 연결 대상. 보통 builtinTarget이다.
  target(key: string, way: ConnectWay): Result<ConnectTarget>;
  newId(): string;
};

export function createProviderConnect(deps: ProviderConnectDeps) {
  const { send, connectWithKey } = createKeyConnect(deps);
  // 정의 key → provider id. 끊은 provider를 다시 이으면 같은 id로 이어, 그 provider를 고른 agent가 다시 쓴다. core가
  // 사는 동안 본 연결과 만든 id를 쥔다.
  const ids = new Map<string, string>();

  // 이을 id. 그 정의가 이미 이어져 있으면 conflict다(연결된 provider의 값 자리를 덮지 않는다). id를 주면(agent 요청이
  // 정한 id) 그것을 쓴다.
  async function freshId(
    who: AuthenticatedContext,
    key: string,
    given?: string,
  ): Promise<Result<string>> {
    const listed = await deps.listProviders(who);
    if (!listed.ok) return listed;
    for (const row of listed.value) ids.set(row.definition.key, row.id);
    if (listed.value.some((row) => row.definition.key === key)) {
      return err({
        code: "conflict",
        message: `"${key}" is already connected`,
      });
    }
    const id = given ?? ids.get(key) ?? deps.newId();
    ids.set(key, id);
    return ok(id);
  }

  // 연결 대상: 내장 정의는 key로, Custom은 그 주소 규칙(https이거나 이 기계의 http)으로 정한다.
  function targetOf(
    target: ProviderConnectTarget,
    withKey: boolean,
  ): Result<ConnectTarget> {
    if ("definition" in target)
      return deps.target(target.definition, "api_key");
    const base = customBaseUrl(target.custom.base_url);
    if (base === null || (!withKey && customNeedsKey(base))) {
      return err({
        code: "invalid_input",
        message: withKey
          ? "base_url must be an https address or an http address on this computer"
          : "only an http address on this computer connects without a key",
      });
    }
    return ok({
      name: target.custom.name,
      definition: customDefinition({
        id: target.custom.key,
        name: target.custom.name,
        base,
        protocol: target.custom.protocol,
        withKey,
      }),
      endpoint: base,
      protocol: target.custom.protocol,
    });
  }

  const connectKey: UploadHandler = async (who, raw, body) => {
    const input = providerConnectKey.input.safeParse(raw);
    if (!input.success) {
      await body.bytes.cancel().catch(() => {});
      return err({ code: "invalid_input", message: "connect input is wrong" });
    }
    const value = await readSecretBody(input.data.bytes, body);
    if (!value.ok) return value;
    const target = targetOf(input.data.target, true);
    if (!target.ok) return target;
    const id = await freshId(who, target.value.definition.key);
    if (!id.ok) return id;
    const record = await connectWithKey(
      who,
      { ...target.value, id: id.value },
      value.value,
    );
    return record.ok ? ok({ provider: record.value }) : record;
  };

  const connectLocal: MemoryHandler = async (who, raw) => {
    const input = providerConnectLocal.input.safeParse(raw);
    if (!input.success) {
      return err({ code: "invalid_input", message: "connect input is wrong" });
    }
    const target = targetOf(input.data, false);
    if (!target.ok) return target;
    const id = await freshId(who, target.value.definition.key);
    if (!id.ok) return id;
    const record = await send(who, {
      ...target.value,
      id: id.value,
      auth_kind: "none",
      credential: null,
    });
    return record.ok ? ok({ provider: record.value }) : record;
  };

  return { freshId, handlers: { connectKey, connectLocal } };
}

export type ProviderConnect = ReturnType<typeof createProviderConnect>;
