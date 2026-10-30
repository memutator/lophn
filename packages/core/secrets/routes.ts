// secrets/status·delete(memory)와 secrets/put(upload) handler.
// 값은 응답·오류·log 어디에도 넣지 않는다.
import { err, ok, type Result } from "../../base/mod.ts";
import {
  secretDelete,
  type SecretFileStatus,
  secretPut,
  secretStatus,
} from "../../protocol/secrets/mod.ts";
import type { MemoryHandler, UploadHandler } from "../server/mod.ts";
import type { SecretStore } from "./secret-store.ts";

const INVALID = (message: string) =>
  err({ code: "invalid_input" as const, message });

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
  const handler: MemoryHandler = async (_ctx, rawInput) => {
    const input = secretDelete.input.safeParse(rawInput);
    if (!input.success) return INVALID("secret 이름이 올바르지 않다");
    return await store.delete(input.data.name);
  };
  return handler;
}

// body를 읽어 UTF-8 문자열로 바꿔 put한다. header의 bytes와 body 길이가 다르거나 상한을 넘으면 invalid_input이다.
export function secretPutHandler(store: Pick<SecretStore, "put">) {
  const handler: UploadHandler = async (_ctx, rawInput, body) => {
    const input = secretPut.input.safeParse(rawInput);
    if (
      !input.success ||
      (body.length !== undefined && input.data.bytes !== body.length)
    ) {
      await body.bytes.cancel().catch(() => {});
      return INVALID("secret input does not match the body");
    }
    const { name, bytes: declared } = input.data;
    const value = new Uint8Array(declared);
    let length = 0;
    try {
      const reader = body.bytes.getReader();
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        if (length + next.value.length > declared) {
          await reader.cancel().catch(() => {});
          return INVALID("secret input does not match the body");
        }
        value.set(next.value, length);
        length += next.value.length;
      }
      if (length !== declared) {
        return INVALID("secret input does not match the body");
      }
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(value);
      } catch {
        return INVALID("secret input is not valid UTF-8");
      }
      const put: Result<SecretFileStatus> = await store.put(name, text);
      return put;
    } catch {
      // stream이 도중에 오류로 끝났다(길이 위반·끊김).
      return INVALID("secret input does not match the body");
    }
  };
  return handler;
}
