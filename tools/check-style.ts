// CSS 구조 검사. 실행: node tools/check-style.ts
import process from "node:process";

import { checkRepositoryStyles } from "../packages/design/style-check/mod.ts";

const issues = await checkRepositoryStyles(new URL("../", import.meta.url));
for (const issue of issues) {
  console.error(`${issue.file}:${issue.line} ${issue.reason}`);
}
process.exit(issues.length > 0 ? 1 : 0);
