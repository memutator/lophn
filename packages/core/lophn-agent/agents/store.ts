import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  AgentPlace,
  AgentRole,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AgentFileSystem, ReadSql } from "./ports.ts";

// 정의 파일과 자리 설정 파일을 app data의 자리별 `agents/` 폴더에서 읽고 쓰는 저장소다(R3).
// 파일 IO는 port로 받는다. hash는 파일 글의 sha256이고 CAS와 event가 이것을 비교한다.

export const SETTINGS_FILE = "settings.md";

const BUILTIN_FILES: Record<Exclude<AgentRole, "operator">, string> = {
  lophn: "lophn.md",
  context_engineer: "context-engineer.md",
  app_engineer: "app-engineer.md",
};

// Operator 파일 이름이 assignment ID라 정의와 실행 정체의 연결은 이름을 바꿔도 변하지 않는다.
export function agentFileName(role: AgentRole, assignment: string): string {
  return role === "operator" ? `${assignment}.md` : BUILTIN_FILES[role];
}

export function fileHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type AgentFile = { text: string; hash: string };

export type AgentStore = {
  read(place: AgentPlace, file: string): Result<AgentFile | null>;
  // 쓴 글의 hash를 돌려준다.
  write(place: AgentPlace, file: string, text: string): Result<string>;
  remove(place: AgentPlace, file: string): Result<void>;
};

export function agentsDirectory(root: string, place: AgentPlace): string {
  const area = place.kind === "project" ? "projects" : "apps";
  return `${root}/${area}/${place.id}/agents`;
}

function unavailable(what: string): Result<never> {
  return err({
    code: "unavailable",
    message: `agent file could not be ${what}`,
  });
}

export function createAgentStore(
  files: AgentFileSystem,
  root: string,
): AgentStore {
  const pathOf = (place: AgentPlace, file: string) =>
    `${agentsDirectory(root, place)}/${file}`;
  return {
    read(place, file) {
      try {
        const text = files.read(pathOf(place, file));
        return ok(text === null ? null : { text, hash: fileHash(text) });
      } catch {
        return unavailable("read");
      }
    },
    write(place, file, text) {
      try {
        files.writeAtomic(pathOf(place, file), text);
        return ok(fileHash(text));
      } catch {
        return unavailable("written");
      }
    },
    remove(place, file) {
      try {
        files.remove(pathOf(place, file));
        return ok(undefined);
      } catch {
        return unavailable("removed");
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
