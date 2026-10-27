// lophn이 쥔 flow process 진입 file이다. `entry.ts <flow.ts 절대 경로>`로 돈다.
// 이 file은 mod.ts를 import하지 않는다. flow.ts가 @lophn/flow를 import할 때
// mod.ts가 처음 실행되고 그때는 port가 이미 있다.
import process from "node:process";
import { connect, settled } from "./wire.ts";

// stdout은 core와의 통로다. flow.ts의 console.log와 process.stdout.write가 통로를 깨지 않게
// stderr로 돌린다. flow.ts를 import하기 전에 해야 한다. console.log는 process.stdout.write를
// 따라오므로 이 override 하나로 충분하다.
const toStderr = console.error.bind(console);
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

// 처리를 놓친 예외도 stderr에 남기고 1로 끝나 program_exited 줄에 code와 마지막 줄이 남게 한다.
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
