// backup·복원 결과의 실제 확인(apps/data#R5, R14). schema 통과를 업무 정확성으로
// 표시하지 않는다.

import { err, ok, type Result } from "../../../base/mod.ts";
import { databaseHash, openAppDatabase } from "./db.ts";
import { type SchemaCheck, schemaCheck, type SchemaState } from "./schema.ts";

export type VerifiedDatabase = {
  state: SchemaState;
  databaseHash: string;
  integrityOk: true;
  // schema 검사는 업무 규칙 검사가 아니다(R14). 항상 null이다.
  check: SchemaCheck;
};

// 파일을 열어 무결성·실제 schema·바이트 hash를 확인한다. 하나라도 실패하면 확인이
// 아니다. 확인은 읽기만 하고 내용을 바꾸지 않는다.
export async function verifyDatabase(
  path: string,
): Promise<Result<VerifiedDatabase>> {
  const opened = openAppDatabase(path);
  if (!opened.ok) return opened;
  const db = opened.value;
  try {
    if (!db.integrityOk()) {
      return err({ code: "unavailable", message: "integrity check failed" });
    }
    const state = db.schemaState();
    const hash = await databaseHash(path);
    if (!hash.ok) return hash;
    return ok({
      state,
      databaseHash: hash.value,
      integrityOk: true,
      check: schemaCheck(true),
    });
  } finally {
    db.close();
  }
}
