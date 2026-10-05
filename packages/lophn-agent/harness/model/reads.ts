import {
  type ModelDefaults,
  modelDefaultsRead,
  type presetModelSelectionSchema,
} from "../../../contracts/lophn-agent/mod.ts";
import type { z } from "zod";
import type { Result } from "../../../base/mod.ts";
import { ok } from "../../../base/mod.ts";
import type {
  Input,
  Output,
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../../contracts/platform/mod.ts";
import { createCatalogRead } from "./work.ts";

type PresetModelSelection = z.infer<typeof presetModelSelectionSchema>;

// model defaults read는 ledger snapshot에서 두 기본값을 읽는다. 행이 없으면
// 처음 값 null이다(완료 1). provider read와 같은 ledger read 정의다.

type StoredRow = {
  purpose: string;
  provider: string | null;
  credentials: string;
  model_name: string | null;
  reasoning_level: string | null;
  options: string;
  settings_seq: string;
};

function selectionOf(row: StoredRow): PresetModelSelection | null {
  if (row.provider === null || row.model_name === null) return null;
  return {
    provider: row.provider,
    credentials: JSON.parse(row.credentials) as string[],
    model_name: row.model_name,
    reasoning_level:
      (row.reasoning_level ?? "provider_default") as PresetModelSelection[
        "reasoning_level"
      ],
    options: JSON.parse(row.options) as PresetModelSelection["options"],
  };
}

export function createModelDefaultsReads(): {
  defaults: ReadDefinition<typeof modelDefaultsRead>;
  catalog: ReturnType<typeof createCatalogRead>;
} {
  return {
    defaults: {
      route: modelDefaultsRead,
      handle(
        snapshot: ReadSnapshot,
        _ctx: RequestContext,
        _input: Input<typeof modelDefaultsRead>,
      ): Result<Output<typeof modelDefaultsRead>> {
        const rows = snapshot.sql.all(
          "select purpose, provider, credentials, model_name, reasoning_level, options, settings_seq from agent_model_defaults",
          [],
        ) as unknown as StoredRow[];
        let judgment: ModelDefaults["judgment"] = null;
        let organizing: ModelDefaults["organizing"] = null;
        let settingsSeq = "0";
        for (const row of rows) {
          const selection = selectionOf(row);
          if (String(row.purpose) === "judgment") judgment = selection;
          else organizing = selection;
          const seq = String(row.settings_seq);
          if (BigInt(seq) > BigInt(settingsSeq)) settingsSeq = seq;
        }
        return ok({
          defaults: { judgment, organizing, settings_seq: settingsSeq },
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    // derived catalog read다(plan/lophn-agent Q28). reader worker 등록과 함께
    // leaf를 끼우고, core 정적 graph는 leaf import이 없다.
    catalog: createCatalogRead(),
  };
}
