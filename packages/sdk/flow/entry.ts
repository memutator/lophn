// lophn이 쥔 flow process 진입 file이다. `entry.ts <flow.ts 절대 경로>`로 돈다.
// 이 file은 mod.ts를 import하지 않는다. flow.ts가 @lophn/flow를 import할 때
// mod.ts가 처음 실행되고 그때는 port가 이미 있다.
import process from "node:process";
import { connect, settled } from "./wire.ts";

// stdout은 core와의 통로다. console.log가 통로를 깨지 않게 stderr로 돌린다.
// flow.ts를 import하기 전에 해야 한다.
const toStderr = console.error.bind(console);
for (const name of ["log", "info", "debug", "warn", "trace", "dir", "table"]) {
  (console as unknown as Record<string, unknown>)[name] = toStderr;
}
// wire.ts가 원래 write를 이미 잡아 뒀다(위 import가 먼저 돈다). 이제 flow.ts의
// process.stdout.write는 stderr로 간다. Node의 console.log는 이 write를 따라오고,
// Deno의 console.log는 위에서 따로 돌렸다(실측).
function writeToStderr(
  chunk: Uint8Array | string,
  encoding?: BufferEncoding | ((error?: Error | null) => void),
  callback?: (error?: Error | null) => void,
): boolean {
  return typeof encoding === "function"
    ? process.stderr.write(chunk, encoding)
    : process.stderr.write(chunk, encoding, callback);
}
process.stdout.write = writeToStderr;

function die(error: unknown): never {
  toStderr(error instanceof Error ? (error.stack ?? String(error)) : error);
  process.exit(1);
}

// Deno의 globalThis event 대신 process event를 쓴다. 두 runtime에서 같은 이름으로 돈다.
process.on("unhandledRejection", (reason) => {
  die(reason);
});
process.on("uncaughtException", (error) => {
  die(error);
});

const path = process.argv[2];
if (!path) {
  toStderr("usage: entry.ts <flow.ts absolute path>");
  process.exit(2);
}
const flowUrl = "file://" + path.split("/").map(encodeURIComponent).join("/");

await connect();
try {
  await import(flowUrl);
} catch (error) {
  die(error);
}
await settled();
// stdin 읽기 loop가 event loop를 붙잡고 있어 명시적으로 끝낸다.
process.exit(0);
