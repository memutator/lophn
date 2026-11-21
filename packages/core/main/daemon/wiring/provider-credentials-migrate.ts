import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { err, ok, type Result } from "../../../../base/mod.ts";
import { maskApiKey } from "../../../lophn-agent/providers/oauth-secrets.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";

// provider당 여러 credential(crd_…) 도입에 맞춰 secrets.json의 옛 키(`provider.<pvd_ULID>` 및 `.refresh`·`.meta`)를
// `provider.crd_<ULID>`로 옮기고, 이미 등록된 API key의 마스킹 힌트(key_hint)를 채운다.
// 이미 옮겨진 키는 덮지 않으므로 끊겨 다시 돌아도 같은 결과다.
export const PROVIDER_CREDENTIALS_SECRETS_STEP_ID =
  "lophn-agent.provider-credentials-secrets";

const OLD_PROVIDER_SECRET =
  /^provider\.([0-7][0-9a-hjkmnp-tv-z]{25})(\.(?:refresh|meta))?$/;

export const providerCredentialsSecretsStep: DataStep = {
  id: PROVIDER_CREDENTIALS_SECRETS_STEP_ID,
  async run(root): Promise<Result<void>> {
    const secretsPath = `${root}/secrets.json`;
    let secrets: Record<string, string> | null = null;
    try {
      const raw = JSON.parse(await readFile(secretsPath, "utf8")) as unknown;
      if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
        secrets = raw as Record<string, string>;
      }
    } catch (thrown: unknown) {
      if ((thrown as NodeJS.ErrnoException).code === "ENOENT") {
        return ok(undefined);
      }
      return err({
        code: "unavailable",
        message: "secrets.json could not be read for provider migration",
      });
    }
    if (secrets === null) return ok(undefined);

    const next: Record<string, string> = {};
    let changed = false;
    for (const [name, value] of Object.entries(secrets)) {
      const match = OLD_PROVIDER_SECRET.exec(name);
      if (match === null) {
        next[name] = value;
        continue;
      }
      const renamed = `provider.crd_${match[1]}${match[2] ?? ""}`;
      if (!(renamed in secrets)) {
        next[renamed] = value;
      }
      changed = true;
    }

    if (changed) {
      try {
        const mode = (await stat(secretsPath)).mode & 0o777;
        await writeFile(`${secretsPath}.tmp`, JSON.stringify(next), { mode });
        await rename(`${secretsPath}.tmp`, secretsPath);
      } catch {
        return err({
          code: "unavailable",
          message: "secrets.json could not be updated for provider migration",
        });
      }
    }

    // 기존 API key credential에 key_hint를 채운다. 실패해도 기동을 막지 않는다.
    const opened = openConnection(`${root}/lophn.db`);
    if (!opened.ok) return ok(undefined);
    const connection = opened.value;
    try {
      const table = connection.sql.get(
        "select 1 as found from sqlite_master where type = 'table' and name = 'provider_credentials'",
        [],
      );
      if (table === undefined) return ok(undefined);
      const rows = connection.sql.all(
        `select id, secret_name from provider_credentials
          where kind = 'api_key' and key_hint is null and secret_name is not null`,
        [],
      );
      if (rows.length === 0) return ok(undefined);
      connection.exec("begin immediate");
      try {
        for (const row of rows) {
          const secretName = String(row["secret_name"]);
          const secretValue = next[secretName];
          if (typeof secretValue !== "string" || secretValue.trim() === "") {
            continue;
          }
          connection.sql.run(
            "update provider_credentials set key_hint = ? where id = ?",
            [maskApiKey(secretValue), String(row["id"])],
          );
        }
        connection.exec("commit");
      } catch {
        connection.exec("rollback");
      }
    } finally {
      connection.close();
    }
    return ok(undefined);
  },
};
