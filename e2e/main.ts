// `deno task e2e [flow...]`의 진입점. 인자가 없으면 harness와 flow 전부를,
// 있으면 그 이름의 flow만 고른다. 예: deno task e2e skeleton
const flows = Deno.args.filter((arg) => !arg.startsWith("-"));
const paths = flows.length === 0
  ? ["e2e/harness_test.ts", "e2e/flows/"]
  : flows.map((flow) => `e2e/flows/${flow}_test.ts`);

const child = new Deno.Command(Deno.execPath(), {
  args: ["test", "--allow-all", "--unstable-unsafe-proto", ...paths],
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
Deno.exit((await child.output()).code);
