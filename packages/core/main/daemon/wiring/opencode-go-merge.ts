import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { err, ok, type Result } from "../../../../base/mod.ts";
import { builtinProviderDefinition } from "../../../lophn-agent/providers/definitions.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";

// OpenCode Go는 wire마다 내장 정의 하나(`opencode-go-chat`·`-responses`·`-messages`)였다가 정의 하나(`opencode-go`)가
// 됐다. 연결된 옛 provider는 하나로 합친다: 남는 것은 chat, responses, messages 순으로 먼저 있는 것이고 그 key를
// 그대로 쓴다. 나머지를 가리키던 model 선택·켠 model·agent 정의 파일은 남는 provider를 가리키게 하고, 나머지
// provider와 그 credential·secret 값은 지운다. 남는 credential의 model 목록은 한 wire만 담았으므로 비워 다음 읽기가
// 채우게 한다. 사람이 적은 model 정보는 새 정의 key로 옮긴다.
// 끊겨 다시 돌아도 같다: 파일을 먼저 고치고, ledger는 한 transaction이고, 마지막에 남은 secret 값을 지운다.
export const OPENCODE_GO_MERGE_STEP_ID =
  "lophn-agent.opencode-go-single-provider";

const OLD_KEYS = [
  "opencode-go-chat",
  "opencode-go-responses",
  "opencode-go-messages",
];
const NEW_KEY = "opencode-go";
const ENDPOINT = "https://opencode.ai/inference/go/openai/v1";
const PROTOCOL = "openai-chat-completions";

export const opencodeGoMergeStep: DataStep = {
  id: OPENCODE_GO_MERGE_STEP_ID,
  async run(root): Promise<Result<void>> {
    const definition = builtinProviderDefinition(NEW_KEY);
    if (!definition.ok) return definition;
    const opened = openConnection(`${root}/lophn.db`);
    if (!opened.ok) return opened;
    const connection = opened.value;
    let retired: { id: string; secret: string | null }[] = [];
    try {
      const table = connection.sql.get(
        "select 1 as found from sqlite_master where type = 'table' and name = 'providers'",
        [],
      );
      if (table === undefined) return ok(undefined);
      const rows = connection.sql
        .all(
          `select p.id, c.secret_name, p.definition_key from providers p
             left join provider_credentials c on c.provider = p.id
            where p.definition_key in (?, ?, ?)`,
          OLD_KEYS,
        )
        .sort(
          (a, b) =>
            OLD_KEYS.indexOf(String(a["definition_key"])) -
            OLD_KEYS.indexOf(String(b["definition_key"])),
        );
      const keep = rows[0] === undefined ? null : String(rows[0]["id"]);
      retired = rows.slice(1).map((row) => ({
        id: String(row["id"]),
        secret: row["secret_name"] === null ? null : String(row["secret_name"]),
      }));
      if (keep !== null && retired.length > 0) {
        await repointAgents(
          root,
          retired.map((row) => row.id),
          keep,
        );
      }
      connection.exec("begin immediate");
      try {
        if (keep !== null) {
          connection.sql.run(
            `update providers
                set definition_key = ?, definition = ?, name = ?, endpoint = ?, protocol = ?,
                    revision = revision + 1
              where id = ?`,
            [
              NEW_KEY,
              JSON.stringify(definition.value),
              definition.value.display_name,
              ENDPOINT,
              PROTOCOL,
              keep,
            ],
          );
          connection.sql.run(
            `update provider_credentials
                set reported_models = null, reported_model_limits = null
              where provider = ?`,
            [keep],
          );
        }
        for (const { id } of retired) {
          connection.sql.run(
            "update model_choices set provider = ? where provider = ?",
            [keep, id],
          );
          connection.sql.run(
            `insert or ignore into model_shown (provider, model_name)
               select ?, model_name from model_shown where provider = ?`,
            [keep, id],
          );
          connection.sql.run("delete from model_shown where provider = ?", [
            id,
          ]);
          connection.sql.run(
            "delete from provider_credential_model_blocks where provider = ?",
            [id],
          );
          connection.sql.run(
            "delete from provider_credentials where provider = ?",
            [id],
          );
          connection.sql.run("delete from providers where id = ?", [id]);
        }
        if (retired.length > 0) {
          connection.sql.run(
            `insert into model_shown_seq (one, seq) values (1, 1)
               on conflict (one) do update set seq = seq + 1`,
            [],
          );
        }
        connection.sql.run(
          `update or ignore model_user_info set provider_definition = ?
            where provider_definition in (?, ?, ?)`,
          [NEW_KEY, ...OLD_KEYS],
        );
        const dropped = connection.sql.run(
          "delete from model_user_info where provider_definition in (?, ?, ?)",
          OLD_KEYS,
        );
        if (Number(dropped.changes) > 0 || rows.length > 0) {
          connection.sql.run(
            `insert into model_user_info_seq (one, seq) values (1, 1)
               on conflict (one) do update set seq = seq + 1`,
            [],
          );
        }
        connection.exec("commit");
      } catch (thrown) {
        connection.exec("rollback");
        throw thrown;
      }
    } catch {
      return err({
        code: "unavailable",
        message: "OpenCode Go providers could not be merged",
      });
    } finally {
      connection.close();
    }
    return await dropSecrets(
      root,
      retired.flatMap((row) => (row.secret === null ? [] : [row.secret])),
    );
  },
};

// agent 정의 파일 frontmatter의 `provider: <옛 id>` 줄만 고친다. 나머지 bytes는 그대로 둔다.
async function repointAgents(
  root: string,
  from: readonly string[],
  to: string,
): Promise<void> {
  const files = await readdir(`${root}/agents`).catch(() => []);
  const line = new RegExp(
    `^(\\s*provider:[ \\t]*)(["']?)(${from.join("|")})\\2([ \\t]*\\r?)$`,
  );
  for (const file of files) {
    if (!/^agt_.+\.md$/.test(file)) continue;
    const path = `${root}/agents/${file}`;
    const lines = (await readFile(path, "utf8")).split("\n");
    const close = lines.findIndex(
      (text, i) => i > 0 && text.replace(/\r$/, "") === "---",
    );
    if (lines[0]?.replace(/\r$/, "") !== "---" || close === -1) continue;
    let changed = false;
    for (let i = 1; i < close; i++) {
      const found = line.exec(lines[i] as string);
      if (found === null) continue;
      lines[i] = `${found[1]}${found[2]}${to}${found[2]}${found[4]}`;
      changed = true;
    }
    if (!changed) continue;
    await writeFile(`${path}.tmp`, lines.join("\n"), "utf8");
    await rename(`${path}.tmp`, path);
  }
}

async function dropSecrets(
  root: string,
  names: readonly string[],
): Promise<Result<void>> {
  if (names.length === 0) return ok(undefined);
  const path = `${root}/secrets.json`;
  try {
    const secrets = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    // API key 연결뿐이라 `.refresh`·`.meta` 짝은 없다.
    const next = Object.fromEntries(
      Object.entries(secrets).filter(([name]) => !names.includes(name)),
    );
    if (Object.keys(next).length === Object.keys(secrets).length) {
      return ok(undefined);
    }
    const mode = (await stat(path)).mode & 0o777;
    await writeFile(`${path}.tmp`, JSON.stringify(next), { mode });
    await rename(`${path}.tmp`, path);
    return ok(undefined);
  } catch {
    // 남은 값은 가리키는 credential이 없어 어디에도 붙지 않는다. 지우지 못해도 합치기는 끝났다.
    return ok(undefined);
  }
}
