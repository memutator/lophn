import { runPreparation } from "../../projects/file-tracking/worker/preparation.ts";

// coordinator가 넘긴 stdio로 documents/preparation child를 연다. kind와 root는 환경으로만 받는다.
const root = Deno.env.get("LOPHN_HOME");
if (Deno.env.get("LOPHN_WORKER_KIND") !== "documents/preparation" || !root) {
  throw new Error("invalid worker arguments");
}
await runPreparation(root);
