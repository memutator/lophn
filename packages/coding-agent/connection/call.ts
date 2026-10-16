// route 하나를 부르는 공통 흐름이다. command는 envelope(key, compare)로, 나머지는 입력 그대로 보낸다.
// 표 밖 route는 부르지 않는다: 호출자가 `CODING_CLI_COMMANDS`의 route만 넘긴다.
import {
  err,
  type LophnError,
  ok,
  type Result,
  sha256Hex,
} from "../../base/mod.ts";
import type { Route, UploadRoute } from "../../protocol/base/mod.ts";
import type { CoreClient } from "./client/core.ts";

export type RouteCall = {
  route: Route;
  input: Record<string, unknown>;
  // 없으면 새로 만든다. 같은 key로 다시 부르면 같은 효과다.
  idempotencyKey?: string;
  // route의 compare 칸 값이다. 없으면 입력에서 compare 칸 이름으로 고른다.
  compare?: Record<string, unknown>;
  prepared?: readonly string[];
};

function compareOf(call: RouteCall): Record<string, unknown> {
  if (call.compare !== undefined) return call.compare;
  const shape = (call.route.compare as { shape?: Record<string, unknown> })
    ?.shape;
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(shape ?? {})) {
    if (call.input[key] !== undefined) picked[key] = call.input[key];
  }
  return picked;
}

export function callRoute(
  client: CoreClient,
  call: RouteCall,
): Promise<Result<unknown, LophnError>> {
  if (call.route.kind === "command") {
    return client.command(call.route, {
      input: call.input,
      idempotency_key: call.idempotencyKey ?? crypto.randomUUID(),
      compare: compareOf(call),
      ...(call.prepared === undefined ? {} : { prepared: call.prepared }),
    });
  }
  return client.read(call.route, call.input);
}

// 본문을 올려 준비된 blob 참조를 받는다. hash는 올린 바이트에서 낸다.
export async function uploadText(
  client: CoreClient,
  route: UploadRoute,
  text: string,
): Promise<Result<{ hash: string; blob: unknown }, LophnError>> {
  const bytes = new TextEncoder().encode(text);
  const hash = await sha256Hex(bytes);
  const uploaded = await client.upload(
    route,
    { blob_hash: hash, bytes: bytes.length },
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  );
  if (!uploaded.ok) return uploaded;
  const blob = uploaded.value as { hash?: string };
  if (blob.hash !== hash) {
    return err({
      code: "internal",
      message: "준비된 blob이 올린 바이트와 맞지 않는다",
    });
  }
  return ok({ hash, blob: uploaded.value });
}
