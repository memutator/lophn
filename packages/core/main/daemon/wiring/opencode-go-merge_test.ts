import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { modelSchemaSteps } from "../../../lophn-agent/models/mod.ts";
import {
  providerReportedModelLimitsSchemaSteps,
  providerSchemaSteps,
} from "../../../lophn-agent/providers/mod.ts";
import { listProviders } from "../../../lophn-agent/providers/store.ts";
import { opencodeGoMergeStep } from "./opencode-go-merge.ts";

const CHAT = "pvd_00000000000000000000000001";
const RESPONSES = "pvd_00000000000000000000000002";
const MESSAGES = "pvd_00000000000000000000000003";

const AGENT = `---
handle: helper
model:
  provider: ${MESSAGES}
  model_name: claude-haiku-5-5
  option_values: {}
---

body provider: ${MESSAGES}
`;

async function setup(root: string) {
  const db = new DatabaseSync(join(root, "lophn.db"));
  for (const step of [
    ...providerSchemaSteps,
    ...providerReportedModelLimitsSchemaSteps,
    ...modelSchemaSteps,
  ]) {
    db.exec(step.sql);
  }
  const old = (key: string, protocol: string) =>
    JSON.stringify({
      key,
      display_name: "OpenCode Go (old)",
      protocols: [protocol],
      auth_kinds: ["api_key"],
      models_endpoint: "https://opencode.ai/inference/go/openai/v1/models",
      oauth: null,
      revision: "2026-11",
    });
  for (const [id, key, protocol, endpoint] of [
    [CHAT, "opencode-go-chat", "openai-chat-completions", "openai"],
    [RESPONSES, "opencode-go-responses", "openai-responses", "openai"],
    [MESSAGES, "opencode-go-messages", "anthropic-messages", "anthropic"],
  ] as const) {
    db.prepare(
      `insert into providers (id, name, definition_key, definition, endpoint, protocol, revision)
       values (?, 'OpenCode Go (old)', ?, ?, ?, ?, 1)`,
    ).run(
      id,
      key,
      old(key, protocol),
      `https://opencode.ai/inference/go/${endpoint}/v1`,
      protocol,
    );
    db.prepare(
      `insert into provider_credentials (provider, kind, secret_name, revision, state, reported_models)
       values (?, 'api_key', ?, 1, 'available', '["glm-5.3"]')`,
    ).run(id, `provider.${id.slice(4)}`);
  }
  db.prepare(
    "insert into model_choices (scope, provider, model_name, option_values) values ('global', ?, 'gpt-6-luna', '{}')",
  ).run(RESPONSES);
  db.prepare(
    "insert into model_shown (provider, model_name) values (?, 'glm-5.3'), (?, 'glm-5.3'), (?, 'claude-haiku-5-5')",
  ).run(CHAT, RESPONSES, MESSAGES);
  db.prepare(
    "insert into model_user_info (provider_definition, model_name, info, saved_at) values ('opencode-go-messages', 'qwen3.8-max', '{}', '2026-11-01T00:00:00.000Z')",
  ).run();
  db.close();
  await mkdir(join(root, "agents"));
  await writeFile(join(root, "agents/agt_1.md"), AGENT);
  await writeFile(
    join(root, "secrets.json"),
    JSON.stringify({
      [`provider.${CHAT.slice(4)}`]: "k",
      [`provider.${RESPONSES.slice(4)}`]: "k",
      [`provider.${MESSAGES.slice(4)}`]: "k",
      other: "x",
    }),
  );
}

// 사람이 고른 model·켠 model·agent 정의·적은 정보를 잃지 않고 OpenCode Go 연결 셋이 하나가 된다.
test("OpenCode Go 옛 provider 셋은 하나로 합쳐지고 가리키던 것은 남는 provider를 가리킨다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-opencode-go-merge-"));
  try {
    await setup(root);
    assert.deepStrictEqual(await opencodeGoMergeStep.run(root), {
      ok: true,
      value: undefined,
    });
    // 다시 돌아도 같다.
    assert.deepStrictEqual((await opencodeGoMergeStep.run(root)).ok, true);

    const db = new DatabaseSync(join(root, "lophn.db"));
    const rows = (q: string) =>
      db
        .prepare(q)
        .all()
        .map((row) => ({ ...row }));
    const sql = {
      get: (q: string, p: readonly unknown[]) =>
        db.prepare(q).get(...(p as never[])),
      all: (q: string, p: readonly unknown[]) =>
        db.prepare(q).all(...(p as never[])),
    } as never;
    const providers = listProviders(sql);
    assert.ok(providers.ok, JSON.stringify(providers));
    assert.deepStrictEqual(
      providers.value.map((p) => ({
        id: p.id,
        name: p.name,
        key: p.definition.key,
        endpoint: p.endpoint,
        protocol: p.protocol,
        models: p.credential.reported_models,
      })),
      [
        {
          id: CHAT,
          name: "OpenCode Go",
          key: "opencode-go",
          endpoint: "https://opencode.ai/inference/go/openai/v1",
          protocol: "openai-chat-completions",
          models: null,
        },
      ],
    );
    assert.deepStrictEqual(
      rows("select provider, model_name from model_choices"),
      [{ provider: CHAT, model_name: "gpt-6-luna" }],
    );
    assert.deepStrictEqual(
      rows("select provider, model_name from model_shown order by model_name"),
      [
        { provider: CHAT, model_name: "claude-haiku-5-5" },
        { provider: CHAT, model_name: "glm-5.3" },
      ],
    );
    assert.deepStrictEqual(
      rows("select provider_definition, model_name from model_user_info"),
      [{ provider_definition: "opencode-go", model_name: "qwen3.8-max" }],
    );
    db.close();
    // frontmatter의 provider만 바뀌고 본문은 그대로다.
    assert.deepStrictEqual(
      await readFile(join(root, "agents/agt_1.md"), "utf8"),
      AGENT.replace(`  provider: ${MESSAGES}`, `  provider: ${CHAT}`),
    );
    assert.deepStrictEqual(
      Object.keys(
        JSON.parse(await readFile(join(root, "secrets.json"), "utf8")),
      ),
      [`provider.${CHAT.slice(4)}`, "other"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
