import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../build.ts";

// sibling IPC는 Node의 main/node_modules 탐색 밖이다. production과 같은 bundle로 실행한다.
const dir = await mkdtemp(join(tmpdir(), "overlay-node-"));
try {
  await build(dir, [{
    in: fileURLToPath(new URL("./testdata/overlay-cases.ts", import.meta.url)),
    out: "overlay-cases",
  }]);
  await import(pathToFileURL(join(dir, "overlay-cases.js")).href);
} finally {
  await rm(dir, { recursive: true });
}
