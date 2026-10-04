import { runPlatformIo } from "./platform/io.ts";
import { runCoordinator } from "./documents/coordinator.ts";
import { runPreparation } from "./documents/preparation.ts";
import { runReleaseWorker } from "./apps/release.ts";

const WORKER_ENTRIES: Readonly<
  Record<string, (root: string) => Promise<void>>
> = {
  "platform/io": runPlatformIo,
  "documents/worker": runCoordinator,
  "documents/preparation": runPreparation,
  "apps/release": runReleaseWorker,
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
