// `deno task test:live`의 진입. key env가 있는 provider의 file만 돌린다.
// 이 subprocess는 test가 아니라 task 진입이다. 진짜 provider를 부르므로 사람이 key를 줄 때만 돈다.

const PROVIDERS = [
  { env: "ANTHROPIC_API_KEY", file: "anthropic_test.ts" },
  { env: "OPENAI_API_KEY", file: "openai_test.ts" },
];

const active = PROVIDERS.filter((p) => (Deno.env.get(p.env) ?? "") !== "");
if (active.length === 0) {
  console.log(
    `키가 없어 live를 돌리지 않는다. env ${
      PROVIDERS.map((p) => p.env).join(", ")
    } 중 하나 이상이 필요하다.`,
  );
  Deno.exit(0);
}

let failed = false;
for (const { file } of active) {
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
