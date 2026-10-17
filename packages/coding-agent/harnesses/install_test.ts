import { assertEquals } from "@std/assert";
import { installGlobal, type InstallPorts } from "./install.ts";

function memory(files: Map<string, string>): InstallPorts {
  return {
    skills: ["lophn-build-app", "lophn-repair"].map((name) => ({
      name,
      files: [{
        path: "SKILL.md",
        content: `---\nname: ${name}\ndescription: "d"\n---\n# ${name}\n`,
      }],
    })),
    read: (path) => Promise.resolve(files.get(path) ?? null),
    write: (path, text) => {
      files.set(path, text);
      return Promise.resolve();
    },
  };
}

const SETTINGS = "/home/u/.claude/settings.json";
const input = { harness: "claude", home: "/home/u", dryRun: false } as const;

Deno.test("전역 설정 install은 사람이 쓴 key와 hook을 보존하고 파싱되지 않는 설정은 건드리지 않는다", async () => {
  const mine = { type: "command", command: "my-stop-hook" };
  const files = new Map<string, string>([
    [
      SETTINGS,
      JSON.stringify({ model: "x", hooks: { Stop: [{ hooks: [mine] }] } }),
    ],
  ]);
  const first = await installGlobal(memory(files), input);
  const second = await installGlobal(memory(files), input);
  assertEquals(
    [first.ok && first.value.hook, second.ok && second.value.hook],
    ["installed", "unchanged"],
  );
  const doc = JSON.parse(files.get(SETTINGS)!);
  assertEquals(doc.model, "x");
  assertEquals(doc.hooks.Stop[0], { hooks: [mine] });
  assertEquals(doc.hooks.Stop.length, 2);

  const broken = new Map([[SETTINGS, "{ 내가 쓰는 중"]]);
  const refused = await installGlobal(memory(broken), input);
  assertEquals(refused.ok && refused.value.hook, "failed");
  assertEquals(broken.get(SETTINGS), "{ 내가 쓰는 중");

  const dry = new Map<string, string>();
  const missing = await installGlobal(memory(dry), { ...input, dryRun: true });
  assertEquals(missing.ok && missing.value.hook, "missing");
  assertEquals(dry.size, 0);
});

Deno.test("개발 command로 놓아도 사람이 쓴 hook은 남고 우리 항목은 event마다 하나다", async () => {
  const mine = { type: "command", command: "my-stop-hook" };
  const files = new Map<string, string>([
    [SETTINGS, JSON.stringify({ hooks: { Stop: [{ hooks: [mine] }] } })],
  ]);
  const dev = "/opt/lophn/bin/lophn";
  await installGlobal(memory(files), input);
  // 옛 `lophn hook` 항목이 있으면 개발 command의 dry_run은 놓을 것이 있다고 본다.
  const seen = await installGlobal(memory(files), {
    ...input,
    dryRun: true,
    command: dev,
  });
  assertEquals(seen.ok && seen.value.hook, "missing");
  await installGlobal(memory(files), { ...input, command: dev });
  const after = JSON.parse(files.get(SETTINGS)!);
  assertEquals(after.hooks.Stop[0], { hooks: [mine] });
  assertEquals(after.hooks.Stop.length, 2);
  assertEquals(after.hooks.Stop[1].hooks[0].command, `${dev} hook claude Stop`);
  // 다시 packaged로 놓아도 항목이 둘이 되지 않는다.
  await installGlobal(memory(files), input);
  const back = JSON.parse(files.get(SETTINGS)!);
  for (const list of Object.values(back.hooks) as unknown[][]) {
    assertEquals(
      list.filter((entry) => JSON.stringify(entry).includes(" hook claude "))
        .length,
      1,
    );
  }
  assertEquals(back.hooks.Stop[1].hooks[0].command, "lophn hook claude Stop");
});
