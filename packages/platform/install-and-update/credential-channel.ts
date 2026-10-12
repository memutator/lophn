// Linux의 `ProtectedChannel` 구현이다(platform/identity#R15, → redesign/propagate#Q2).
// core가 데이터 root의 `run/`(0700) 안에 소유자 전용(0600) unix socket을 열고, helper
// `lophn-credential`이 이어 준 연결 하나가 지정 child 하나의 non-inheritable 통로다. 연결은 요청 하나를
// 받고 응답 하나를 쓴 뒤 닫는다. 응답에 token을 쓰는 것은 `authority.deliver`가 active connection·
// 현재 scope·등록된 child(process generation·loader identity)·keychain 값의 digest를 모두 확인한 뒤
// 부르는 `send` 하나뿐이다. 확인에 실패한 이유는 계약의 네 이유 하나로만 알린다.
import { err, ok, type Result } from "../../base/mod.ts";
import {
  CREDENTIAL_DELIVERY_FAILURES,
  type CredentialDeliveryFailure,
} from "../../protocol/coding-agent/mod.ts";
import type {
  CodingCredentialAuthority,
  ProtectedChannel,
} from "../identity/mod.ts";
import {
  CREDENTIAL_HELPER_TIMEOUT_MS,
  CREDENTIAL_MESSAGE_LIMIT,
  credentialSocketPath,
} from "./credential-helper.ts";

export { credentialSocketPath };

export type CredentialSocket = {
  readonly path: string;
  close(): Promise<void>;
};

// 연결 하나의 보호 통로. 지정 child에만 쓰는 이 연결이 곧 통로라서 child 식별은 `deliver`가 이미
// 확인했다. 쓰기가 한 번 끝나면 닫는다.
export function unixProtectedChannel(conn: {
  write(bytes: Uint8Array): Promise<number>;
}): ProtectedChannel {
  return {
    async send(_child, token) {
      const body = new TextEncoder().encode(
        JSON.stringify({ token: new TextDecoder().decode(token) }),
      );
      try {
        let offset = 0;
        while (offset < body.byteLength) {
          offset += await conn.write(body.subarray(offset));
        }
        body.fill(0);
        return ok(undefined);
      } catch {
        body.fill(0);
        return err({
          code: "unavailable",
          message: "보호 통로에 쓰지 못했다",
        });
      }
    },
  };
}

export async function serveCredentialSocket(options: {
  dataRoot: string;
  authority: Pick<CodingCredentialAuthority, "deliver">;
  timeoutMs?: number;
}): Promise<Result<CredentialSocket>> {
  const path = credentialSocketPath(options.dataRoot);
  try {
    // 이전 실행이 남긴 socket만 지운다. 다른 종류의 파일은 건드리지 않는다.
    const stat = await Deno.lstat(path).catch(() => undefined);
    if (stat !== undefined) {
      if (!stat.isSocket) {
        return err({
          code: "unavailable",
          message: "credential socket 자리에 다른 파일이 있다",
        });
      }
      await Deno.remove(path);
    }
    const listener = Deno.listen({ transport: "unix", path });
    await Deno.chmod(path, 0o600);
    const handling = new Set<Promise<void>>();
    const accepting = (async () => {
      try {
        for await (const conn of listener) {
          const task = serveOne(conn, options).finally(() =>
            handling.delete(task)
          );
          handling.add(task);
        }
      } catch { /* listener가 닫혔다 */ }
    })();
    return ok({
      path,
      async close() {
        try {
          listener.close();
        } catch { /* 이미 닫혔다 */ }
        await accepting;
        await Promise.allSettled([...handling]);
        await Deno.remove(path).catch(() => undefined);
      },
    });
  } catch {
    return err({
      code: "unavailable",
      message: "credential socket을 열 수 없다",
    });
  }
}

async function serveOne(
  conn: Deno.UnixConn,
  options: {
    authority: Pick<CodingCredentialAuthority, "deliver">;
    timeoutMs?: number;
  },
): Promise<void> {
  const fail = async (reason: CredentialDeliveryFailure) => {
    await writeAll(
      conn,
      new TextEncoder().encode(JSON.stringify({ reason })),
    ).catch(() => undefined);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(
        () => resolve("timeout"),
        options.timeoutMs ?? CREDENTIAL_HELPER_TIMEOUT_MS,
      );
    });
    const read = readRequest(conn);
    const first = await Promise.race([read, timeout]);
    if (first === "timeout") {
      await fail("timeout");
      return;
    }
    let request: unknown;
    try {
      request = JSON.parse(new TextDecoder().decode(first));
    } catch {
      await fail("not_found");
      return;
    }
    const delivered = await Promise.race([
      options.authority.deliver(request, unixProtectedChannel(conn)),
      timeout,
    ]);
    if (delivered === "timeout") {
      await fail("timeout");
    } else if (!delivered.ok) {
      await fail(failureOf(delivered.error));
    }
  } catch {
    await fail("not_found");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    try {
      conn.close();
    } catch { /* 이미 닫혔다 */ }
  }
}

function failureOf(reason: unknown): CredentialDeliveryFailure {
  return (CREDENTIAL_DELIVERY_FAILURES as readonly unknown[]).includes(reason)
    ? reason as CredentialDeliveryFailure
    : "not_found";
}

// 요청은 helper가 쓰기 쪽을 닫을 때까지 읽는다. `conn.readable`을 EOF까지 돌리면 연결이 닫혀
// 응답을 쓸 수 없으므로 `read`로 읽는다.
async function readRequest(conn: Deno.UnixConn): Promise<Uint8Array> {
  const bytes = new Uint8Array(CREDENTIAL_MESSAGE_LIMIT + 1);
  let size = 0;
  while (true) {
    const read = await conn.read(bytes.subarray(size));
    if (read === null) return bytes.slice(0, size);
    size += read;
    if (size > CREDENTIAL_MESSAGE_LIMIT) throw new Error("too large");
  }
}

async function writeAll(
  conn: Deno.UnixConn,
  bytes: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    offset += await conn.write(bytes.subarray(offset));
  }
}
