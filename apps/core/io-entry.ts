import { runPlatformIo } from "../worker/platform/io.ts";

// supervisor가 넘긴 stdio로 platform/io child를 연다. kind와 root는 환경으로만 받는다.
const root = Deno.env.get("LOPHN_HOME");
if (Deno.env.get("LOPHN_WORKER_KIND") !== "platform/io" || !root) {
  throw new Error("invalid worker arguments");
}
await runPlatformIo(root);
