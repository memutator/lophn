// 화면 코드 wording 검사. 실행: deno run --allow-read tools/check-wording.ts
import { RESERVED_PROBLEM_CODES } from "../packages/protocol/problems/mod.ts";
import { checkScreens, errorsOf } from "../packages/design/wording/check.ts";

const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const findings = await checkScreens(root, {
  knownKeys: RESERVED_PROBLEM_CODES.map((code) => code.message_key),
});
const errors = errorsOf(findings);
for (const f of errors) {
  console.error(`${f.file}:${f.line} [${f.rule}] ${f.message}`);
}
const warnings = findings.length - errors.length;
if (warnings > 0) console.log(`warning ${warnings}개`);
Deno.exit(errors.length > 0 ? 1 : 0);
