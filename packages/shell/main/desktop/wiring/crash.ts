// main의 처리 못한 예외를 core log에 한 줄 남기고 종료한다. shell은 core를 import하지 못해
// `installCrashHandler`를 쓰지 않고 자기 handler를 둔다. core가 component·location을 다시 정한다.
import { app } from "electron";

import type { Registered, ShellContext } from "./context.ts";

// pipe 쓰기가 나갈 시간이다.
const FLUSH_MS = 200;

export function register(ctx: ShellContext): Registered {
  let crashing = false;
  const crash = (cause: unknown) => {
    // 기록하는 중에 또 죽으면 기다리지 않는다.
    if (crashing) return app.exit(1);
    crashing = true;
    console.error(
      `uncaught: ${
        cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)
      }`,
    );
    // 연결 전이거나 종료됐으면 false이고 stderr만 남는다.
    ctx.core.diagnostic({
      type: "diagnostic",
      kind: "lophn_internal",
      payload: {
        component: "platform/shell-main",
        observed_at: new Date().toISOString(),
        error_class: "internal_exception",
        location: "shell-main-crash",
        count: 1,
      },
    });
    setTimeout(() => app.exit(1), FLUSH_MS);
  };
  process.on("uncaughtException", crash);
  process.on("unhandledRejection", crash);
  return {
    stop() {
      process.off("uncaughtException", crash);
      process.off("unhandledRejection", crash);
    },
  };
}
