import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HARNESS_ADAPTERS,
  HARNESS_IDS,
  type HarnessId,
} from "../../protocol/coding-agent/mod.ts";
import { type InstallPorts, installGlobal } from "./install.ts";
import { uninstallGlobal } from "./uninstall.ts";

// file Map 위의 대역이다. 폴더는 file의 path 앞부분이거나 `dirs`에 든 빈 폴더다.
function memory(
  files: Map<string, string>,
  dirs = new Set<string>(),
): InstallPorts {
  const below = (dir: string) =>
    [...files.keys(), ...dirs]
      .filter(
        (path) =>
          path.startsWith(`${dir}/`) &&
          !path.slice(dir.length + 1).includes("/"),
      )
      .map((path) => path.slice(dir.length + 1));
  return {
    read: (path) => Promise.resolve(files.get(path) ?? null),
    write: (path, text) => {
      files.set(path, text);
      return Promise.resolve();
    },
    list: (dir) => {
      const exists =
        dirs.has(dir) ||
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
const NOW = "2026-10-26T00:00:00.000Z";
const input = {
  harness: "claude",
  home: "/home/u",
  dryRun: false,
  now: NOW,
} as const;

test("전역 설정 install은 사람이 쓴 key와 hook을 보존하고 파싱되지 않는 설정은 건드리지 않는다", async () => {
  const mine = { type: "command", command: "my-stop-hook" };
  const files = new Map<string, string>([
    [
      SETTINGS,
      JSON.stringify({ model: "x", hooks: { Stop: [{ hooks: [mine] }] } }),
    ],
  ]);
  const first = await installGlobal(memory(files), input);
  const second = await installGlobal(memory(files), input);
  assert.deepStrictEqual(
    [first.ok && first.value.hook, second.ok && second.value.hook],
    ["installed", "unchanged"],
  );
  const doc = JSON.parse(files.get(SETTINGS)!);
  assert.deepStrictEqual(doc.model, "x");
  assert.deepStrictEqual(doc.hooks.Stop[0], { hooks: [mine] });
  assert.deepStrictEqual(doc.hooks.Stop.length, 2);

  const broken = new Map([[SETTINGS, "{ 내가 쓰는 중"]]);
  const refused = await installGlobal(memory(broken), input);
  assert.deepStrictEqual(refused.ok && refused.value.hook, "failed");
  assert.deepStrictEqual(broken.get(SETTINGS), "{ 내가 쓰는 중");

  const dry = new Map<string, string>();
  const missing = await installGlobal(memory(dry), { ...input, dryRun: true });
  assert.deepStrictEqual(missing.ok && missing.value.hook, "missing");
  assert.deepStrictEqual(dry.size, 0);
});

// 이미 hook을 놓은 사람: 새 event(SubagentStart·SubagentStop)가 없는 설정은 dry_run이 missing이고, 설치가 사람의 hook을 두고 둘을 더한다.
// 사람의 settings.json을 고치는 일이라 지킨다: 읽은 뒤 쓰기 전에 다른 도구가 file을 고쳐도 그 고침을 지우지 않는다.
test("설치가 설정을 읽은 뒤 다른 도구가 그 file을 고치면, 그 고침을 지우지 않고 다시 읽어 우리 항목만 더한다", async () => {
  const files = new Map([[SETTINGS, JSON.stringify({ theme: "dark" })]]);
  const base = memory(files);
  let reads = 0;
  const racing: InstallPorts = {
    ...base,
    async read(path) {
      const text = await base.read(path);
      if (path === SETTINGS && ++reads === 1) {
        files.set(SETTINGS, JSON.stringify({ theme: "dark", other: "tool" }));
      }
      return text;
    },
  };
  const done = await installGlobal(racing, input);
  assert.deepStrictEqual(done.ok && done.value.hook, "installed");
  const written = JSON.parse(files.get(SETTINGS)!);
  assert.deepStrictEqual(written.other, "tool");
  assert.deepStrictEqual(written.theme, "dark");
  assert.deepStrictEqual(Object.keys(written.hooks).length > 0, true);
});

test("옛 Claude 설정에는 subagent hook만 새로 더해진다", async () => {
  const mine = { type: "command", command: "my-stop-hook" };
  const files = new Map<string, string>([
    [SETTINGS, JSON.stringify({ hooks: { Stop: [{ hooks: [mine] }] } })],
  ]);
  await installGlobal(memory(files), input);
  const doc = JSON.parse(files.get(SETTINGS)!);
  assert.ok(doc.hooks.SubagentStart && doc.hooks.SubagentStop);
  delete doc.hooks.SubagentStart;
  delete doc.hooks.SubagentStop;
  files.set(SETTINGS, JSON.stringify(doc));
  const seen = await installGlobal(memory(files), { ...input, dryRun: true });
  assert.deepStrictEqual(seen.ok && seen.value.hook, "missing");
  await installGlobal(memory(files), input);
  const after = JSON.parse(files.get(SETTINGS)!);
  assert.deepStrictEqual(after.hooks.Stop[0], { hooks: [mine] });
  assert.deepStrictEqual(
    after.hooks.SubagentStop[0].hooks[0].command,
    "lophn hook claude SubagentStop",
  );
});

test("개발 command로 놓아도 사람이 쓴 hook은 남고 우리 항목은 event마다 하나다", async () => {
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
  assert.deepStrictEqual(seen.ok && seen.value.hook, "missing");
  await installGlobal(memory(files), { ...input, command: dev });
  const after = JSON.parse(files.get(SETTINGS)!);
  assert.deepStrictEqual(after.hooks.Stop[0], { hooks: [mine] });
  assert.deepStrictEqual(after.hooks.Stop.length, 2);
  assert.deepStrictEqual(
    after.hooks.Stop[1].hooks[0].command,
    `${dev} hook claude Stop`,
  );
  // 다시 packaged로 놓아도 항목이 둘이 되지 않는다.
  await installGlobal(memory(files), input);
  const back = JSON.parse(files.get(SETTINGS)!);
  for (const list of Object.values(back.hooks) as unknown[][]) {
    assert.deepStrictEqual(
      list.filter((entry) => JSON.stringify(entry).includes(" hook claude "))
        .length,
      1,
    );
  }
  assert.deepStrictEqual(
    back.hooks.Stop[1].hooks[0].command,
    "lophn hook claude Stop",
  );
});

// contract: 설치는 lophn이 전에 놓은 지운 skill의 얇은 사본만 지운다. 사람이 고친 사본, 다른 file이 더 든 폴더, 다른 이름의 skill 폴더는 남긴다.
// 현실적 회귀: 이름이나 폴더 모양만 보고 지워 사람이 쓰던 skill이 사라진다(사람 home에 쓰는 경계).
// 왜 지금 못 잡나: 이 test가 처음이다.
test("설치는 lophn이 놓은 지운 skill의 얇은 사본만 지우고, 사람이 고친 사본, 다른 file이 더 든 폴더, 다른 이름의 skill 폴더는 남긴다", async () => {
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
      files: [
        [`${skills}/lophn-repair/SKILL.md`, thin("lophn-repair") + "내 메모\n"],
      ],
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
    assert.deepStrictEqual(done.ok && done.value.skill, one.skill, one.name);
    if (one.dryRun === true) {
      assert.deepStrictEqual(
        done.ok && done.value.files.includes(one.left[0]),
        true,
        one.name,
      );
    }
    // hook 설정은 새로 생길 수 있으니 skills 아래만 본다.
    assert.deepStrictEqual(
      [...files.keys()].filter((path) => path.startsWith(skills)).sort(),
      one.left.sort(),
      one.name,
    );
  }
});

// contract: 새로 생긴 hook event(Claude PostToolUseFailure 등)가 우리 항목에 없으면 dry_run은 놓을 것이 있다고 알린다.
// 현실적 회귀: harness 단위로만 보고 unchanged라 해서 새 event가 업데이트한 사용자에게 영영 놓이지 않는다.
// 왜 지금 못 잡나: 위 행은 event가 전부 없거나 전부 있는 경우만 본다.
test("우리 항목에 없는 event가 하나라도 있으면 dry_run은 missing이다", async () => {
  const files = new Map<string, string>();
  await installGlobal(memory(files), input);
  const dry = { ...input, dryRun: true };
  const full = await installGlobal(memory(files), dry);
  assert.deepStrictEqual(full.ok && full.value.hook, "unchanged");
  const doc = JSON.parse(files.get(SETTINGS)!);
  delete doc.hooks.PostToolUseFailure;
  files.set(SETTINGS, JSON.stringify(doc));
  const stale = await installGlobal(memory(files), dry);
  assert.deepStrictEqual(stale.ok && stale.value.hook, "missing");
});

// contract: codex hook trust 기록은 우리 hook의 실제 위치 key로 config.toml에 더해지고, 사람이 쓴 내용과 다른 도구의 기록은 byte 그대로다. 파싱되지 않는 config.toml은 건드리지 않는다.
// 현실적 회귀: toml을 다시 직렬화해 주석과 다른 도구(orca 등)의 trust 기록이 사라지거나, 틀린 key로 써서 codex가 계속 건너뛴다.
// 왜 지금 못 잡나: 이 test가 처음이다.
test("codex hook install은 config.toml의 기존 내용을 그대로 두고 우리 hook의 trust 기록만 더한다", async () => {
  const hooksFile = "/home/u/.codex/hooks.json";
  const configFile = "/home/u/.codex/config.toml";
  const codex = {
    harness: "codex",
    home: "/home/u",
    dryRun: false,
    now: NOW,
  } as const;
  const original = `# 내 설정
model = "x"

[hooks.state."/other/hooks.json:stop:0:0"]
trusted_hash = "sha256:other" # 다른 도구

[projects."/work"]
trust_level = "trusted"
`;
  const files = new Map<string, string>([
    [configFile, original],
    // 사람의 hook이 앞에 있어 우리 group은 index 1이다.
    [
      hooksFile,
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "mine" }] }] },
      }),
    ],
  ]);
  const dry = await installGlobal(memory(files), { ...codex, dryRun: true });
  assert.deepStrictEqual(dry.ok && dry.value.hook, "missing");
  assert.deepStrictEqual(dry.ok && dry.value.files.includes(configFile), true);

  const done = await installGlobal(memory(files), codex);
  assert.deepStrictEqual(done.ok && done.value.hook, "installed");
  const config = files.get(configFile)!;
  assert.deepStrictEqual(config.startsWith(original), true);
  const added = [
    ...config
      .slice(original.length)
      .matchAll(
        /\[hooks\.state\."([^"]+)"\]\ntrusted_hash = "sha256:[0-9a-f]{64}"/g,
      ),
  ].map((one) => one[1]);
  assert.deepStrictEqual(
    added.length,
    Object.keys(HARNESS_ADAPTERS.codex.events).length,
  );
  assert.deepStrictEqual(added.includes(`${hooksFile}:stop:1:0`), true);
  assert.deepStrictEqual(
    added.includes(`${hooksFile}:session_start:0:0`),
    true,
  );

  const again = await installGlobal(memory(files), {
    ...codex,
    dryRun: true,
  });
  assert.deepStrictEqual(again.ok && again.value.hook, "unchanged");

  const broken = new Map([[configFile, "[hooks"]]);
  const refused = await installGlobal(memory(broken), codex);
  assert.deepStrictEqual(refused.ok && refused.value.hook, "failed");
  assert.deepStrictEqual([...broken.entries()], [[configFile, "[hooks"]]);
});

// contract: 옛 본문의 plugin 파일은 dry_run이 missing으로 알려 다음 install 때 덮이고, 개발 command가 놓인 최신 본문은 unchanged다.
// 현실적 회귀: 본문이 바뀌어도 env guard 문자열만 보고 unchanged라 해서 OpenCode 2.x가 못 읽는 옛 plugin이 영영 남는다.
// 왜 지금 못 잡나: plugin 파일을 보는 test가 없다.
test("OpenCode plugin은 본문이 다르면 dry_run이 missing이고 command만 다르면 unchanged다", async () => {
  const opencode = {
    harness: "opencode",
    home: "/home/u",
    dryRun: false,
    now: NOW,
  } as const;
  const path = "/home/u/.config/opencode/plugins/lophn-status.ts";
  const files = new Map<string, string>();
  await installGlobal(memory(files), { ...opencode, command: "/dev/lophn" });
  const dry = { ...opencode, dryRun: true };
  const same = await installGlobal(memory(files), dry);
  assert.deepStrictEqual(same.ok && same.value.hook, "unchanged");

  files.set(
    path,
    files.get(path)!.replace("export default", "export const x ="),
  );
  const stale = await installGlobal(memory(files), dry);
  assert.deepStrictEqual(stale.ok && stale.value.hook, "missing");
  await installGlobal(memory(files), opencode);
  const fixed = await installGlobal(memory(files), dry);
  assert.deepStrictEqual(fixed.ok && fixed.value.hook, "unchanged");
});

// contract: 어떤 harness든 설치 뒤 dry_run은 unchanged이고 다시 설치해도 file이 바뀌지 않는다. 개발 command로 놓은 것은 packaged dry_run이 같다고 본다.
// 현실적 회귀: 형식 하나의 기대 본문과 놓는 본문이 어긋나 열 때마다 사람에게 설치를 다시 묻거나, 설치마다 file이 흔들린다.
// 왜 지금 못 잡나: 형식마다 쓰는 쪽과 비교하는 쪽이 따로 있어 한쪽만 고치면 어긋난다.
test("hook이 있는 모든 harness는 설치 뒤 dry_run이 unchanged이고 다시 설치해도 file이 그대로다", async () => {
  for (const harness of HARNESS_IDS) {
    if (HARNESS_ADAPTERS[harness].hook === null) continue;
    for (const command of [undefined, "/dev/cli/lophn"]) {
      const files = new Map<string, string>();
      const base = { harness, home: "/home/u", now: NOW, command };
      const first = await installGlobal(memory(files), {
        ...base,
        dryRun: false,
      });
      assert.deepStrictEqual(
        first.ok && first.value.hook,
        "installed",
        harness,
      );
      const snapshot = JSON.stringify([...files]);
      const dry = await installGlobal(memory(files), {
        ...base,
        command: undefined,
        dryRun: true,
      });
      assert.deepStrictEqual(dry.ok && dry.value.hook, "unchanged", harness);
      await installGlobal(memory(files), { ...base, dryRun: false });
      assert.deepStrictEqual(JSON.stringify([...files]), snapshot, harness);
    }
  }
});

// contract: Kimi config.toml은 표시한 block 안만 바뀌고 block 밖 byte는 그대로이며, 파싱되지 않는 file은 건드리지 않는다.
// 현실적 회귀: toml을 다시 쓰다 주석과 사람의 `[[hooks]]`가 사라지거나, 다시 설치할 때 block이 두 개가 된다.
test("kimi 설치는 config.toml의 표시한 block만 바꾸고 나머지는 그대로 둔다", async () => {
  const path = "/home/u/.kimi-code/config.toml";
  const mine = `# 내 설정\ndefault_model = "k"\n\n[[hooks]]\nevent = "Stop"\ncommand = "mine"\ntimeout = 5\n`;
  const files = new Map([[path, mine]]);
  const kimi = { harness: "kimi", home: "/home/u", now: NOW } as const;
  await installGlobal(memory(files), { ...kimi, dryRun: false });
  const placed = files.get(path)!;
  assert.deepStrictEqual(
    placed.startsWith(`${mine}\n# >>> lophn kimi hooks\n`),
    true,
  );
  assert.deepStrictEqual(placed.endsWith("# <<< lophn kimi hooks\n"), true);
  // 개발 command로 바꾸면 block 안만 바뀐다. 뒤에 사람이 더한 줄도 남는다.
  files.set(path, `${placed}later = 1\n`);
  await installGlobal(memory(files), {
    ...kimi,
    dryRun: false,
    command: "/dev/lophn",
  });
  const swapped = files.get(path)!;
  assert.deepStrictEqual(swapped.startsWith(mine), true);
  assert.deepStrictEqual(
    swapped.endsWith("# <<< lophn kimi hooks\nlater = 1\n"),
    true,
  );
  assert.deepStrictEqual(swapped.split("# >>> lophn kimi hooks").length, 2);
  assert.deepStrictEqual(swapped.includes("/dev/lophn hook kimi Stop"), true);

  const broken = new Map([[path, "[[hooks"]]);
  const refused = await installGlobal(memory(broken), {
    ...kimi,
    dryRun: false,
  });
  assert.deepStrictEqual(refused.ok && refused.value.hook, "failed");
  assert.deepStrictEqual(broken.get(path), "[[hooks");
});

// contract: Devin JSONC 설정은 주석, 쉼표, 사람의 hook, 들여쓰기를 그대로 두고 우리 항목만 더하거나 제자리에서 바꾼다.
// 현실적 회귀: JSONC를 JSON으로 다시 쓰다 주석(orca·mahas 항목 옆 메모)이 사라진다.
test("devin 설치는 JSONC의 주석과 사람의 hook을 그대로 두고 우리 항목만 놓는다", async () => {
  const path = "/home/u/.config/devin/config.json";
  const original = `{
  // 내 설정
  "theme": "dark", /* 메모 */
  "hooks": {
    // 다른 도구의 hook
    "Stop": [
      { "hooks": [{ "type": "command", "command": "other stop" }] },
    ],
  },
}
`;
  const files = new Map([[path, original]]);
  const devin = { harness: "devin", home: "/home/u", now: NOW } as const;
  await installGlobal(memory(files), { ...devin, dryRun: false });
  const placed = files.get(path)!;
  assert.deepStrictEqual(placed.includes("// 내 설정"), true);
  assert.deepStrictEqual(placed.includes("/* 메모 */"), true);
  assert.deepStrictEqual(placed.includes("// 다른 도구의 hook"), true);
  assert.deepStrictEqual(placed.includes('"command": "other stop"'), true);
  assert.deepStrictEqual(
    placed.includes('"command": "lophn hook devin Stop"'),
    true,
  );
  assert.deepStrictEqual(placed.includes('"SessionStart"'), true);
  assert.deepStrictEqual(placed.split("hook devin Stop").length, 2);
  const dev = await installGlobal(memory(files), {
    ...devin,
    dryRun: false,
    command: "/dev/lophn",
  });
  assert.deepStrictEqual(dev.ok && dev.value.hook, "installed");
  const swapped = files.get(path)!;
  assert.deepStrictEqual(swapped.includes("// 다른 도구의 hook"), true);
  assert.deepStrictEqual(swapped.split("hook devin Stop").length, 2);
  assert.deepStrictEqual(swapped.includes("/dev/lophn hook devin Stop"), true);
});

// contract: Hermes는 config.yaml의 주석과 사람의 hooks를 그대로 두고 표시한 block만 놓고, 같은 event를 사람이 이미 쓰면 놓지 않으며, 사람의 다른 승인 기록을 보존한다.
// 현실적 회귀: 같은 key가 둘이 되어 사람의 config.yaml이 깨지거나, allowlist의 다른 승인이 사라진다.
test("hermes 설치는 config.yaml의 표시한 block과 allowlist의 우리 승인만 바꾼다", async () => {
  const config = "/home/u/.hermes/config.yaml";
  const allowlist = "/home/u/.hermes/shell-hooks-allowlist.json";
  const original = `# 내 설정\nmodel: x\nhooks:\n  # 내 hook\n  pre_tool_call:\n    - command: "mine"\nplugins:\n  enabled: []\n`;
  const other = {
    event: "pre_tool_call",
    command: "mine",
    approved_at: "t",
    script_mtime_at_approval: null,
  };
  const files = new Map([
    [config, original],
    [allowlist, JSON.stringify({ approvals: [other] })],
  ]);
  const hermes = { harness: "hermes", home: "/home/u", now: NOW } as const;
  await installGlobal(memory(files), { ...hermes, dryRun: false });
  const placed = files.get(config)!;
  assert.deepStrictEqual(
    placed.replace(/ {2}# >>> lophn[\s\S]*# <<< lophn hermes hooks\n/, ""),
    original,
  );
  const approvals = JSON.parse(files.get(allowlist)!).approvals;
  assert.deepStrictEqual(approvals[0], other);
  assert.deepStrictEqual(
    approvals.slice(1).map((one: { event: string }) => one.event),
    Object.keys(HARNESS_ADAPTERS.hermes.events),
  );
  // 개발 command로 바꾸면 우리 승인은 새 command로 바뀌고 사람의 것은 남는다.
  await installGlobal(memory(files), {
    ...hermes,
    dryRun: false,
    command: "/dev/lophn",
  });
  const swapped = JSON.parse(files.get(allowlist)!).approvals;
  assert.deepStrictEqual(
    swapped.length,
    1 + Object.keys(HARNESS_ADAPTERS.hermes.events).length,
  );
  assert.deepStrictEqual(
    swapped[1].command.startsWith("/dev/lophn hook hermes "),
    true,
  );

  const clash = new Map([
    [config, "hooks:\n  on_session_start:\n    - command: mine\n"],
  ]);
  const refused = await installGlobal(memory(clash), {
    ...hermes,
    dryRun: false,
  });
  assert.deepStrictEqual(refused.ok && refused.value.hook, "failed");
  assert.deepStrictEqual(clash.size, 1);
  assert.deepStrictEqual(
    clash.get(config),
    "hooks:\n  on_session_start:\n    - command: mine\n",
  );
});

// contract: Muse settings.json은 사람의 key와 env 허용 목록을 보존하고 우리 env 이름만 더하며, 사람이 다른 managed hook 파일을 쓰면 아무것도 쓰지 않고 이유와 함께 거절한다.
// 현실적 회귀: 사람의 managed hook 설정을 덮어 그 hook이 조용히 꺼진다.
test("muse 설치는 settings.json의 사람의 key를 보존하고 다른 managed 파일은 덮지 않는다", async () => {
  const settings = "/home/u/.config/muse/settings.json";
  const muse = { harness: "muse", home: "/home/u", now: NOW } as const;
  const files = new Map([
    [
      settings,
      JSON.stringify({
        schema_version: 1,
        model: "m",
        managed_hooks_env_vars: ["MINE"],
      }),
    ],
  ]);
  await installGlobal(memory(files), { ...muse, dryRun: false });
  const doc = JSON.parse(files.get(settings)!);
  assert.deepStrictEqual(doc.model, "m");
  assert.deepStrictEqual(doc.managed_hooks_env_vars, [
    "MINE",
    "LPN_TERMINAL_HOOK",
  ]);
  assert.deepStrictEqual(
    doc.managed_hooks_path,
    "/home/u/.config/muse/lophn-hooks.json",
  );

  const theirs = JSON.stringify({
    schema_version: 1,
    managed_hooks_path: "/etc/muse/hooks.json",
  });
  const clash = new Map([[settings, theirs]]);
  const refused = await installGlobal(memory(clash), {
    ...muse,
    dryRun: false,
  });
  assert.deepStrictEqual(!refused.ok && refused.error.code, "conflict");
  assert.deepStrictEqual([...clash.entries()], [[settings, theirs]]);
});

// contract: Cline script는 사람이 같은 이름으로 쓴 script를 덮지 않고(아무것도 쓰지 않고 failed), 우리 script는 실행 권한으로 놓는다.
// 현실적 회귀: 사람의 TaskComplete script가 lophn의 한 줄로 바뀐다.
test("cline 설치는 사람의 script를 덮지 않고 우리 script만 실행 권한으로 놓는다", async () => {
  const dir = "/home/u/.cline/hooks";
  const cline = { harness: "cline", home: "/home/u", now: NOW } as const;
  const mine = "#!/bin/sh\necho mine\n";
  const clash = new Map([[`${dir}/TaskComplete`, mine]]);
  const refused = await installGlobal(memory(clash), {
    ...cline,
    dryRun: false,
  });
  assert.deepStrictEqual(refused.ok && refused.value.hook, "failed");
  assert.deepStrictEqual([...clash.entries()], [[`${dir}/TaskComplete`, mine]]);

  const files = new Map<string, string>();
  const modes: string[] = [];
  const ports = memory(files);
  await installGlobal(
    {
      ...ports,
      write: (path, text, executable) => {
        if (executable === true) modes.push(path);
        return ports.write(path, text);
      },
    },
    { ...cline, dryRun: false },
  );
  assert.deepStrictEqual(
    modes.length,
    Object.keys(HARNESS_ADAPTERS.cline.events).length,
  );
  assert.deepStrictEqual(
    files.get(`${dir}/TaskComplete`),
    '#!/bin/sh\nexec "lophn" hook cline TaskComplete\n',
  );
});

// contract: 전용 file 형식(Kiro, Antigravity, Cursor)도 사람의 항목과 다른 이름의 hook을 보존한다.
// 현실적 회귀: 배열이나 이름 key를 통째로 다시 써서 사람의 hook이 사라진다.
test("kiro·antigravity·cursor 설치는 사람의 항목을 보존한다", async () => {
  const home = "/home/u";
  const cases = [
    {
      harness: "kiro",
      path: `${home}/.kiro/hooks/lophn.json`,
      seed: { version: "v1", hooks: [{ name: "mine", trigger: "Stop" }] },
      kept: (text: string) => text.includes('"name": "mine"'),
    },
    {
      harness: "antigravity",
      path: `${home}/.gemini/config/hooks.json`,
      seed: { mine: { Stop: [{ type: "command", command: "mine" }] } },
      kept: (text: string) =>
        text.includes('"mine": {') && text.includes('"command": "mine"'),
    },
    {
      harness: "cursor",
      path: `${home}/.cursor/hooks.json`,
      seed: {
        version: 1,
        hooks: { stop: [{ type: "command", command: "mine" }] },
      },
      kept: (text: string) => text.includes('"command": "mine"'),
    },
  ] as const;
  for (const one of cases) {
    const files = new Map([[one.path, JSON.stringify(one.seed)]]);
    const done = await installGlobal(memory(files), {
      harness: one.harness,
      home,
      dryRun: false,
      now: NOW,
    });
    assert.equal(done.ok, true, one.harness);
    assert.deepStrictEqual(one.kept(files.get(one.path)!), true, one.harness);
  }
});

test("antigravity 설치는 PreToolUse·PostToolUse에 matcher '*'를 두고 옛 3-event 설정은 dry_run이 missing이다", async () => {
  const path = "/home/u/.gemini/config/hooks.json";
  const agy = { harness: "antigravity", home: "/home/u", now: NOW } as const;
  const legacy = {
    mine: { Stop: [{ type: "command", command: "mine" }] },
    lophn: {
      SessionStart: [
        {
          type: "command",
          command: "lophn hook antigravity SessionStart",
          timeout: 10,
        },
      ],
      PreInvocation: [
        {
          type: "command",
          command: "lophn hook antigravity PreInvocation",
          timeout: 10,
        },
      ],
      Stop: [
        {
          type: "command",
          command: "lophn hook antigravity Stop",
          timeout: 10,
        },
      ],
    },
  };
  const files = new Map([[path, JSON.stringify(legacy)]]);
  const dry = await installGlobal(memory(files), { ...agy, dryRun: true });
  assert.deepStrictEqual(dry.ok && dry.value.hook, "missing");

  const upgraded = await installGlobal(memory(files), {
    ...agy,
    dryRun: false,
  });
  assert.deepStrictEqual(upgraded.ok && upgraded.value.hook, "installed");

  const doc = JSON.parse(files.get(path)!);
  assert.deepStrictEqual(doc.mine, legacy.mine);
  assert.deepStrictEqual(doc.lophn.PreToolUse, [
    {
      matcher: "*",
      hooks: [
        {
          type: "command",
          command: "lophn hook antigravity PreToolUse",
          timeout: 10,
        },
      ],
    },
  ]);
  assert.deepStrictEqual(doc.lophn.PostToolUse, [
    {
      matcher: "*",
      hooks: [
        {
          type: "command",
          command: "lophn hook antigravity PostToolUse",
          timeout: 10,
        },
      ],
    },
  ]);

  const after = await installGlobal(memory(files), { ...agy, dryRun: true });
  assert.deepStrictEqual(after.ok && after.value.hook, "unchanged");
});

// contract: 어떤 harness든 빈 home에 놓고 지우면 lophn 흔적(command, 표시 block, managed 경로, env 이름, Codex trust)이 남지 않고
// dry_run은 다시 missing이며, 또 지우면 unchanged다.
// 현실적 회귀: 형식 하나의 지우기가 우리 항목을 못 알아봐 [Uninstall hooks] 뒤에도 hook이 남거나 file이 반쯤 남는다.
test("hook이 있는 모든 harness는 놓고 지우면 흔적이 없고 dry_run이 다시 missing이다", async () => {
  for (const harness of HARNESS_IDS) {
    if (HARNESS_ADAPTERS[harness].hook === null) continue;
    for (const command of [undefined, "/dev/cli/lophn"]) {
      const files = new Map<string, string>();
      const base = { harness, home: "/home/u", now: NOW, command };
      await installGlobal(memory(files), { ...base, dryRun: false });
      const done = await uninstallGlobal(memory(files), base);
      assert.deepStrictEqual(done.ok && done.value.hook, "removed", harness);
      const left = [...files].filter(([, text]) =>
        /lophn|LPN_TERMINAL_HOOK|hooks\.state/.test(text),
      );
      assert.deepStrictEqual(left, [], harness);
      const dry = await installGlobal(memory(files), { ...base, dryRun: true });
      assert.deepStrictEqual(dry.ok && dry.value.hook, "missing", harness);
      const again = await uninstallGlobal(memory(files), base);
      assert.deepStrictEqual(
        again.ok && again.value.hook,
        "unchanged",
        harness,
      );
    }
  }
});

// contract: 지우기는 사람이 쓴 설정을 놓기 전 그대로 돌려놓는다. 글 형식(JSONC, TOML, YAML)은 byte 그대로이고, 다시 직렬화하는 JSON은
// 값이 같다. 사람이 우리 group에 더한 handler와 같은 이름의 사람 script는 남고, 파싱되지 않는 file은 건드리지 않는다.
// 현실적 회귀: 우리 것을 지우다 사람의 hook·주석·승인 기록·env 이름이 같이 사라진다.
test("지우기는 사람의 설정을 놓기 전 그대로 두고 우리 것만 지운다", async () => {
  const home = "/home/u";
  const mine = { type: "command", command: "my-stop-hook" };
  const texts: { harness: HarnessId; path: string; original: string }[] = [
    {
      harness: "claude",
      path: SETTINGS,
      original: `${JSON.stringify({ model: "x", hooks: { Stop: [{ hooks: [mine] }] } }, null, 2)}\n`,
    },
    {
      harness: "devin",
      path: `${home}/.config/devin/config.json`,
      original: `{
  // 내 설정
  "theme": "dark", /* 메모 */
  "hooks": {
    // 다른 도구의 hook
    "Stop": [
      { "hooks": [{ "type": "command", "command": "other stop" }] },
    ],
  },
}
`,
    },
    {
      harness: "kimi",
      path: `${home}/.kimi-code/config.toml`,
      original: `# 내 설정\ndefault_model = "k"\n\n[[hooks]]\nevent = "Stop"\ncommand = "mine"\ntimeout = 5\n`,
    },
    {
      harness: "hermes",
      path: `${home}/.hermes/config.yaml`,
      original: `# 내 설정\nmodel: x\nhooks:\n  # 내 hook\n  pre_tool_call:\n    - command: "mine"\nplugins:\n  enabled: []\n`,
    },
    {
      harness: "muse",
      path: `${home}/.config/muse/settings.json`,
      original: `${JSON.stringify({ schema_version: 1, model: "m", managed_hooks_env_vars: ["MINE"] }, null, 2)}\n`,
    },
    {
      harness: "antigravity",
      path: `${home}/.gemini/config/hooks.json`,
      original: `${JSON.stringify({ mine: { Stop: [{ type: "command", command: "mine" }] } }, null, 2)}\n`,
    },
  ];
  for (const one of texts) {
    const files = new Map([[one.path, one.original]]);
    const base = { harness: one.harness, home, now: NOW };
    await installGlobal(memory(files), { ...base, dryRun: false });
    await uninstallGlobal(memory(files), base);
    assert.deepStrictEqual(files.get(one.path), one.original, one.harness);
  }

  // Hermes 승인 기록은 사람의 것만 남는다.
  const allowlist = `${home}/.hermes/shell-hooks-allowlist.json`;
  const other = {
    event: "pre_tool_call",
    command: "mine",
    approved_at: "t",
    script_mtime_at_approval: null,
  };
  const approvals = new Map([
    [allowlist, JSON.stringify({ approvals: [other] })],
  ]);
  const hermes = { harness: "hermes", home, now: NOW } as const;
  await installGlobal(memory(approvals), { ...hermes, dryRun: false });
  await uninstallGlobal(memory(approvals), hermes);
  assert.deepStrictEqual(JSON.parse(approvals.get(allowlist)!), {
    approvals: [other],
  });

  // 사람이 우리 group에 더한 handler는 남는다.
  const claude = { harness: "claude", home, now: NOW } as const;
  const grouped = new Map<string, string>();
  await installGlobal(memory(grouped), { ...claude, dryRun: false });
  const doc = JSON.parse(grouped.get(SETTINGS)!);
  doc.hooks.Stop[0].hooks.push(mine);
  grouped.set(SETTINGS, JSON.stringify(doc));
  await uninstallGlobal(memory(grouped), claude);
  assert.deepStrictEqual(JSON.parse(grouped.get(SETTINGS)!), {
    hooks: { Stop: [{ hooks: [mine] }] },
  });

  // 같은 이름의 사람 script는 남는다.
  const dir = `${home}/.cline/hooks`;
  const cline = { harness: "cline", home, now: NOW } as const;
  const scripts = new Map<string, string>();
  await installGlobal(memory(scripts), { ...cline, dryRun: false });
  scripts.set(`${dir}/TaskStart`, "#!/bin/sh\necho mine\n");
  await uninstallGlobal(memory(scripts), cline);
  assert.deepStrictEqual(
    [...scripts],
    [[`${dir}/TaskStart`, "#!/bin/sh\necho mine\n"]],
  );

  const broken = new Map([[SETTINGS, "{ 내가 쓰는 중"]]);
  const refused = await uninstallGlobal(memory(broken), claude);
  assert.deepStrictEqual(refused.ok && refused.value.hook, "failed");
  assert.deepStrictEqual(broken.get(SETTINGS), "{ 내가 쓰는 중");
});

// contract: Codex에서 지우면 우리 trust 기록만 지우고, 우리 group 뒤에 있던 다른 도구의 기록은 당겨진 위치의 key로 옮긴다.
// config.toml의 나머지 byte는 그대로다.
// 현실적 회귀: index가 당겨진 다른 도구(orca 등)의 hook을 Codex가 새 hook으로 보고 조용히 건너뛴다.
test("codex 지우기는 우리 trust 기록만 지우고 당겨진 다른 도구의 기록을 새 key로 옮긴다", async () => {
  const hooksFile = "/home/u/.codex/hooks.json";
  const configFile = "/home/u/.codex/config.toml";
  const codex = { harness: "codex", home: "/home/u", now: NOW } as const;
  const original = `# 내 설정
model = "x"

[projects."/work"]
trust_level = "trusted"
`;
  const mine = { hooks: [{ type: "command", command: "mine" }] };
  const orca = { hooks: [{ type: "command", command: "orca stop" }] };
  const files = new Map<string, string>([
    [configFile, original],
    [hooksFile, JSON.stringify({ hooks: { Stop: [mine] } })],
  ]);
  await installGlobal(memory(files), { ...codex, dryRun: false });
  // 우리 뒤(index 2)에 다른 도구가 group과 trust 기록을 더했다.
  const doc = JSON.parse(files.get(hooksFile)!);
  doc.hooks.Stop.push(orca);
  files.set(hooksFile, JSON.stringify(doc));
  const orcaTable = (index: number) =>
    `[hooks.state."${hooksFile}:stop:${index}:0"]\ntrusted_hash = "sha256:orca"\n`;
  files.set(configFile, `${files.get(configFile)}\n${orcaTable(2)}`);

  const done = await uninstallGlobal(memory(files), codex);
  assert.deepStrictEqual(done.ok && done.value.hook, "removed");
  assert.deepStrictEqual(JSON.parse(files.get(hooksFile)!), {
    hooks: { Stop: [mine, orca] },
  });
  assert.deepStrictEqual(files.get(configFile), `${original}\n${orcaTable(1)}`);
});

// contract: Windows home(`C:\Users\u`)과 Windows 절대 경로 command(`C:/…/lophn.cmd`)에서도 모든 harness의
// 설치·dry_run·재설치·지우기가 동작하고, Codex trust key·Muse 경로는 Windows 구분자를 쓰며, Copilot은 powershell을,
// Cline은 `.ps1`을 쓴다.
test("Windows home과 Windows command에서 모든 harness 설치·재설치·지우기가 동작한다", async () => {
  const home = "C:\\Users\\u";
  const winCmd = "C:/projects/lophn/.cache/dev-cli/lophn.cmd";
  const winMemory = (files: Map<string, string>) => {
    const below = (dir: string) =>
      [...files.keys()]
        .filter(
          (path) =>
            path.startsWith(`${dir}\\`) &&
            !path.slice(dir.length + 1).includes("\\"),
        )
        .map((path) => path.slice(dir.length + 1));
    return {
      read: (path: string) => Promise.resolve(files.get(path) ?? null),
      write: (path: string, text: string) => {
        files.set(path, text);
        return Promise.resolve();
      },
      list: (dir: string) => {
        const exists = [...files.keys()].some((path) =>
          path.startsWith(`${dir}\\`),
        );
        return Promise.resolve(exists ? below(dir) : null);
      },
      remove: (path: string) => {
        if (files.delete(path)) return Promise.resolve();
        if (below(path).length > 0) {
          return Promise.reject(new Error("directory not empty"));
        }
        return Promise.resolve();
      },
    } satisfies InstallPorts;
  };

  for (const harness of HARNESS_IDS) {
    if (HARNESS_ADAPTERS[harness].hook === null) continue;
    const files = new Map<string, string>();
    const base = { harness, home, now: NOW, command: winCmd };
    const first = await installGlobal(winMemory(files), {
      ...base,
      dryRun: false,
    });
    assert.deepStrictEqual(first.ok && first.value.hook, "installed", harness);
    const snapshot = JSON.stringify([...files]);
    const dryNoCmd = await installGlobal(winMemory(files), {
      ...base,
      command: undefined,
      dryRun: true,
    });
    assert.deepStrictEqual(
      dryNoCmd.ok && dryNoCmd.value.hook,
      "unchanged",
      `${harness} dryRun(no cmd)`,
    );
    const dryWithCmd = await installGlobal(winMemory(files), {
      ...base,
      dryRun: true,
    });
    assert.deepStrictEqual(
      dryWithCmd.ok && dryWithCmd.value.hook,
      "unchanged",
      `${harness} dryRun(winCmd)`,
    );
    // 다시 설치해도 중복되지 않고 byte가 그대로다.
    await installGlobal(winMemory(files), { ...base, dryRun: false });
    assert.deepStrictEqual(JSON.stringify([...files]), snapshot, harness);

    if (harness === "codex") {
      const toml = files.get("C:\\Users\\u\\.codex\\config.toml") ?? "";
      assert.equal(
        toml.includes(
          '[hooks.state."C:\\\\Users\\\\u\\\\.codex\\\\hooks.json:session_start:0:0"]',
        ),
        true,
      );
    }
    if (harness === "copilot") {
      const doc = JSON.parse(
        files.get("C:\\Users\\u\\.copilot\\hooks\\lophn.json")!,
      );
      assert.equal(doc.hooks.Stop[0].powershell, `${winCmd} hook copilot Stop`);
    }
    if (harness === "cline") {
      const ps1 = files.get("C:\\Users\\u\\.cline\\hooks\\TaskComplete.ps1");
      assert.equal(
        ps1,
        `[Console]::In.ReadToEnd() | & '${winCmd}' hook cline TaskComplete\n`,
      );
    }
    if (harness === "opencode") {
      const plugin = files.get(
        "C:\\Users\\u\\.config\\opencode\\plugins\\lophn-status.ts",
      )!;
      assert.equal(plugin.includes("windowsVerbatimArguments"), true);
    }

    const removed = await uninstallGlobal(winMemory(files), { harness, home });
    assert.deepStrictEqual(
      removed.ok && removed.value.hook,
      "removed",
      `${harness} uninstall`,
    );
    const left = [...files].filter(([, text]) =>
      /lophn|LPN_TERMINAL_HOOK|hooks\.state/.test(text),
    );
    assert.deepStrictEqual(left, [], `${harness} left`);
  }
});
