// 메모리 누수나 멈춤이 의심될 때 지금 process의 자원을 떠 둔다. 요약은 secret이 없는 숫자뿐이고,
// heap snapshot과 CPU profile은 메모리 원문을 담을 수 있어 data root 밖으로 내보내지 않는다(0600).
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { Session } from "node:inspector/promises";
import process from "node:process";
import v8 from "node:v8";
import type { Clock } from "../../base/mod.ts";

export type RuntimeSnapshot = {
  at: string;
  pid: number;
  uptime_s: number;
  versions: { node: string; v8: string; electron?: string };
  memory: NodeJS.MemoryUsage;
  heap: v8.HeapInfo;
  heap_spaces: { name: string; used: number; size: number }[];
  resource_usage: NodeJS.ResourceUsage;
  cpu_us: NodeJS.CpuUsage;
  // 지금 event loop를 붙든 것의 종류별 개수(TCPWrap, Timeout, FSReqCallback …). 새는 handle을 찾는 첫 단서다.
  active_resources: Record<string, number>;
};

export function captureRuntimeSnapshot(clock: Clock): RuntimeSnapshot {
  const active: Record<string, number> = {};
  for (const name of process.getActiveResourcesInfo()) {
    active[name] = (active[name] ?? 0) + 1;
  }
  return {
    at: clock.now(),
    pid: process.pid,
    uptime_s: Math.round(process.uptime() * 10) / 10,
    versions: {
      node: process.versions.node,
      v8: process.versions.v8,
      ...(process.versions.electron
        ? { electron: process.versions.electron }
        : {}),
    },
    memory: process.memoryUsage(),
    heap: v8.getHeapStatistics(),
    heap_spaces: v8.getHeapSpaceStatistics().map((space) => ({
      name: space.space_name,
      used: space.space_used_size,
      size: space.space_size,
    })),
    resource_usage: process.resourceUsage(),
    cpu_us: process.cpuUsage(),
    active_resources: active,
  };
}

// 파일 이름의 시각. ':'는 일부 도구가 경로로 못 읽는다.
const stamp = (at: string) => at.replaceAll(":", "-");

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

export async function writeRuntimeSnapshot(
  dir: string,
  clock: Clock,
): Promise<string> {
  await ensureDir(dir);
  const snapshot = captureRuntimeSnapshot(clock);
  const path = `${dir}/runtime-${stamp(snapshot.at)}-${process.pid}.json`;
  await writeFile(path, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  return path;
}

// heap 전체를 쓰는 동안 process가 멈춘다(heap 크기에 비례해 수 초). 사람이 부를 때만 쓴다.
export async function writeHeapSnapshot(
  dir: string,
  clock: Clock,
): Promise<string> {
  await ensureDir(dir);
  const path = `${dir}/heap-${stamp(clock.now())}-${process.pid}.heapsnapshot`;
  v8.writeHeapSnapshot(path);
  await chmod(path, 0o600);
  return path;
}

// Chrome DevTools와 speedscope가 여는 .cpuprofile. 재는 동안 sampling profiler의 부하가 조금 있다.
export async function captureCpuProfile(
  dir: string,
  clock: Clock,
  durationMs: number,
): Promise<string> {
  await ensureDir(dir);
  const session = new Session();
  session.connect();
  try {
    await session.post("Profiler.enable");
    await session.post("Profiler.start");
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    const { profile } = await session.post("Profiler.stop");
    const path = `${dir}/cpu-${stamp(clock.now())}-${process.pid}.cpuprofile`;
    await writeFile(path, JSON.stringify(profile), { mode: 0o600 });
    return path;
  } finally {
    session.disconnect();
  }
}

const CPU_PROFILE_MS = 5_000;

// `kill -USR2 <pid>`로 요약과 5초 CPU profile을 남긴다. LOPHN_HEAP_SNAPSHOT=1이면 heap snapshot도.
// 한 번에 하나만 돈다. 돌려주는 함수가 listener를 푼다.
export function installSnapshotSignal(options: {
  dir: string;
  clock: Clock;
  heap: boolean;
  done(paths: string[]): void;
  failed(thrown: unknown): void;
  // Windows에는 SIGUSR2가 없다. 그쪽은 걸지 않는다.
  platform?: string;
}): () => void {
  if ((options.platform ?? process.platform) === "win32") return () => {};
  let running = false;
  const onSignal = () => {
    if (running) return;
    running = true;
    void (async () => {
      const paths = [await writeRuntimeSnapshot(options.dir, options.clock)];
      if (options.heap) {
        paths.push(await writeHeapSnapshot(options.dir, options.clock));
      }
      paths.push(
        await captureCpuProfile(options.dir, options.clock, CPU_PROFILE_MS),
      );
      options.done(paths);
    })()
      .catch(options.failed)
      .finally(() => {
        running = false;
      });
  };
  process.on("SIGUSR2", onSignal);
  return () => process.off("SIGUSR2", onSignal);
}
