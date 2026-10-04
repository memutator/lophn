import { err, ok, type Result } from "../../packages/base/mod.ts";
import type { Frame } from "../../packages/contracts/platform/mod.ts";
import {
  coreToMainMessageSchema,
  mainToCoreMessageSchema,
} from "../../packages/contracts/platform/mod.ts";
import type { CredentialRegistry } from "../../packages/platform/identity/mod.ts";
import {
  createFrameWriter,
  readFrames,
} from "../../packages/platform/responsiveness/mod.ts";
import type { CoreRuntime } from "./runtime.ts";

// Electron main이 물려 준 stdin/stdout. 창 닫기는 이 pipe로 오지 않는다.
export type ParentPipe = {
  stdin: ReadableStream<Uint8Array>;
  stdout: WritableStream<Uint8Array>;
};

// user token은 여기서 한 번만 준다. 발급한 자격은 ledger에 적어 writer가 다시 검증한다.
export async function greet(
  parent: ParentPipe,
  registry: CredentialRegistry,
  runtime: CoreRuntime,
  port: number,
  epoch: string,
  issue: CredentialRegistry["issue"],
): Promise<Result<void>> {
  const issued = await issue({
    actor: "user",
    principal: "user",
    scope: {
      operations: ["platform/status", "platform/health"],
      targets: {},
    },
    conditions: { process: "electron-main" },
  });
  if (!issued.ok) return issued;
  const current = registry.revalidate({
    credential_ref: issued.value.credential_ref,
  });
  if (!current.ok) return current;
  const recorded = await runtime.record(current.value);
  if (!recorded.ok) return recorded;
  const frame = coreToMainMessageSchema.safeParse({
    user_token: issued.value.token,
    api_port: port,
    core_epoch: epoch,
  });
  if (!frame.success) {
    return err({ code: "internal", message: "hello frame을 만들지 못했다" });
  }
  // hello는 부모가 읽기 전에 나간다. 버퍼에 쌓아 두고 백프레셔로 기동을 막지 않는다.
  const buffered: Uint8Array[] = [];
  const writer = createFrameWriter({
    write: (bytes) => {
      buffered.push(bytes.slice());
      return Promise.resolve(bytes.length);
    },
  });
  try {
    await writer.writeJson(frame.data);
    void flush(parent.stdout.getWriter(), buffered);
  } catch {
    return err({
      code: "unavailable",
      message: "부모 pipe에 hello를 쓰지 못했다",
    });
  }
  return ok(undefined);
}

// 백프레셔로 기동을 막지 않게 hello 이후의 흐름만 기다린다.
async function flush(
  out: WritableStreamDefaultWriter<Uint8Array>,
  buffered: Uint8Array[],
): Promise<void> {
  try {
    for (const bytes of buffered) {
      let rest = bytes;
      while (rest.length > 0) {
        const written = await out.write(rest);
        const count = typeof written === "number" ? written : rest.length;
        rest = rest.subarray(count);
      }
    }
  } catch {
    // 부모가 이미 닫았으면 hello는 전달되지 않는다. 종료 감시가 그 뒤를 본다.
  }
}

// pipe EOF나 main의 명시 종료가 core 종료를 시작한다(install-and-update R12).
export function watchParent(
  parent: ParentPipe,
  shutdown: () => Promise<void>,
): Promise<void> {
  return (async () => {
    try {
      for await (
        const frame of readFrames({ read: streamReader(parent.stdin) })
      ) {
        if (await handleParent(frame, shutdown)) return;
      }
    } catch {
      // frame이 아닌 바이트는 protocol 위반이다. 종료로 다룬다.
    }
    await shutdown();
  })();
}

async function handleParent(
  frame: Frame,
  shutdown: () => Promise<void>,
): Promise<boolean> {
  if (frame.kind !== "json") return false;
  const message = mainToCoreMessageSchema.safeParse(frame.payload);
  if (!message.success || message.data.type !== "stop") return false;
  await shutdown();
  return true;
}

function streamReader(
  stream: ReadableStream<Uint8Array>,
): (buffer: Uint8Array) => Promise<number | null> {
  const reader = stream.getReader();
  let pending: Uint8Array | undefined;
  return async (buffer) => {
    while (!pending || pending.length === 0) {
      const next = await reader.read();
      if (next.done) return null;
      pending = next.value;
    }
    const take = Math.min(buffer.length, pending.length);
    buffer.set(pending.subarray(0, take));
    pending = pending.subarray(take);
    return take;
  };
}
