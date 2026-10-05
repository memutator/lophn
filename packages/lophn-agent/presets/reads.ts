import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import {
  type Preset,
  type PresetDefinition,
  presetInstructionAttachments,
  presetList,
  presetRead,
} from "../../contracts/lophn-agent/mod.ts";
import type { ReadDefinition } from "../../contracts/platform/mod.ts";

// preset read는 읽힌 자체를 화면 값으로 준다. credential 값·가격표는 열에
// 없고 참조만 있다(R6). 실제 담당 대상·주기·세션·run 상태는 이 읽기에
// 없다(presets#R1). prompt 원문은 판 blob 안 definition.prompt hash로 남고
// 원문을 읽는 별도 열은 없다(R4).

const PAGE = 50;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "preset not found" });
}

function invalidCursor(): Result<never> {
  return err({ code: "invalid_input", message: "invalid preset cursor" });
}

function recordOf(
  row: Record<string, unknown>,
  definition: PresetDefinition,
  definition_hash: string,
): Preset {
  return {
    id: String(row["id"]),
    revision: Number(row["revision"]),
    definition,
    definition_hash,
  };
}

function cursorAfter(cursor: string | undefined): Result<string | null> {
  if (cursor === undefined) return ok(null);
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as { after_id?: unknown };
    if (typeof parsed["after_id"] !== "string") return invalidCursor();
    return ok(parsed["after_id"]);
  } catch {
    return invalidCursor();
  }
}

function cursorOf(afterId: string): string {
  const bytes = new TextEncoder().encode(canonicalize({ after_id: afterId }));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

export function createPresetReads(): {
  read: ReadDefinition<typeof presetRead>;
  list: ReadDefinition<typeof presetList>;
  instructionAttachments: ReadDefinition<typeof presetInstructionAttachments>;
} {
  return {
    read: {
      route: presetRead,
      handle(snapshot, _ctx, input) {
        // 현재 판 또는 지정 revision이다. 과거 판은 immutable이라 같은 읽기다(R12).
        const row = input.revision === undefined
          ? snapshot.sql.get(
            "select id, revision from presets where id = ?",
            [input.preset],
          )
          : snapshot.sql.get(
            "select preset_id as id, revision from preset_revisions where preset_id = ? and revision = ?",
            [input.preset, input.revision],
          );
        if (row === undefined) return notFound();
        const revision = Number(row["revision"]);
        const blob = snapshot.sql.get(
          "select definition, definition_hash from preset_revisions where preset_id = ? and revision = ?",
          [input.preset, revision],
        );
        if (blob === undefined) return notFound();
        let definition: PresetDefinition;
        try {
          definition = JSON.parse(
            String(blob["definition"]),
          ) as PresetDefinition;
        } catch {
          return err({
            code: "internal",
            message: "preset blob을 읽지 못했다",
          });
        }
        return ok({
          preset: recordOf(row, definition, String(blob["definition_hash"])),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    list: {
      route: presetList,
      handle(snapshot, _ctx, input) {
        const after = cursorAfter(input.cursor);
        if (!after.ok) return after;
        // 현재 판만 나른다. 과거 판은 preset read로 본다(R12).
        const rows = input.kind === undefined && input.origin === undefined
          ? snapshot.sql.all(
            "select id, revision from presets where id > ? order by id limit ?",
            [after.value ?? "", PAGE + 1],
          )
          : input.origin === undefined
          ? snapshot.sql.all(
            "select id, revision from presets where kind = ? and id > ? order by id limit ?",
            [input.kind as string, after.value ?? "", PAGE + 1],
          )
          : input.kind === undefined
          ? snapshot.sql.all(
            "select id, revision from presets where origin = ? and id > ? order by id limit ?",
            [input.origin as string, after.value ?? "", PAGE + 1],
          )
          : snapshot.sql.all(
            "select id, revision from presets where kind = ? and origin = ? and id > ? order by id limit ?",
            [input.kind, input.origin, after.value ?? "", PAGE + 1],
          );
        const page = rows.slice(0, PAGE);
        const presets: Preset[] = [];
        for (const row of page) {
          const blob = snapshot.sql.get(
            "select definition, definition_hash, origin, name, prompt from preset_revisions r join presets p on p.id = r.preset_id where r.preset_id = ? and r.revision = ?",
            [String(row["id"]), Number(row["revision"])],
          );
          if (blob === undefined) continue;
          let definition: PresetDefinition;
          try {
            definition = JSON.parse(
              String(blob["definition"]),
            ) as PresetDefinition;
          } catch {
            return err({
              code: "internal",
              message: "preset blob을 읽지 못했다",
            });
          }
          presets.push(
            recordOf(row, definition, String(blob["definition_hash"])),
          );
        }
        const next = rows.length > PAGE && page.length > 0
          ? cursorOf(String(page[page.length - 1]!["id"]))
          : null;
        return ok({
          presets,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: next,
        });
      },
    },
    instructionAttachments: {
      route: presetInstructionAttachments,
      handle(snapshot, _ctx, input) {
        // 그 문서를 지침으로 붙인 현재 판이다. 순서는 판에 고정된다(R13).
        const rows = snapshot.sql.all(
          "select p.id, p.revision, p.definition from presets p join preset_revisions r on r.preset_id = p.id and r.revision = p.revision",
          [],
        );
        const attachments: {
          attachment: {
            preset: string;
            revision: number;
            document: string;
            order: number;
          };
          in_use: boolean;
        }[] = [];
        for (const row of rows) {
          let definition: PresetDefinition;
          try {
            definition = JSON.parse(
              String(row["definition"]),
            ) as PresetDefinition;
          } catch {
            return err({
              code: "internal",
              message: "preset blob을 읽지 못했다",
            });
          }
          for (const item of definition.instructions) {
            if (item.document !== input.document) continue;
            attachments.push({
              attachment: {
                preset: String(row["id"]),
                revision: Number(row["revision"]),
                document: item.document,
                order: item.order,
              },
              // 실제 담당 대상은 assignment의 몫이다(presets#R1). 사용 표시는
              // T9가 assignment read로 채운다.
              in_use: false,
            });
          }
        }
        return ok({
          attachments,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}
