import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../../base/mod.ts";
import { browserVaultStep } from "./browser-vault-step.ts";

const ids = createIdSource({
  clock: manualClock(0),
  random: seededRandom(1),
});
const WORK = `bpf_${"1".repeat(26)}`;
const SHOP = `bpf_${"2".repeat(26)}`;
const OLD = `lgn_${"0".repeat(26)}`;
const MAIL = `lgn_${"1".repeat(26)}`;

const vaultOf = (root: string) =>
  JSON.parse(readFileSync(join(root, "browser-vault.json"), "utf8"));

// 깨지면 사람의 browser profile이나 저장 login이 새 판에서 사라지거나 id가 바뀌어 agent 정의와 secret 값이 끊긴다.
test("browser.vault는 옛 profile 목록과 모든 login을 같은 id와 칸으로 옮기고 secret은 건드리지 않으며 다시 돌아도 같다", async () => {
  const root = mkdtempSync(join(tmpdir(), "lophn-vault-step-"));
  try {
    const profiles = [
      { id: WORK, name: "Work", color: "sage" },
      { id: SHOP, name: "Shop", color: "coral" },
    ];
    const logins = [
      {
        id: OLD,
        label: "Old",
        origin: "https://a.example",
        username: "me",
        note: "",
      },
      {
        id: MAIL,
        label: "Mail",
        origin: "https://mail.example:8443",
        username: "work@example.com",
        note: "2FA on",
        profile: WORK,
      },
    ];
    writeFileSync(
      join(root, "settings.json"),
      JSON.stringify({
        "shell.taskbar": false,
        "shell.browser_profiles": profiles,
      }),
    );
    writeFileSync(join(root, "logins.json"), JSON.stringify(logins));
    const secrets = JSON.stringify({
      [`login.${OLD}.password`]: "pw-old",
      [`login.${MAIL}.totp`]: "SEED",
    });
    writeFileSync(join(root, "secrets.json"), secrets);

    assert.deepEqual(await browserVaultStep.run(root, { ids }), {
      ok: true,
      value: undefined,
    });
    const vault = vaultOf(root);
    assert.deepEqual(
      vault.profiles.map(
        ({ revs: _revs, ...profile }: { revs: unknown }) => profile,
      ),
      profiles,
    );
    assert.deepEqual(
      vault.logins.map(({ revs: _revs, ...login }: { revs: unknown }) => login),
      logins,
    );
    assert.deepEqual(vault.removed, []);
    assert.equal(readFileSync(join(root, "secrets.json"), "utf8"), secrets);
    assert.equal(existsSync(join(root, "logins.json")), false);
    assert.deepEqual(
      JSON.parse(readFileSync(join(root, "settings.json"), "utf8")),
      {
        "shell.taskbar": false,
      },
    );

    // 다시 돌아도 같다(옛 file이 없어도 vault를 다시 만들지 않는다).
    assert.ok((await browserVaultStep.run(root, { ids })).ok);
    assert.deepEqual(vaultOf(root), vault);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("browser.vault는 옛 file이 없는 root에 빈 vault를 둔다", async () => {
  const root = mkdtempSync(join(tmpdir(), "lophn-vault-step-"));
  try {
    assert.ok((await browserVaultStep.run(root, { ids })).ok);
    assert.deepEqual(vaultOf(root), {
      format: 1,
      profiles: [],
      logins: [],
      removed: [],
      clear: [],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// 깨지면 읽히지 않는 옛 file이나 설정이 빈 목록으로 옮겨지고 옛 것이 지워져 사람의 login이나 profile이 사라진다.
test("browser.vault는 옛 logins.json이나 profile 설정을 읽지 못하면 오류이고 vault를 쓰지 않으며 옛 것을 남긴다", async () => {
  const cases = [
    { logins: '[{"id": "lgn_', profiles: [] as unknown },
    { logins: "[]", profiles: [{ id: WORK, name: "", color: "nope" }] },
  ];
  for (const one of cases) {
    const root = mkdtempSync(join(tmpdir(), "lophn-vault-step-"));
    try {
      const settings = JSON.stringify({
        "shell.browser_profiles": one.profiles,
      });
      writeFileSync(join(root, "settings.json"), settings);
      writeFileSync(join(root, "logins.json"), one.logins);
      const ran = await browserVaultStep.run(root, { ids });
      assert.equal(ran.ok, false);
      assert.equal(existsSync(join(root, "browser-vault.json")), false);
      assert.equal(readFileSync(join(root, "logins.json"), "utf8"), one.logins);
      assert.equal(readFileSync(join(root, "settings.json"), "utf8"), settings);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
