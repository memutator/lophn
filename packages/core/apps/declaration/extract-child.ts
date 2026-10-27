// 선언 값 추출 자식. 평가가 낸 값을 argv의 JSON 하나로 받아 정본 검사를 하고 정규 JSON 한 줄을
// stdout에 남긴다. 부모는 10초 뒤 SIGKILL로 끝낸다.
// 정본의 Zod 없는 파일만 직접 import한다. protocol/apps/mod.ts는 zod를 쓴다.
import process from "node:process";
import { canonicalJson } from "../../../protocol/apps/declaration/json.ts";
import { validateDeclaration } from "../../../protocol/apps/declaration/value.ts";

const value = process.argv[2];
if (value === undefined) {
  console.error("declaration value is missing");
  process.exit(1);
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
