import { err, ok, type Result } from "../../../../base/mod.ts";
import type { KindLaunchSpec } from "../../../../protocol/supervision/mod.ts";
import { APPS_SUPERVISOR_KIND } from "../../../apps/control.ts";
import { createSupervisor } from "../../../supervision/responsiveness/mod.ts";
import { denoDir, repoRoot } from "../paths.ts";
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
          ...(Deno.env.get("HOME") ? { HOME: Deno.env.get("HOME")! } : {}),
          ...(Deno.env.get("PATH") ? { PATH: Deno.env.get("PATH")! } : {}),
          ...(Deno.env.get("DENO_DIR")
            ? { DENO_DIR: Deno.env.get("DENO_DIR")! }
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
          ...(Deno.env.get("HOME") ? { HOME: Deno.env.get("HOME")! } : {}),
          ...(Deno.env.get("PATH") ? { PATH: Deno.env.get("PATH")! } : {}),
          ...(Deno.env.get("DENO_DIR")
            ? { DENO_DIR: Deno.env.get("DENO_DIR")! }
            : {}),
          ...(Deno.env.get("XDG_CACHE_HOME")
            ? { XDG_CACHE_HOME: Deno.env.get("XDG_CACHE_HOME")! }
            : {}),
          ...(Deno.env.get("XDG_RUNTIME_DIR")
            ? { XDG_RUNTIME_DIR: Deno.env.get("XDG_RUNTIME_DIR")! }
            : {}),
          ...(optionalEnv("TMPDIR") ? { TMPDIR: optionalEnv("TMPDIR")! } : {}),
        }),
      }),
    );
  },
  // 다른 start보다 앞이다. 다른 wiring의 worker가 이 I/O worker 위에서 뜬다.
  start(ctx) {
    return startPlatformIo(
      ctx.io,
      ctx.root.path,
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

// packaged allow-env에 없는 이름은 없는 값이다. NotCapable로 기동을 끝내지 않는다.
function optionalEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

// platform/io는 diagnostics 입구다. 데이터 root만 읽고 네트워크와 실행은 열지 않는다.
// sys의 statfs는 blob 준비 전의 실제 디스크 여유 관측에만 쓴다. node:fs statfs는
// Deno에서 sys 권한을 요구하고 가장 좁은 값은 --allow-sys=statfs다(실측).
function platformIoSpec(dataRoot: string): KindLaunchSpec {
  return {
    kind: "platform/io",
    entry: new URL("../io-entry.ts", import.meta.url).pathname,
    // 데이터 root 밖은 코드와 deno 캐시만 읽는다. 쓰기는 데이터 root뿐이다.
    allow_read: [dataRoot, repoRoot(), denoDir()],
    allow_write: [dataRoot],
    allow_net: [],
    allow_run: [],
    allow_sys: ["statfs"],
    allow_env: ["LOPHN_HOME", "LOPHN_WORKER_KIND", "HOME", "PATH"],
    policy: "always",
    memory_limit_bytes: 256 * 1024 * 1024,
  };
}

function startPlatformIo(
  io: Supervisor,
  dataRoot: string,
  epoch: string,
  port: number,
  listener: Required<IoListener>,
): Promise<Result<void>> {
  return io.start(
    platformIoSpec(dataRoot),
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
  ).then((started) =>
    started.ok ? ok(undefined) : err({
      code: started.code,
      message: "platform/io worker를 시작하지 못했다",
    })
  );
}
