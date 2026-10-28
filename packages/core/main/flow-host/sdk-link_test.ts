import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FLOW_SDK_NAME } from "../../../protocol/workflows/mod.ts";
import { linkFlowSdk } from "./sdk-link.ts";

// flow.ts가 SDK 사본이 아닌 다른 것을 import하면 project place의 agent가 쓴 code가 검사한 것과 다르게 돈다.
test("a flow file resolves @lophn/flow to the installed SDK copy", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "flow-sdk-link-"));
  try {
    const installPath = "sdk/flow/1.0.0";
    const sdk = join(dataRoot, installPath);
    await mkdir(sdk, { recursive: true });
    await writeFile(
      join(sdk, "package.json"),
      JSON.stringify({
        name: FLOW_SDK_NAME,
        version: "1.0.0",
        type: "module",
        exports: "./mod.ts",
      }),
    );
    await writeFile(join(sdk, "mod.ts"), "export const ok = true;\n");
    const workflow = join(dataRoot, "projects/prj_1/workflows/w");
    await mkdir(workflow, { recursive: true });
    const flow = join(workflow, "flow.ts");
    await writeFile(flow, 'import { ok } from "@lophn/flow";\n');

    assert.ok((await linkFlowSdk({ dataRoot, installPath })).ok);
    // check와 launch가 같이 불러도 같은 link를 다시 만들지 않는다.
    assert.ok((await linkFlowSdk({ dataRoot, installPath })).ok);
    assert.equal(
      createRequire(flow).resolve(FLOW_SDK_NAME),
      await realpath(join(sdk, "mod.ts")),
    );
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
