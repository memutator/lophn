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
// 같은 폴더의 `data-schema` 파일이 있으면 그 번호가 이 앱의 DB schema다(activation의 준비 확인이 본다).
let dataSchema = 0;
try {
  dataSchema = Number(
    (await Deno.readTextFile(new URL("data-schema", mainDir))).trim(),
  );
} catch { /* 파일이 없으면 schema 0이다 */ }
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
  dataSchema,
  screenBytes: (screen, path) =>
    new TextEncoder().encode(`screen ${screen} ${path}`),
});

// 시험이 이 폴더에 `hold` 파일을 만들어 두면 slow는 그 파일이 지워질 때까지(기한 안에서) 끝나지
// 않는다. 정지 순서를 시계가 아니라 시험이 정한 조건으로 본다. 파일이 없으면 1.5초 뒤 끝난다.
const HOLD = new URL("hold", mainDir);
const HOLD_MAX_MS = 60_000;

async function held(): Promise<boolean> {
  try {
    await Deno.stat(HOLD);
    return true;
  } catch {
    return false;
  }
}

// slow가 시작했다는 표시. 쓰기는 앱의 data 폴더에만 허용된다.
const STARTED = new URL("data/slow-started", mainDir);

async function slow(): Promise<void> {
  await Deno.writeTextFile(STARTED, "").catch(() => undefined);
  if (!await held()) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return;
  }
  const deadline = Date.now() + HOLD_MAX_MS;
  while (await held() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const port = ensureSchedulePort();
for (const command of blueprint.commands) {
  port.register({
    command: command.key,
    async handle(input) {
      const context = port.current();
      // SDK logger와 같은 표시다. supervisor log buffer가 invocation으로 묶는다.
      console.log(`[inv=${context?.invocation}] ran ${command.key}`);
      if (command.key === "fail") throw new Error("fixture failure");
      if (command.key === "leak") {
        console.log(
          `[inv=${context?.invocation}] token ghp_abcdefghijklmnopqrstuvwxyz0123456789 end`,
        );
      }
      if (command.key === "credential") {
        return { broker_credential: started.start.broker_credential };
      }
      if (command.key === "slow") await slow();
      if (command.key === "read_file") {
        const path = (await Deno.readTextFile(new URL("read-target", mainDir)))
          .trim();
        try {
          return { body: await Deno.readTextFile(path) };
        } catch (error) {
          return { denied: error instanceof Deno.errors.NotCapable };
        }
      }
      return { command: command.key, input: input ?? null };
    },
  });
}
console.log("fixture app started");
startDirectServer(started.state);
