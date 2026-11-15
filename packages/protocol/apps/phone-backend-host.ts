// 폰에서 앱 backend(`phone/backend.js`)를 돌리는 host의 전역 port 설치다. 폰의 guest base와 core의 load 검사가
// 같은 함수를 써서 "backend가 이 port 위에서 handler를 등록한다"는 한 가지 계약만 둔다.
// 폰 guest(Hermes)와 Node의 빈 vm context 모두에서 돈다: zod도 Node 내장 import도 없다. SDK의 전역 symbol
// (`lophn.cap-host`, `lophn.cap-tool`)과 모양은 packages/sdk/cap-store/host.ts·cap-tool/context.ts와 맞춘다
// (protocol은 sdk를 import하지 않아 모양을 여기 다시 적는다).
import type { Migration } from "./activation/migration-sql.ts";

// packages/sdk/cap-store/db.ts의 StoreDb와 같은 모양이다.
type DbValue = null | number | bigint | string | Uint8Array;
export type PhoneStoreDb = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: DbValue[]): Record<string, unknown> | undefined;
    all(...params: DbValue[]): Record<string, unknown>[];
    run(...params: DbValue[]): {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
  };
};

export type PhoneInvocationContext = {
  app: string;
  release: string | null;
  mode: "live" | "preview" | "test";
  invocation: string | null;
  kind?: "operation" | "command" | null;
  name?: string | null;
  inputHash?: string | null;
  caller?: unknown;
};

export type PhoneBackendHostDeps = {
  // 앱이 연결 하나를 같이 쓰도록 host가 같은 DB를 준다.
  open(): PhoneStoreDb;
  migrations(): { target: number; steps: Migration[] };
  // `crypto.getRandomValues`가 채울 바이트다.
  randomBytes(bytes: Uint8Array): void;
};

export type PhoneBackendHost = {
  handlers(): string[];
  run(
    name: string,
    input: unknown,
    context: PhoneInvocationContext,
  ): Promise<unknown>;
};

type Handler = { name: string; handle: (input: unknown) => unknown };

export function installPhoneBackendHost(
  global: object,
  deps: PhoneBackendHostDeps,
): PhoneBackendHost {
  const slots = global as Record<symbol | string, unknown>;
  const registry: Handler[] = [];
  // 호출은 하나씩 돈다. 그래서 호출 문맥은 변수 하나다.
  let active: PhoneInvocationContext | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  slots[Symbol.for("lophn.cap-tool")] = {
    handlers: () => registry.slice(),
    register(handler: Handler) {
      if (registry.some((known) => known.name === handler.name)) {
        throw new Error(`handler already registered: ${handler.name}`);
      }
      registry.push(handler);
    },
    run<T>(context: PhoneInvocationContext, fn: () => Promise<T> | T) {
      const previous = active;
      active = context;
      return new Promise<T>((resolve) => resolve(fn())).finally(() => {
        active = previous;
      });
    },
    current: () => active,
  };

  slots[Symbol.for("lophn.cap-host")] = {
    mode: "live",
    dataPath: "",
    store: {
      recording: () => false,
      open: deps.open,
      migrations: deps.migrations,
    },
    post: async () => ({
      status: 503,
      body: {
        error: { code: "unavailable", message: "this needs the computer" },
      },
    }),
    call() {
      const context = active;
      if (
        context === null ||
        context.name == null ||
        context.inputHash == null
      ) {
        return null;
      }
      return {
        command: context.name,
        inputHash: context.inputHash,
        release: context.release,
        invocation: context.invocation,
      };
    },
  };

  const crypto = slots["crypto"] as { getRandomValues?: unknown } | undefined;
  if (typeof crypto?.getRandomValues !== "function") {
    slots["crypto"] = {
      getRandomValues<T extends Uint8Array>(bytes: T): T {
        deps.randomBytes(bytes);
        return bytes;
      },
    };
  }

  return {
    handlers: () => registry.map((handler) => handler.name),
    run(name, input, context) {
      const job = queue.then(() => {
        const handler = registry.find((known) => known.name === name);
        if (handler === undefined) {
          throw new Error(`handler is not registered: ${name}`);
        }
        const port = slots[Symbol.for("lophn.cap-tool")] as {
          run<T>(context: PhoneInvocationContext, fn: () => T): Promise<T>;
        };
        return port.run(context, () => handler.handle(input));
      });
      queue = job.catch(() => undefined);
      return job;
    },
  };
}
