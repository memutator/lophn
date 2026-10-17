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
