import { runCoordinator } from "../../projects/file-tracking/worker/coordinator.ts";

// supervisor가 넘긴 stdio로 documents/worker child를 연다. kind와 root는 환경으로만 받는다.
const root = Deno.env.get("LOPHN_HOME");
if (Deno.env.get("LOPHN_WORKER_KIND") !== "documents/worker" || !root) {
  throw new Error("invalid worker arguments");
}
await runCoordinator(root);
