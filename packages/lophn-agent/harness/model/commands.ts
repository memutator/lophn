import type { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  changeModelDefaults,
  type ModelDefaults,
  modelDefaultsChanged,
  type presetModelSelectionSchema,
} from "../../../contracts/lophn-agent/mod.ts";
import {
  type CommandDefinition,
  parseActor,
  type RequestContext,
  type Tx,
} from "../../../contracts/platform/mod.ts";

type PresetModelSelection = z.infer<typeof presetModelSelectionSchema>;

// 등록 순서: actor 검사 → 입력(schema·provider FK는 registry·DB) → CAS → 쓰기 →
// event. 짧은 transaction 하나다.

function requireUser(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user" ? ok(undefined) : err({
    code: "forbidden",
    message: "model defaults are user only",
  });
}

function storedDefaults(tx: Tx): {
  judgment: ModelDefaults["judgment"];
  organizing: ModelDefaults["organizing"];
  settings_seq: string | null;
} {
  const rows = tx.sql.all(
    "select purpose, provider, credentials, model_name, reasoning_level, options, settings_seq from agent_model_defaults",
    [],
  );
  let judgment: ModelDefaults["judgment"] = null;
  let organizing: ModelDefaults["organizing"] = null;
  let settingsSeq: string | null = null;
  for (const row of rows) {
    let selection: PresetModelSelection | null = null;
    if (row["provider"] !== null) {
      const parsed = {
        provider: String(row["provider"]),
        credentials: JSON.parse(String(row["credentials"])) as string[],
        model_name: String(row["model_name"]),
        reasoning_level: String(row["reasoning_level"]),
        options: JSON.parse(String(row["options"])),
      } as PresetModelSelection;
      selection = parsed;
    }
    if (String(row["purpose"]) === "judgment") judgment = selection;
    else organizing = selection;
    const seq = row["settings_seq"] === null
      ? null
      : String(row["settings_seq"]);
    if (
      seq !== null &&
      (settingsSeq === null || BigInt(seq) > BigInt(settingsSeq))
    ) {
      settingsSeq = seq;
    }
  }
  return { judgment, organizing, settings_seq: settingsSeq };
}

function upsert(
  tx: Tx,
  purpose: "judgment" | "organizing",
  selection: ModelDefaults["judgment"],
  settingsSeq: string,
): void {
  const existing = tx.sql.get(
    "select settings_seq from agent_model_defaults where purpose = ?",
    [purpose],
  );
  const options = JSON.stringify(selection?.options ?? {});
  const credentials = JSON.stringify(selection?.credentials ?? []);
  if (selection === null) {
    // null은 선택만 지우고 행을 남긴다. 설정 seq는 유지해 CAS 근거가 남는다.
    if (existing === undefined) {
      tx.sql.run(
        `insert into agent_model_defaults
          (purpose, provider, credentials, model_name, reasoning_level, options, settings_seq)
         values (?, null, ?, null, null, ?, ?)`,
        [purpose, "[]", options, settingsSeq],
      );
      return;
    }
    tx.sql.run(
      "update agent_model_defaults set provider = null, credentials = ?, model_name = null, reasoning_level = null, options = ?, settings_seq = ? where purpose = ?",
      [credentials, options, settingsSeq, purpose],
    );
    return;
  }
  if (existing === undefined) {
    tx.sql.run(
      `insert into agent_model_defaults
        (purpose, provider, credentials, model_name, reasoning_level, options, settings_seq)
       values (?, ?, ?, ?, ?, ?, ?)`,
      [
        purpose,
        selection.provider,
        credentials,
        selection.model_name,
        selection.reasoning_level,
        options,
        settingsSeq,
      ],
    );
    return;
  }
  tx.sql.run(
    `update agent_model_defaults set
       provider = ?, credentials = ?, model_name = ?, reasoning_level = ?, options = ?, settings_seq = ?
     where purpose = ?`,
    [
      selection.provider,
      credentials,
      selection.model_name,
      selection.reasoning_level,
      options,
      settingsSeq,
      purpose,
    ],
  );
}

export function createModelDefaultsCommands(): {
  change: CommandDefinition<typeof changeModelDefaults>;
} {
  return {
    change: {
      route: changeModelDefaults,
      handle(tx, ctx, input, compare) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        const current = storedDefaults(tx);
        // 처음 저장은 settings_seq 0과 비교한다. 이전 변경이 없으면 0이다.
        const previousSeq = current.settings_seq ?? "0";
        if (previousSeq !== compare.settings_seq) {
          return err({
            code: "conflict",
            message: "settings seq가 바뀌었다",
          });
        }
        const nextSeq = tx.emit(modelDefaultsChanged, null, {
          settings_seq: compare.settings_seq,
          defaults: {
            judgment: input.judgment,
            organizing: input.organizing,
            settings_seq: compare.settings_seq,
          },
        });
        // 두 용도에 각각 upsert다. null도 행을 남겨 설정 seq가 유지된다.
        upsert(tx, "judgment", input.judgment, nextSeq);
        upsert(tx, "organizing", input.organizing, nextSeq);
        return ok({
          judgment: input.judgment,
          organizing: input.organizing,
          settings_seq: nextSeq,
        });
      },
    },
  };
}
