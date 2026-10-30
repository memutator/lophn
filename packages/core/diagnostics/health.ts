import { monitorEventLoopDelay } from "node:perf_hooks";
import process from "node:process";
import type { Clock } from "../../base/mod.ts";
import { runComponentChecks } from "./components.ts";
import type { ComponentCheck } from "./ports.ts";

// `/healthz`(살아 있나)와 `/readyz`(일을 받나)의 몸체. API 입구가 Bearer를 본 뒤에 부른다.
export type Health = {
  live(): unknown;
  ready(): Promise<{ status: number; body: unknown }>;
  close(): void;
};

type ReaderHealth = "healthy" | "unhealthy" | "closed";

const MB = 1024 * 1024;
// core가 없으면 아무것도 못 하고, ledger가 없으면 읽기·쓰기가 다 실패한다. 나머지는 일부 기능만 빠진다.
const REQUIRED = new Set(["core", "ledger"]);

function memory() {
  const usage = process.memoryUsage();
  const round = (bytes: number) => Math.round((bytes / MB) * 10) / 10;
  return {
    rss_mb: round(usage.rss),
    heap_used_mb: round(usage.heapUsed),
    heap_total_mb: round(usage.heapTotal),
    external_mb: round(usage.external),
    array_buffers_mb: round(usage.arrayBuffers),
  };
}

export function createHealth(options: {
  service: string;
  clock: Clock;
  ready(): boolean;
  checks(): readonly ComponentCheck[];
  readers(): readonly ReaderHealth[];
}): Health {
  const LOOP_RESOLUTION_MS = 10;
  const startedMs = options.clock.nowMs();
  // 지연 분포는 마지막 읽기 뒤로만 본다. 오래전의 멈춤이 지금 상태를 덮지 않게 읽을 때마다 비운다.
  // histogram은 timer 간격(resolution)까지 센다. 그 몫을 빼야 쉬는 loop가 0 가까이 나온다.
  const loop = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
  loop.enable();
  const uptime = () =>
    Math.round((options.clock.nowMs() - startedMs) / 100) / 10;
  const eventLoop = () => {
    const ms = (ns: number) =>
      Math.max(0, Math.round((ns / 1e6 - LOOP_RESOLUTION_MS) * 10) / 10);
    const out = {
      p50_ms: ms(loop.percentile(50)),
      p99_ms: ms(loop.percentile(99)),
      max_ms: ms(loop.max),
    };
    loop.reset();
    return out;
  };
  return {
    live: () => ({
      status: "ok",
      service: options.service,
      uptime_s: uptime(),
      pid: process.pid,
      memory: memory(),
    }),
    async ready() {
      // 점검마다 걸린 시간을 따로 잰다. 한 점검이 느리면 그 칸만 커진다.
      const components = await Promise.all(
        options.checks().map(async (check) => {
          const started = performance.now();
          const [status] = await runComponentChecks([check], options.clock);
          return {
            ...status,
            latency_ms: Math.round((performance.now() - started) * 10) / 10,
          };
        }),
      );
      const readers = { healthy: 0, unhealthy: 0, closed: 0 };
      for (const state of options.readers()) readers[state] += 1;
      const down = components.filter((item) => !item.available);
      const blocking =
        !options.ready() ||
        readers.healthy === 0 ||
        down.some((item) => REQUIRED.has(item.component));
      const status = blocking
        ? "not_ready"
        : down.length > 0
          ? "degraded"
          : "ready";
      return {
        status: status === "not_ready" ? 503 : 200,
        body: {
          status,
          ...(status === "degraded"
            ? { degraded: down.map((item) => item.component) }
            : {}),
          checked_at: options.clock.now(),
          uptime_s: uptime(),
          components,
          ledger: { readers },
          event_loop: eventLoop(),
          memory: memory(),
        },
      };
    },
    close: () => loop.disable(),
  };
}
