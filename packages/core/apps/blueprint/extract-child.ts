// 권한 없는 blueprint 추출 자식(apps/blueprint#R17).
// --allow-* 없이 띄우므로 파일·network·env는 Deno가 거절한다. 값은 argv로만 받고
// 정규 JSON 한 줄을 stdout에 남긴다. 부모는 10초 뒤 SIGKILL로 끝낸다.
// 정본의 Zod 없는 파일만 직접 import한다. contracts/apps/mod.ts는 읽기 권한이 필요하다.
import { canonicalJson } from "../../../protocol/apps/blueprint-json.ts";
import { validateBlueprint } from "../../../protocol/apps/blueprint-value.ts";

const value = Deno.args[0];
if (value === undefined) {
  console.error("blueprint value is missing");
  Deno.exit(1);
}
if (value === "read-file") {
  Deno.readTextFileSync("/etc/hostname");
  Deno.exit(1);
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
  console.error("blueprint value is not JSON");
  Deno.exit(1);
}
const validated = validateBlueprint(parsed);
if (!validated.ok) {
  console.error("blueprint value is not a blueprint");
  Deno.exit(1);
}
console.log(canonicalJson(validated.value as never));
