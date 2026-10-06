// 시험 전용 앱 자식 entry. 실제 runtime entrypoint(start 입력 검사·Ed25519 서명 검증·
// direct socket·control·command 경계)를 그대로 쓰고, command handler만 blueprint의 각
// command를 되돌려 주는 것으로 둔다. bundle의 진입 파일이 이 파일을 import한다.
// blueprint는 entry 옆의 blueprint.json이고, DB schema 번호는 같은 폴더의 data-schema다.
import { createIdSource, systemClock } from "@lophn/base";
import { validateBlueprint } from "../../blueprint/mod.ts";
import { startDirectServer } from "../entrypoint/direct-server.ts";
import { ensureSchedulePort } from "../entrypoint/schedule.ts";
import { startRuntime } from "../entrypoint/startup.ts";

const decoder = new TextDecoder();

async function readLine(): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = Deno.stdin.readable.getReader();
  let text = "";
  while (!text.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    text = decoder.decode(
      new Uint8Array(chunks.flatMap((chunk) => [...chunk])),
    );
  }
  return text;
}

const mainDir = new URL("./", Deno.mainModule);
const parsed = validateBlueprint(
  JSON.parse(await Deno.readTextFile(new URL("blueprint.json", mainDir))),
);
if (!parsed.ok) throw new Error(parsed.error.message);
const blueprint = parsed.value;
const line = await readLine();
const clock = systemClock;
const started = startRuntime({
  line,
  blueprint,
  clock,
  ids: createIdSource({
    clock,
    random: { fill: (bytes: Uint8Array) => crypto.getRandomValues(bytes) },
  }),
  // broker는 이 시험에 없다. 관측 전달은 앱 응답을 막지 않는다.
  broker: () => Promise.resolve({ status: 503, body: null }),
  dataSchema: 0,
});

const port = ensureSchedulePort();
for (const command of blueprint.commands) {
  port.register({
    command: command.key,
    async handle(input) {
      const context = port.current();
      // SDK logger와 같은 표시다. supervisor log buffer가 invocation으로 묶는다.
      console.log(`[inv=${context?.invocation}] ran ${command.key}`);
      if (command.key === "fail") throw new Error("fixture failure");
      if (command.key === "slow") {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      return { command: command.key, input: input ?? null };
    },
  });
}
console.log("fixture app started");
startDirectServer(started.state);
