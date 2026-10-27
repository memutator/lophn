// 화면 코드 wording 검사. 실행: node tools/check-wording.ts
import process from "node:process";
import { checkScreens, errorsOf } from "../packages/design/wording/check.ts";

const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const findings = await checkScreens(root);
const errors = errorsOf(findings);
for (const f of errors) {
  console.error(`${f.file}:${f.line} [${f.rule}] ${f.message}`);
}
const warnings = findings.length - errors.length;
if (warnings > 0) console.log(`warning ${warnings}개`);
process.exit(errors.length > 0 ? 1 : 0);
