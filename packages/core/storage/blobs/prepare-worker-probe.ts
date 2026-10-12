// 제품 I/O worker 권한 모양의 blob 준비 실측 entry(platform/blob-store#R12).
// core의 platformIoSpec과 같은 권한(--allow-read/write root, --allow-sys=statfs, run 없음)에서
// 실제 여유를 관측하고 준비가 성공하는지 본다. 출력은 결과 표식뿐이고 경로·내용은 출력하지 않는다.
import { createHash } from "node:crypto";
import { createBlobStoreWork, systemQuota } from "./mod.ts";

const dataRoot = Deno.args[0];
if (!dataRoot || !dataRoot.startsWith("/")) throw new Error("invalid args");

const quota = systemQuota();
const observed = await quota.availableBytes(dataRoot);
console.log(
  `observed=${observed !== undefined && observed > 0 ? "positive" : "none"}`,
);

const hash = createHash("sha256");
const content = new TextEncoder().encode("worker-cap probe");
hash.update(content);
const digest = hash.digest("hex");

const work = createBlobStoreWork({
  root: dataRoot,
  suffix: () => "probe-1",
  quota: systemQuota(),
});
const prepared = await work.prepare(
  {
    preparation: "worker-cap-probe",
    principal: "user",
    purpose: "document_file",
  },
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(content);
      controller.close();
    },
  }),
);
if (!prepared.ok) {
  console.log(`prepare=err:${prepared.error.code}`);
  Deno.exit(1);
}
console.log(
  `prepare=ok:${prepared.value.reused ? "reused" : "installed"}:${
    digest.slice(0, 8)
  }`,
);
