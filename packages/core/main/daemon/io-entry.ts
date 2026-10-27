import process from "node:process";
import { runPlatformIo } from "../worker/io.ts";

// supervisor가 넘긴 stdio로 platform/io child를 연다. kind와 root는 환경으로만 받는다.
const root = process.env.LOPHN_HOME;
if (process.env.LOPHN_WORKER_KIND !== "platform/io" || !root) {
  throw new Error("invalid worker arguments");
}
await runPlatformIo(root);
