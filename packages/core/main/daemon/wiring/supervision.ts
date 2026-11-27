import { join } from "node:path";
import process from "node:process";
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { KindLaunchSpec } from "../../../../protocol/supervision/mod.ts";
import { APPS_SUPERVISOR_KIND } from "../../../apps/control.ts";
import { npmConfigEnvironment } from "../../../apps/releases/prepare/environment.ts";
import { platformEntry } from "../../../install-and-update/mod.ts";
import { createSupervisor } from "../../../supervision/responsiveness/mod.ts";
import { windowsEnvironment } from "../../../supervision/security/child-env.ts";
import type { IoListener, Supervisor, WiringFactory } from "./context.ts";

export const supervisionWiring: WiringFactory = () => ({
  name: "supervision",
  prepare(ctx) {
    // 신뢰 자식(platform/io, agent-runtime, app-supervisor)도 core와 같은 V8 compile cache를 써서 기동 파싱 비용을 줄인다.
    const compileCache =
      process.env["NODE_COMPILE_CACHE"] ||
      join(ctx.root.path, "cache", "v8-compile");
    ctx.provide(
      "io",
      createSupervisor({
        clock: ctx.clock,
        env: (kind) => ({
          LOPHN_WORKER_KIND: kind,
          LOPHN_HOME: ctx.root.path,
          NODE_COMPILE_CACHE: compileCache,
          // child가 자기 설정과 도구(git 등)를 찾는 데 필요한 둘과 telemetry 설정만 준다. 그 밖 환경은 복사하지 않는다.
          ...(process.env["HOME"] ? { HOME: process.env["HOME"]! } : {}),
          ...(process.env["PATH"] ? { PATH: process.env["PATH"]! } : {}),
          ...windowsEnvironment(),
          ...telemetryEnvironment(),
        }),
      }),
    );
    // 앱 supervisor는 platform/io와 따로 감독한다.
    ctx.provide(
      "appsSupervision",
      createSupervisor({
        clock: ctx.clock,
        env: () => ({
          LOPHN_WORKER_KIND: APPS_SUPERVISOR_KIND,
          LOPHN_HOME: ctx.root.path,
          NODE_COMPILE_CACHE: compileCache,
          // 앱 자식에게 넘길 HOME·PATH·XDG·임시 폴더 위치뿐이다. 그 밖 환경은 복사하지 않는다.
          ...(process.env["HOME"] ? { HOME: process.env["HOME"]! } : {}),
          ...(process.env["PATH"] ? { PATH: process.env["PATH"]! } : {}),
          ...(process.env["XDG_CACHE_HOME"]
            ? { XDG_CACHE_HOME: process.env["XDG_CACHE_HOME"]! }
            : {}),
          ...(process.env["XDG_RUNTIME_DIR"]
            ? { XDG_RUNTIME_DIR: process.env["XDG_RUNTIME_DIR"]! }
            : {}),
          ...(process.env["TMPDIR"] ? { TMPDIR: process.env["TMPDIR"]! } : {}),
          ...windowsEnvironment(),
          // release 준비의 npm이 같은 cache·offline 설정을 쓴다.
          ...npmConfigEnvironment(),
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

// child도 core와 같은 수집기로 span을 보낸다. secret이 아닌 설정 값만이다.
const TELEMETRY_ENV = [
  "LOPHN_TELEMETRY",
  "LOPHN_LOG_LEVEL",
  "LOPHN_LOG_FORMAT",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
] as const;

function telemetryEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of TELEMETRY_ENV) {
    const value = process.env[key];
    if (value !== undefined && value !== "") env[key] = value;
  }
  return env;
}

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
    entry: platformEntry(import.meta.url, "io"),
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
