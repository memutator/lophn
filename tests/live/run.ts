// `npm run test:live`의 진입. key env가 있는 provider의 file과, 로그인한 live root가 있으면 구독 file을 돌린다.
// 이 subprocess는 test가 아니라 task 진입이다. 진짜 provider를 부르므로 사람이 key를 줄 때만 돈다.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";
import { liveRootReady } from "./root.ts";

// live test도 lophn process와 같은 Electron의 Node로 띄운다.
const ELECTRON = createRequire(import.meta.url)("electron") as string;

const PROVIDERS = [
  { env: "ANTHROPIC_API_KEY", file: "anthropic_test.ts" },
  { env: "OPENAI_API_KEY", file: "openai_test.ts" },
];

const active = PROVIDERS.filter((p) => (process.env[p.env] ?? "") !== "");
// 구독은 key가 아니라 `npm run test:live:login`이 저장한 live root가 있을 때 돈다.
const files = active.map((p) => p.file);
if (await liveRootReady()) files.push("chatgpt_test.ts");
if (files.length === 0) {
  console.log(
    `돌 것이 없어 live를 돌리지 않는다. env ${PROVIDERS.map((p) => p.env).join(
      ", ",
    )} 중 하나 이상이 필요하고, ChatGPT 구독은 먼저 \`npm run test:live:login\`으로 로그인해 .dev-data/live/home을 만들어야 한다.`,
  );
  process.exit(0);
}

let failed = false;
for (const file of files) {
  // 자기 자신을 다시 띄우는 자리다. Electron binary가 Node로 돌려면 ELECTRON_RUN_AS_NODE가 필요하다.
  const { status } = spawnSync(
    ELECTRON,
    ["--test", `${import.meta.dirname}/${file}`],
    { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
  );
  if (status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
