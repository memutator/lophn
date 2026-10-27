// 권한 없는 선언 추출 자식.
// --allow-* 없이 띄우므로 파일·network·env는 Deno가 거절한다. 값은 argv로만 받고
// 정규 JSON 한 줄을 stdout에 남긴다. 부모는 10초 뒤 SIGKILL로 끝낸다.
// 정본의 Zod 없는 파일만 직접 import한다. contracts/apps/mod.ts는 읽기 권한이 필요하다.
import { readFileSync } from "node:fs";
import process from "node:process";
import { canonicalJson } from "../../../protocol/apps/declaration/json.ts";
import { validateDeclaration } from "../../../protocol/apps/declaration/value.ts";

const value = process.argv[2];
if (value === undefined) {
  console.error("declaration value is missing");
  process.exit(1);
}
if (value === "read-file") {
  // sandbox가 실제로 막는지 스스로 확인한다. Node의 권한 model은 ERR_ACCESS_DENIED,
  // Deno의 권한 flag는 NotCapable로 거절한다. 부모는 stderr의 "permission denied"를 거절로 읽는다.
  try {
    readFileSync("/etc/hostname");
  } catch (error) {
    const denied =
      (error as { code?: unknown }).code === "ERR_ACCESS_DENIED" ||
      (error as { name?: unknown }).name === "NotCapable";
    if (denied) {
      console.error(`permission denied: ${(error as Error).message}`);
      process.exit(1);
    }
    throw error;
  }
  // 읽혔다면 권한이 좁혀지지 않은 것이다.
  process.exit(1);
}
if (value === "loop") {
  while (true) {
    // 권한 없는 자식의 무한 반복. 부모가 10초 뒤 SIGKILL한다.
  }
}
let parsed: unknown;
try {
  parsed = JSON.parse(value);
} catch {
  console.error("declaration value is not JSON");
  process.exit(1);
}
const validated = validateDeclaration(parsed);
if (!validated.ok) {
  console.error("declaration value is not a declaration");
  process.exit(1);
}
console.log(canonicalJson(validated.value as never));
