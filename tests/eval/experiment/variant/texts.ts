import { createRequire } from "node:module";

import { err, ok, type Result } from "../../../../packages/base/mod.ts";
import { PLACE_KINDS } from "../../../../packages/protocol/lophn-agent/mod.ts";
import type { VariantTexts } from "../../versions/mod.ts";
import type { VariantIo } from "./io.ts";

// variant checkout의 file을 읽는 것도 lophn process와 같은 Electron의 Node로 띄운다.
const ELECTRON = createRequire(import.meta.url)("electron") as string;

// .md를 text로 묶어 가져오는 코드라 이 프로세스에서 variant file을 import하면 module 해석이 이 checkout의
// node_modules를 타서 어느 checkout 것인지 흐려진다. 그 checkout의 cwd에서 따로 돌려 JSON 한 줄로 받는다.
const SCRIPT = `
const { placePrompt } = await import("./packages/core/agent-places/prompts/prompts.ts");
const place_prompts = {};
for (const kind of ${JSON.stringify(PLACE_KINDS)}) {
  const text = await placePrompt(kind);
  if (!text.ok) throw new Error("place kind prompt missing: " + kind);
  place_prompts[kind] = text.value;
}
console.log(JSON.stringify({ place_prompts }));
`;

export async function variantTexts(
  root: string,
  io: VariantIo,
): Promise<Result<VariantTexts>> {
  const fail = (why: string) =>
    err({
      code: "unavailable" as const,
      message: `variant의 place 종류 prompt를 읽지 못했다: ${why}`,
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
