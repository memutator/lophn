import { runPlatformIo } from "./io.ts";
import {
  CONTEXTS_KIND,
  runContextsWorker,
} from "../../projects/contexts/worker/run.ts";
import { runReleaseWorker } from "../../apps/releases/worker/run.ts";
import { runnerReady, TEST_RUNNER_KIND } from "./test-runner.ts";
import { runRunnerService } from "../../problems/tests/work/runner-service.ts";
import {
  COLLECTOR_KIND,
  collectorReady,
  runCollectorWorker,
} from "../../problems/reporting/worker/collector.ts";
import { runDataWorker } from "../../apps/data/worker/run.ts";
import {
  CODING_AGENT_WORKER_KIND,
  runCodingAgentWorker,
} from "../../problems/repairs/worker/context.ts";
import {
  REVERT_WORKER_KIND,
  runRevertWorker,
} from "../../apps/revert/worker/run.ts";

const WORKER_ENTRIES: Readonly<
  Record<string, (root: string) => Promise<void>>
> = {
  "platform/io": runPlatformIo,
  [CONTEXTS_KIND]: runContextsWorker,
  "apps/release": runReleaseWorker,
  [TEST_RUNNER_KIND]: async () => {
    const ready = runnerReady(TEST_RUNNER_KIND);
    if (!ready.ok) throw new Error(ready.error.message);
    // RequestTest runner service(problems/tests)와 `problems.work` 반응기가
    // 같은 test-runner kind process의 session 하나에서 같이 돈다(stdin 하나).
    await runRunnerService();
  },
  [COLLECTOR_KIND]: () => {
    const ready = collectorReady(COLLECTOR_KIND);
    if (!ready.ok) return Promise.reject(new Error(ready.error.message));
    return runCollectorWorker();
  },
  "apps/data": runDataWorker,
  [CODING_AGENT_WORKER_KIND]: runCodingAgentWorker,
  [REVERT_WORKER_KIND]: runRevertWorker,
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
