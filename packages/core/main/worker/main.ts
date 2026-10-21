import { runPlatformIo } from "./io.ts";
import {
  KINDS_WORKER_KIND,
  runKindsWorker,
} from "../../projects/kinds/worker/run.ts";
import { runReleaseWorker } from "../../apps/releases/worker/run.ts";
import { runDataWorker } from "../../apps/data/worker/run.ts";

const WORKER_ENTRIES: Readonly<
  Record<string, (root: string) => Promise<void>>
> = {
  "platform/io": runPlatformIo,
  [KINDS_WORKER_KIND]: runKindsWorker,
  "apps/release": runReleaseWorker,
  "apps/data": runDataWorker,
};

async function runWorker(kind: string, root: string): Promise<void> {
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
