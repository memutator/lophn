import { assertEquals } from "@std/assert";
import { installIntoFolder, type InstallPorts } from "./install.ts";

function memory(files: Map<string, string>): InstallPorts {
  return {
    skills: ["lophn-build-app", "lophn-repair"].map((name) => ({
      name,
      files: [{ path: "SKILL.md", content: `# ${name}\n` }],
    })),
    read: (path) => Promise.resolve(files.get(path) ?? null),
    write: (path, text) => {
      files.set(path, text);
      return Promise.resolve();
    },
  };
}

Deno.test("사람이 고친 skill과 hook 설정은 덮지 않고 다른 설정은 보존한다", async () => {
  const files = new Map<string, string>([
    ["/app/.claude/settings.local.json", '{"model":"x"}'],
  ]);
  const input = { harness: "claude", folder: "/app" } as const;
  const first = await installIntoFolder(memory(files), input);
  assertEquals(first, {
    ok: true,
    value: { skill: "installed", hook: "installed" },
  });
  assertEquals(
    JSON.parse(files.get("/app/.claude/settings.local.json")!).model,
    "x",
  );
  const again = await installIntoFolder(memory(files), input);
  assertEquals(again, {
    ok: true,
    value: { skill: "unchanged", hook: "unchanged" },
  });

  files.set("/app/.claude/skills/lophn-repair/SKILL.md", "내가 고침\n");
  const settings = JSON.parse(files.get("/app/.claude/settings.local.json")!);
  settings.hooks.Stop[0].hooks[0].command = "lophn hook claude Stop --mine";
  files.set("/app/.claude/settings.local.json", JSON.stringify(settings));
  const edited = await installIntoFolder(memory(files), input);
  assertEquals(edited, {
    ok: true,
    value: { skill: "kept_user_edit", hook: "kept_user_edit" },
  });
  assertEquals(
    files.get("/app/.claude/skills/lophn-repair/SKILL.md"),
    "내가 고침\n",
  );
});
