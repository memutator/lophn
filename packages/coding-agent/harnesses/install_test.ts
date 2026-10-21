import { assertEquals } from "@std/assert";
import { installGlobal, type InstallPorts } from "./install.ts";

// file Map 위의 대역이다. 폴더는 file의 path 앞부분이거나 `dirs`에 든 빈 폴더다.
function memory(
  files: Map<string, string>,
  dirs = new Set<string>(),
): InstallPorts {
  const below = (dir: string) =>
    [...files.keys(), ...dirs].filter((path) =>
      path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes("/")
    ).map((path) => path.slice(dir.length + 1));
  return {
    read: (path) => Promise.resolve(files.get(path) ?? null),
    write: (path, text) => {
      files.set(path, text);
      return Promise.resolve();
    },
    list: (dir) => {
      const exists = dirs.has(dir) ||
        [...files.keys()].some((path) => path.startsWith(`${dir}/`));
      return Promise.resolve(exists ? below(dir) : null);
    },
    remove: (path) => {
      if (files.delete(path)) return Promise.resolve();
      if (below(path).length > 0) {
        return Promise.reject(new Error("directory not empty"));
      }
      dirs.delete(path);
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

// contract: 설치는 lophn이 전에 놓은 지운 skill의 얇은 사본만 지운다. 사람이 고친 사본, 다른 file이 더 든 폴더, 다른 이름의 skill 폴더는 남긴다.
// 현실적 회귀: 이름이나 폴더 모양만 보고 지워 사람이 쓰던 skill이 사라진다(사람 home에 쓰는 경계).
// 왜 지금 못 잡나: 이 test가 처음이다.
Deno.test("설치는 lophn이 놓은 지운 skill의 얇은 사본만 지우고, 사람이 고친 사본, 다른 file이 더 든 폴더, 다른 이름의 skill 폴더는 남긴다", async () => {
  const skills = "/home/u/.claude/skills";
  const thin = (name: string) =>
    `---\nname: ${name}\ndescription: "d"\n---\n\n# ${name}\n\n절차는 \`lophn guide ${name}\`이 내준다. 그 출력을 따른다.\n`;
  const cases: {
    name: string;
    files: [string, string][];
    dryRun?: boolean;
    left: string[];
    skill: "installed" | "unchanged" | "missing";
  }[] = [
    {
      name: "lophn이 쓴 꼴",
      files: [[`${skills}/lophn-build-app/SKILL.md`, thin("lophn-build-app")]],
      left: [],
      skill: "installed",
    },
    {
      name: "사람이 본문을 고침",
      files: [[
        `${skills}/lophn-repair/SKILL.md`,
        thin("lophn-repair") + "내 메모\n",
      ]],
      left: [`${skills}/lophn-repair/SKILL.md`],
      skill: "unchanged",
    },
    {
      name: "폴더에 다른 file",
      files: [
        [`${skills}/lophn-build-app/SKILL.md`, thin("lophn-build-app")],
        [`${skills}/lophn-build-app/notes.md`, "n"],
      ],
      left: [
        `${skills}/lophn-build-app/SKILL.md`,
        `${skills}/lophn-build-app/notes.md`,
      ],
      skill: "unchanged",
    },
    {
      name: "다른 이름의 skill",
      files: [[`${skills}/my-skill/SKILL.md`, thin("my-skill")]],
      left: [`${skills}/my-skill/SKILL.md`],
      skill: "unchanged",
    },
    {
      name: "dry_run",
      files: [[`${skills}/lophn-build-app/SKILL.md`, thin("lophn-build-app")]],
      dryRun: true,
      left: [`${skills}/lophn-build-app/SKILL.md`],
      skill: "missing",
    },
  ];
  for (const one of cases) {
    const files = new Map(one.files);
    const done = await installGlobal(memory(files), {
      ...input,
      dryRun: one.dryRun === true,
    });
    assertEquals(done.ok && done.value.skill, one.skill, one.name);
    if (one.dryRun === true) {
      assertEquals(
        done.ok && done.value.files.includes(one.left[0]),
        true,
        one.name,
      );
    }
    // hook 설정은 새로 생길 수 있으니 skills 아래만 본다.
    assertEquals(
      [...files.keys()].filter((path) => path.startsWith(skills)).sort(),
      one.left.sort(),
      one.name,
    );
  }
});
