// `deno task test:live`의 진입. key env가 있는 provider의 file과, 로그인한 live root가 있으면 구독 file을 돌린다.
// 이 subprocess는 test가 아니라 task 진입이다. 진짜 provider를 부르므로 사람이 key를 줄 때만 돈다.

import { liveRootReady } from "./root.ts";

const PROVIDERS = [
  { env: "ANTHROPIC_API_KEY", file: "anthropic_test.ts" },
  { env: "OPENAI_API_KEY", file: "openai_test.ts" },
];

const active = PROVIDERS.filter((p) => (Deno.env.get(p.env) ?? "") !== "");
// 구독은 key가 아니라 `deno task test:live:login`이 저장한 live root가 있을 때 돈다.
const files = active.map((p) => p.file);
if (await liveRootReady()) files.push("chatgpt_test.ts");
if (files.length === 0) {
  console.log(
    `돌 것이 없어 live를 돌리지 않는다. env ${
      PROVIDERS.map((p) => p.env).join(", ")
    } 중 하나 이상이 필요하고, ChatGPT 구독은 먼저 \`deno task test:live:login\`으로 로그인해 .dev-data/live/home을 만들어야 한다.`,
  );
  Deno.exit(0);
}

let failed = false;
for (const file of files) {
  const { code } = await new Deno.Command(Deno.execPath(), {
    args: [
      "test",
      "--allow-all",
      "--no-check",
      `${import.meta.dirname}/${file}`,
    ],
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (code !== 0) failed = true;
}
Deno.exit(failed ? 1 : 0);
