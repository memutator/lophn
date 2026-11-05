import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";

// extensions가 설정 파일을 읽고 쓰는 길과 data root 규칙이다. 파일 IO는 port로 받는다.

// 한 파일의 읽기와 원자 쓰기다. 없는 파일 읽기는 null이고 그 밖의 IO 실패는 던진다.
export type WorkspaceFiles = {
  read(path: string): string | null;
  writeAtomic(path: string, text: string): void;
};

export type ReadSql = Pick<Tx["sql"], "get" | "all">;

export function fileHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// 코드가 data root를 따로 받지 않으면 ledger 파일이 있는 폴더가 data root다(agent 정의 저장소와 같은 규칙).
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
