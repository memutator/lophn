// CLI help 테스트다(cli#R39). 사람 help와 `help --json`이 같은 표에서 나오는지,
// command 수가 registry와 같은지 본다.
import { assertEquals } from "@std/assert";
import { COMMAND_HELP, commandHelp, helpJson, helpText } from "./help.ts";
import { COMMANDS } from "./registry.ts";

// help 표의 command 이름과 registry의 command 이름이 같은 집합인지 본다.
// setup 그룹(help에만 있음)과 save(T14 자리)는 집합 비교에서 뺀다.
const helpNames = COMMAND_HELP.map((entry) => entry.command).sort();
const registryNames = COMMANDS.map((entry) => entry.name).sort();
const helpOnly = new Set([
  // setup group은 T12 dispatch 표 밖이다. daemon command는 T37에서 표에 들어왔다.
  "doctor",
  "mcp config",
  "harness list",
  "harness detect",
  "harness refresh",
  "harness inspect",
  "harness plan",
  "harness install",
  "harness update",
  "harness remove",
  "skills list",
  "skills install",
  "connection list",
  "connection show",
  "connection create",
  "connection revoke",
  "connection install",
  "session summary",
  "session plan",
  // save 접수는 T14 자리다.
  "save",
]);

Deno.test("coding-agent/cli#R39: help --json은 command 목록을 남긴다", () => {
  const summary = helpJson(undefined);
  const data = summary.data as { commands: { command: string }[] };
  assertEquals(data.commands.length, COMMAND_HELP.length);
  // 표 행 순서를 유지한다. 정렬하지 않는다.
  assertEquals(
    data.commands.map((item) => item.command),
    COMMAND_HELP.map((entry) => entry.command),
  );
});

Deno.test("coding-agent/cli#R39: help <command>는 입력·예·다음 조회를 남긴다", () => {
  const entry = commandHelp("index");
  assertEquals(entry !== undefined, true);
  const summary = helpJson("index");
  const data = summary.data as {
    command: string;
    required: string[];
    optional: string[];
    mutate: boolean;
    human_only: boolean;
    confirmation: boolean;
  };
  assertEquals(data.command, "index");
  assertEquals(data.required, entry!.required);
  assertEquals(data.optional, entry!.optional);
  assertEquals(data.mutate, entry!.mutate);
  assertEquals(data.human_only, entry!.humanOnly);
  assertEquals(data.confirmation, entry!.confirmation);
});

Deno.test("coding-agent/cli#R39: 사람 help와 help --json의 command 수가 같다", () => {
  const human = helpText(undefined);
  const machine = helpJson(undefined);
  const humanData = human.data as { commands: string };
  const machineData = machine.data as { commands: { command: string }[] };
  // 사람 help의 줄 수와 JSON의 command 수가 같다.
  assertEquals(
    humanData.commands.split("\n").length,
    machineData.commands.length,
  );
});

Deno.test("coding-agent/cli#R39: 폐지 별칭은 help에 나오지 않는다", () => {
  assertEquals(commandHelp("ls"), undefined);
  assertEquals(commandHelp("idx"), undefined);
  const unknown = helpJson("ls");
  assertEquals(
    (unknown.summary as string).includes("지원하지 않는 command다"),
    true,
  );
});

Deno.test("coding-agent/cli#R39: registry의 command가 help 표에 있다", () => {
  // setup group과 save는 T12/T14 경계 밖이다. 나머지는 모두 있다.
  const missing = registryNames.filter((name) => !helpNames.includes(name));
  assertEquals(missing, []);
});

Deno.test("coding-agent/cli#R39: help 표의 setup·save는 registry 경계 밖이다", () => {
  const extra = helpNames.filter((name) =>
    !registryNames.includes(name) && !helpOnly.has(name)
  );
  assertEquals(extra, []);
});

Deno.test("coding-agent/cli#R39: 사람 help <command>는 읽기·변경 구분을 남긴다", () => {
  const read = helpText("index");
  const readData = read.data as { marks: string };
  assertEquals(readData.marks.includes("읽기"), true);
  const mutation = COMMAND_HELP.find((entry) => entry.mutate);
  if (mutation !== undefined) {
    const mutationText = helpText(mutation.command);
    const mutationData = mutationText.data as { marks: string };
    assertEquals(mutationData.marks.includes("변경"), true);
  }
});
