import { createRequire } from "node:module";

import { err, ok, type Result } from "../../../../packages/base/mod.ts";
import { ROLES } from "../../versions/components.ts";
import type { VariantTexts } from "../../versions/mod.ts";
import type { VariantIo } from "./io.ts";

// variant checkout의 file을 읽는 것도 lophn process와 같은 Electron의 Node로 띄운다.
const ELECTRON = createRequire(import.meta.url)("electron") as string;

// .md를 text로 묶어 가져오는 코드라 이 프로세스에서 variant file을 import하면 module 해석이 이 checkout의
// node_modules를 타서 어느 checkout 것인지 흐려진다. 그 checkout의 cwd에서 따로 돌려 JSON 한 줄로 받는다.
const SCRIPT = `
const { rolePrompt } = await import("./packages/core/agent-places/roles/prompts.ts");
const role_prompts = {};
for (const role of ${JSON.stringify(ROLES)}) {
  const text = await rolePrompt(role);
  if (!text.ok) throw new Error("role prompt missing: " + role);
  role_prompts[role] = text.value;
}
console.log(JSON.stringify({ role_prompts }));
`;

export async function variantTexts(
  root: string,
  io: VariantIo,
): Promise<Result<VariantTexts>> {
  const fail = (why: string) =>
    err({
      code: "unavailable" as const,
      message: `variant의 role prompt를 읽지 못했다: ${why}`,
    });
  try {
    const out = await io.run(
      [ELECTRON, "--input-type=module", "--eval", SCRIPT],
      root,
      { ELECTRON_RUN_AS_NODE: "1" },
    );
    if (out.code !== 0) return fail(out.stderr.trim());
    return ok(JSON.parse(out.stdout) as VariantTexts);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
