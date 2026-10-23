// lophn이 쥔 flow process 진입 file이다. `deno run entry.ts <flow.ts 절대 경로>`로 돈다.
// 이 file은 mod.ts를 import하지 않는다. flow.ts가 @lophn/flow를 import할 때
// mod.ts가 처음 실행되고 그때는 port가 이미 있다.
import { connect, settled } from "./wire.ts";

// stdout은 core와의 통로다. console.log가 통로를 깨지 않게 stderr로 돌린다.
// flow.ts를 import하기 전에 해야 한다.
const toStderr = console.error.bind(console);
for (const name of ["log", "info", "debug", "warn", "trace", "dir", "table"]) {
  (console as unknown as Record<string, unknown>)[name] = toStderr;
}

function die(error: unknown): never {
  toStderr(error instanceof Error ? error.stack ?? String(error) : error);
  Deno.exit(1);
}

globalThis.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  die(event.reason);
});
globalThis.addEventListener("error", (event) => {
  event.preventDefault();
  die(event.error ?? event.message);
});

const path = Deno.args[0];
if (!path) {
  toStderr("usage: entry.ts <flow.ts absolute path>");
  Deno.exit(2);
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
Deno.exit(0);
