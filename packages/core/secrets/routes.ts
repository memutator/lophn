// secrets/status·delete(memory)와 secrets/put(upload) handler.
// 값은 응답·오류·log 어디에도 넣지 않는다.
import { err, ok, type Result } from "../../base/mod.ts";
import {
  LOGIN_SECRET_PREFIX,
  secretDelete,
  type SecretFileStatus,
  secretPut,
  secretStatus,
} from "../../protocol/secrets/mod.ts";
import type { MemoryHandler, UploadHandler } from "../server/mod.ts";
import type { SecretStore } from "./secret-store.ts";

const INVALID = (message: string) =>
  err({ code: "invalid_input" as const, message });

// 터미널 입력을 허락받은 기기도 site login vault(`login.`)는 쓰거나 지우지 못한다. vault 값은 shell main이 탭에 칠 때만
// core를 나가고, 기기가 바꾼 값이면 agent가 그 값을 사이트에 친다.
function closedToDevice(principal: string, name: string): boolean {
  return (
    principal.startsWith("device:") && name.startsWith(LOGIN_SECRET_PREFIX)
  );
}

const CLOSED = () =>
  err({
    code: "forbidden" as const,
    message: "a device may not change this secret",
  });

// 사람은 설정된 이름을 모두 본다. 다른 actor의 이름 허용은 소유 concern의 grant 검사가 맡으므로(apps)
// 이 route는 그들에게 이름을 열지 않는다: 이름을 지정하면 있든 없든 같은 거절이다.
export function secretStatusHandler(store: Pick<SecretStore, "names">) {
  const handler: MemoryHandler = (ctx, rawInput) => {
    const input = secretStatus.input.safeParse(rawInput);
    if (!input.success) return INVALID("secret 이름이 올바르지 않다");
    if (ctx.actor !== "user") {
      return input.data.names === undefined || input.data.names.length === 0
        ? ok({ secrets: [] })
        : err({ code: "forbidden", message: "secret을 볼 수 없다" });
    }
    const names = store.names();
    if (!names.ok) return names;
    const configured = new Set(names.value);
    const asked = input.data.names ?? names.value;
    return ok({
      secrets: asked.map((name) => ({
        name,
        configured: configured.has(name),
      })),
    });
  };
  return handler;
}

export function secretDeleteHandler(store: Pick<SecretStore, "delete">) {
  const handler: MemoryHandler = async (ctx, rawInput) => {
    const input = secretDelete.input.safeParse(rawInput);
    if (!input.success) return INVALID("secret 이름이 올바르지 않다");
    if (closedToDevice(ctx.principal, input.data.name)) return CLOSED();
    return await store.delete(input.data.name);
  };
  return handler;
}

// upload body를 선언한 길이(bytes)만큼 읽어 UTF-8 문자열로 바꾼다. header의 길이와 다르거나, 더 많거나 적게 흐르거나,
// UTF-8이 아니면 invalid_input이다. 다 읽은 byte는 0으로 덮는다. 값은 오류에 싣지 않는다. 값을 받는 upload route
// (`secrets/put`, `providers/connect-key`, `input_request/answer_secret`)가 같이 쓴다.
export async function readSecretBody(
  declared: number,
  body: Parameters<UploadHandler>[2],
): Promise<Result<string>> {
  const wrong = INVALID("secret input does not match the body");
  if (body.length !== undefined && declared !== body.length) {
    await body.bytes.cancel().catch(() => {});
    return wrong;
  }
  const value = new Uint8Array(declared);
  let length = 0;
  try {
    const reader = body.bytes.getReader();
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (length + next.value.length > declared) {
        await reader.cancel().catch(() => {});
        return wrong;
      }
      value.set(next.value, length);
      length += next.value.length;
    }
    if (length !== declared) return wrong;
    try {
      return ok(new TextDecoder("utf-8", { fatal: true }).decode(value));
    } catch {
      return INVALID("secret input is not valid UTF-8");
    }
  } catch {
    // stream이 도중에 오류로 끝났다(길이 위반·끊김).
    return wrong;
  } finally {
    value.fill(0);
  }
}

// body를 읽어 UTF-8 문자열로 바꿔 put한다.
export function secretPutHandler(store: Pick<SecretStore, "put">) {
  const handler: UploadHandler = async (ctx, rawInput, body) => {
    const input = secretPut.input.safeParse(rawInput);
    if (!input.success) {
      await body.bytes.cancel().catch(() => {});
      return INVALID("secret input does not match the body");
    }
    if (closedToDevice(ctx.principal, input.data.name)) {
      await body.bytes.cancel().catch(() => {});
      return CLOSED();
    }
    const value = await readSecretBody(input.data.bytes, body);
    if (!value.ok) return value;
    const put: Result<SecretFileStatus> = await store.put(
      input.data.name,
      value.value,
    );
    return put;
  };
  return handler;
}
