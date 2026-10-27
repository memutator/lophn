import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../base/mod.ts";
import { idSchema } from "../../../protocol/base/ids.ts";
import type { Place } from "../../../protocol/lophn-agent/mod.ts";
import type { AgentFileSystem, ReadSql } from "./ports.ts";

// 정의 파일을 lophn data root 아래에서 읽고 쓰는 저장소다. 정의는 project나 앱 폴더가 아니라 lophn data에 둔다.
// 어느 자리에 두는지는 role 표(slotOf)가 정한다. 파일 IO는 port로 받는다. hash는 파일 글의 sha256이고 CAS가 이것을 비교한다.

// 정의 파일 하나의 위치. Operator의 place는 ref에 없어 호출하는 쪽이 정해 준다.
export type AgentSlot = { folder: string; file: string };

function fileHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type AgentFile = { text: string; hash: string };

export type AgentStore = {
  root: string;
  read(slot: AgentSlot): Result<AgentFile | null>;
  // 쓴 글의 hash를 돌려준다.
  write(slot: AgentSlot, text: string): Result<string>;
  remove(slot: AgentSlot): Result<void>;
  // 폴더 안의 Operator 파일 이름에서 뺀 `agt_...` id들.
  operatorIds(place: Place): Result<string[]>;
};

function unavailable(what: string): Result<never> {
  return err({
    code: "unavailable",
    message: `agent file could not be ${what}`,
  });
}

export function createAgentStore(
  files: AgentFileSystem,
  root: string,
  agentsFolderOf: (place: Place) => string,
): AgentStore {
  const pathOf = (slot: AgentSlot) => `${slot.folder}/${slot.file}`;
  return {
    root,
    read(slot) {
      try {
        const text = files.read(pathOf(slot));
        return ok(text === null ? null : { text, hash: fileHash(text) });
      } catch {
        return unavailable("read");
      }
    },
    write(slot, text) {
      try {
        files.writeAtomic(pathOf(slot), text);
        return ok(fileHash(text));
      } catch {
        return unavailable("written");
      }
    },
    remove(slot) {
      try {
        files.remove(pathOf(slot));
        return ok(undefined);
      } catch {
        return unavailable("removed");
      }
    },
    operatorIds(place) {
      try {
        return ok(
          files
            .list(agentsFolderOf(place))
            .filter(
              (name) =>
                name.endsWith(".md") &&
                idSchema("agt").safeParse(name.slice(0, -3)).success,
            )
            .map((name) => name.slice(0, -3)),
        );
      } catch {
        return unavailable("listed");
      }
    },
  };
}

// 코드가 data root를 따로 받지 않으면 ledger 파일이 있는 폴더가 data root다(reader도 같은 파일을 연다).
export function dataRootOf(
  sql: ReadSql,
  fixed: string | undefined,
): Result<string> {
  if (fixed !== undefined) return ok(fixed);
  const row = sql.get(
    "select file from pragma_database_list where name = 'main'",
    [],
  );
  const file = row?.["file"];
  if (typeof file !== "string" || !file.includes("/")) {
    return err({ code: "unavailable", message: "ledger location is unknown" });
  }
  return ok(file.slice(0, file.lastIndexOf("/")));
}
