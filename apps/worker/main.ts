import { runPlatformIo } from "./platform/io.ts";
import { runCoordinator } from "./documents/coordinator.ts";
import { runPreparation } from "./documents/preparation.ts";
import { runReleaseWorker } from "./apps/release.ts";
import { runnerReady, TEST_RUNNER_KIND } from "./problems/test-runner.ts";
import { runRunnerService } from "./problems/runner-service.ts";
import {
  COLLECTOR_KIND,
  collectorReady,
  runCollectorWorker,
} from "./problems/report-collector.ts";
import { runDataWorker } from "./apps/data.ts";
import {
  runCheckerWorker,
  TICKET_CHECKER_KIND,
} from "./coding-agent/checker.ts";
import {
  CODING_AGENT_WORKER_KIND,
  runCodingAgentWorker,
} from "./coding-agent/repair-context.ts";

const WORKER_ENTRIES: Readonly<
  Record<string, (root: string) => Promise<void>>
> = {
  "platform/io": runPlatformIo,
  "documents/worker": runCoordinator,
  "documents/preparation": runPreparation,
  "apps/release": runReleaseWorker,
  [TEST_RUNNER_KIND]: async () => {
    const ready = runnerReady(TEST_RUNNER_KIND);
    if (!ready.ok) throw new Error(ready.error.message);
    // RequestTest runner service(problems/tests)와 `problems.work` 반응기(problems#T19)가
    // 같은 test-runner kind process의 session 하나에서 같이 돈다(stdin 하나).
    await runRunnerService();
  },
  [COLLECTOR_KIND]: () => {
    const ready = collectorReady(COLLECTOR_KIND);
    if (!ready.ok) return Promise.reject(new Error(ready.error.message));
    return runCollectorWorker();
  },
  "apps/data": runDataWorker,
  [TICKET_CHECKER_KIND]: runCheckerWorker,
  [CODING_AGENT_WORKER_KIND]: runCodingAgentWorker,
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
