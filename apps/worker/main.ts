import { runPlatformIo } from "./platform/io.ts";
import { runCoordinator } from "./documents/coordinator.ts";
import { runPreparation } from "./documents/preparation.ts";
import { runReleaseWorker } from "./apps/release.ts";
import { runnerReady, TEST_RUNNER_KIND } from "./problems/test-runner.ts";
import {
  COLLECTOR_KIND,
  collectorReady,
  runCollectorWorker,
} from "./problems/report-collector.ts";
import { runDataWorker } from "./apps/data.ts";

const WORKER_ENTRIES: Readonly<
  Record<string, (root: string) => Promise<void>>
> = {
  "platform/io": runPlatformIo,
  "documents/worker": runCoordinator,
  "documents/preparation": runPreparation,
  "apps/release": runReleaseWorker,
  [TEST_RUNNER_KIND]: () => {
    const ready = runnerReady(TEST_RUNNER_KIND);
    if (!ready.ok) return Promise.reject(new Error(ready.error.message));
    return Promise.resolve();
  },
  [COLLECTOR_KIND]: () => {
    const ready = collectorReady(COLLECTOR_KIND);
    if (!ready.ok) return Promise.reject(new Error(ready.error.message));
    return runCollectorWorker();
  },
  "apps/data": runDataWorker,
};

export async function runWorker(kind: string, root: string): Promise<void> {
  const entry = Object.hasOwn(WORKER_ENTRIES, kind)
    ? WORKER_ENTRIES[kind]
    : undefined;
  if (!entry) throw new Error("unknown worker kind");
  await entry(root);
}

if (import.meta.main) {
  const [kind, root, ...extra] = Deno.args;
  if (!kind || !root || extra.length) {
    throw new Error("invalid worker arguments");
  }
  await runWorker(kind, root);
}
