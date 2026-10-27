import process from "node:process";
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { KindLaunchSpec } from "../../../../protocol/supervision/mod.ts";
import { APPS_SUPERVISOR_KIND } from "../../../apps/control.ts";
import { createSupervisor } from "../../../supervision/responsiveness/mod.ts";
import type { IoListener, Supervisor, WiringFactory } from "./context.ts";

export const supervisionWiring: WiringFactory = () => ({
  name: "supervision",
  prepare(ctx) {
    ctx.provide(
      "io",
      createSupervisor({
        clock: ctx.clock,
        denoCommand: Deno.execPath(),
        env: (kind) => ({
          LOPHN_WORKER_KIND: kind,
          LOPHN_HOME: ctx.root.path,
          // deno는 이 둘 없이 캐시와 실행 파일을 못 찾는다. 그 밖 환경은 복사하지 않는다.
          ...(process.env["HOME"] ? { HOME: process.env["HOME"]! } : {}),
          ...(process.env["PATH"] ? { PATH: process.env["PATH"]! } : {}),
          ...(process.env["DENO_DIR"]
            ? { DENO_DIR: process.env["DENO_DIR"]! }
            : {}),
        }),
      }),
    );
    // 앱 supervisor는 platform/io와 따로 감독한다.
    ctx.provide(
      "appsSupervision",
      createSupervisor({
        clock: ctx.clock,
        denoCommand: Deno.execPath(),
        env: () => ({
          LOPHN_WORKER_KIND: APPS_SUPERVISOR_KIND,
          LOPHN_HOME: ctx.root.path,
          // 앱 자식에게 넘길 deno 캐시·XDG·임시 폴더 위치뿐이다. 그 밖 환경은 복사하지 않는다.
          ...(process.env["HOME"] ? { HOME: process.env["HOME"]! } : {}),
          ...(process.env["PATH"] ? { PATH: process.env["PATH"]! } : {}),
          ...(process.env["DENO_DIR"]
            ? { DENO_DIR: process.env["DENO_DIR"]! }
            : {}),
          ...(process.env["XDG_CACHE_HOME"]
            ? { XDG_CACHE_HOME: process.env["XDG_CACHE_HOME"]! }
            : {}),
          ...(process.env["XDG_RUNTIME_DIR"]
            ? { XDG_RUNTIME_DIR: process.env["XDG_RUNTIME_DIR"]! }
            : {}),
          ...(process.env["TMPDIR"] ? { TMPDIR: process.env["TMPDIR"]! } : {}),
        }),
      }),
    );
  },
  // 다른 start보다 앞이다. 다른 wiring의 worker가 이 I/O worker 위에서 뜬다.
  start(ctx) {
    return startPlatformIo(
      ctx.io,
      ctx.epoch,
      ctx.server.port,
      ioListeners(ctx.ioListeners),
    );
  },
});

// 올라온 listener를 올린 순서대로 부른다.
function ioListeners(listeners: readonly IoListener[]): Required<IoListener> {
  return {
    onMessage(message) {
      for (const listener of listeners) listener.onMessage?.(message);
    },
    onFrame(frame) {
      for (const listener of listeners) listener.onFrame?.(frame);
    },
    onEnd() {
      for (const listener of listeners) listener.onEnd?.();
    },
  };
}

// platform/io는 diagnostics 입구다.
function platformIoSpec(): KindLaunchSpec {
  return {
    kind: "platform/io",
    entry: new URL("../io-entry.ts", import.meta.url).pathname,
    policy: "always",
    memory_limit_bytes: 256 * 1024 * 1024,
  };
}

function startPlatformIo(
  io: Supervisor,
  epoch: string,
  port: number,
  listener: Required<IoListener>,
): Promise<Result<void>> {
  return io
    .start(
      platformIoSpec(),
      {
        type: "hello",
        core_epoch: epoch,
        process_identity: epoch,
        kind: "platform/io",
        task: "diagnostics",
        scope: { operations: [], targets: {} },
        credential: "platform-io",
        api_port: port,
      },
      listener,
    )
    .then((started) =>
      started.ok
        ? ok(undefined)
        : err({
            code: started.code,
            message: "platform/io worker를 시작하지 못했다",
          }),
    );
}
