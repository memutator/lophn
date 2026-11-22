// 옛 browser profile 목록(설정 `shell.browser_profiles`)과 저장 login(`logins.json`)을 `browser-vault.json` 하나로 옮긴다.
// 다른 컴퓨터와 칸마다 맞추려면 칸 stamp와 지운 것의 흔적이 있어야 해서다. id와 칸은 그대로이고 secret 이름(`login.<id>.*`)은
// 건드리지 않는다. 옮긴 칸의 stamp는 0이다(이 판 전에 쓴 값). vault를 먼저 쓰고(temp와 rename) 그 뒤 옛 file과 설정 key를
// 지운다. 중간에 끊겨 다시 돌면 vault가 이미 있으니 다시 만들지 않고 남은 옛 것만 지운다.
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import { z } from "zod";
import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import {
  BROWSER_VAULT_FILE_NAME,
  browserProfileSchema,
  loginIdSchema,
  loginOriginSchema,
  type VaultFile,
} from "../../../../protocol/secrets/mod.ts";
import { idSchema } from "../../../../protocol/base/ids.ts";
import { writeVaultFile } from "../../../secrets/browser-vault.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";

const OLD_SETTING = "shell.browser_profiles";
const OLD_LOGINS = "logins.json";

// 옛 `logins.json` 항목의 모양.
const oldLoginSchema = z.strictObject({
  id: loginIdSchema,
  label: z.string().min(1).max(100),
  origin: loginOriginSchema,
  username: z.string().max(200),
  note: z.string().max(1000),
  profile: idSchema("bpf").optional(),
});

const failed = (message: string) =>
  err({ code: "unavailable" as const, message });

function readJson(path: string): Result<unknown | undefined> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (thrown) {
    if (errorCode(thrown) === "ENOENT") return ok(undefined);
    return failed(`${path}를 읽지 못했다`);
  }
  try {
    return ok(JSON.parse(text));
  } catch {
    return failed(`${path}의 모양이 맞지 않는다`);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const browserVaultStep: DataStep = {
  id: "browser.vault",
  async run(root): Promise<Result<void>> {
    const vaultPath = `${root}/${BROWSER_VAULT_FILE_NAME}`;
    const loginsPath = `${root}/${OLD_LOGINS}`;
    const settingsPath = `${root}/settings.json`;
    const settings = readJson(settingsPath);
    if (!settings.ok) return settings;

    if (!existsSync(vaultPath)) {
      // 사람의 login을 잃지 않게 옛 file이 읽히지 않으면 옮기지 않고 멈춘다.
      const logins = readJson(loginsPath);
      if (!logins.ok) return logins;
      const parsedLogins = z
        .array(oldLoginSchema)
        .safeParse(logins.value ?? []);
      if (!parsedLogins.success) {
        return failed("logins.json의 모양이 맞지 않는다");
      }
      // 설정 선언이 검사하던 값이라 맞지 않는 항목은 core가 이미 없는 것으로 보던 것이다.
      const stored = isRecord(settings.value)
        ? settings.value[OLD_SETTING]
        : undefined;
      const profiles = Array.isArray(stored)
        ? stored.flatMap((one) => {
            const parsed = browserProfileSchema.safeParse(one);
            return parsed.success ? [parsed.data] : [];
          })
        : [];
      const vault: VaultFile = {
        format: 1,
        profiles: profiles.map((profile) => ({
          ...profile,
          revs: { name: 0, color: 0 },
        })),
        logins: parsedLogins.data.map((login) => ({
          ...login,
          revs: {
            label: 0,
            origin: 0,
            username: 0,
            note: 0,
            password: 0,
            totp: 0,
          },
        })),
        removed: [],
        clear: [],
      };
      const written = writeVaultFile(vaultPath, vault);
      if (!written.ok) return written;
    }

    if (isRecord(settings.value) && OLD_SETTING in settings.value) {
      const { [OLD_SETTING]: _gone, ...rest } = settings.value;
      try {
        const mode = statSync(settingsPath).mode & 0o777;
        await writeFile(
          `${settingsPath}.tmp`,
          `${JSON.stringify(rest, null, 2)}\n`,
          { mode },
        );
        await rename(`${settingsPath}.tmp`, settingsPath);
      } catch {
        return failed(
          "settings.json에서 옛 browser profile 목록을 빼지 못했다",
        );
      }
    }
    try {
      rmSync(loginsPath, { force: true });
    } catch {
      return failed("logins.json을 지우지 못했다");
    }
    return ok(undefined);
  },
};
