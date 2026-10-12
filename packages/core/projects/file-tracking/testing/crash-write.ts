// 교체 직전·직후 프로세스 종료 test의 자식 프로세스. 저장을 시작하고 지정한 지점에서
// 표시 파일을 만든 뒤 영원히 멈춘다. test가 그 사이에 SIGKILL로 끝낸다.
// 사용: deno run --allow-all crash-write.ts <root> <before|after> <old hash> <new text>
import { createHash } from "node:crypto";
import { denoFileOps } from "../adapters/file-ops.ts";
import { createFileSerializer } from "../file-ops.ts";
import { writeFile } from "../files.ts";

const [root, point, baseHash, text] = Deno.args;
const real = denoFileOps();
// 끝나지 않는 promise만으로는 Deno가 종료하므로 timer가 프로세스를 붙든다.
const hang = () => new Promise<never>(() => setTimeout(() => {}, 600_000));

const ops = {
  ...real,
  replace: async (temp: string, target: string) => {
    if (point === "before") {
      await Deno.writeTextFile(`${root}.marker`, "ready");
      await hang();
    }
    await real.replace(temp, target);
    await Deno.writeTextFile(`${root}.marker`, "ready");
    await hang();
  },
};

const bytes = new TextEncoder().encode(text);
await writeFile({
  ops,
  serializer: createFileSerializer(),
  clock: { nowIso: () => "2026-10-06T00:00:00.000Z" },
  token: () => "crash",
}, {
  root,
  path: `${root}/a.md`,
  baseHash,
  content: (async function* () {
    yield bytes;
  })(),
  contentHash: createHash("sha256").update(bytes).digest("hex"),
});
