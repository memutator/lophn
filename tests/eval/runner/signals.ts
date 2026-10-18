import type { Pool } from "../experiment/parallel/mod.ts";

// 첫 신호는 새 trial을 띄우지 않고 도는 trial을 기다린다. 둘째 신호는 기다리지 않고 core와 Claude Code를 끄고 끝낸다.
// Claude Code가 남으면 사람의 로그인으로 계속 돈다.
export function installSignals(
  pool: Pool,
  live: Set<{ stop(): Promise<unknown> }>,
  log: (line: string) => void,
): () => void {
  let signals = 0;
  const handler = () => {
    signals++;
    if (signals === 1) {
      pool.stop();
      log("새 trial을 띄우지 않는다. 도는 trial을 기다린다");
      return;
    }
    for (const trial of live) trial.stop().catch(() => {});
    Deno.exit(130);
  };
  Deno.addSignalListener("SIGINT", handler);
  Deno.addSignalListener("SIGTERM", handler);
  return () => {
    Deno.removeSignalListener("SIGINT", handler);
    Deno.removeSignalListener("SIGTERM", handler);
  };
}
