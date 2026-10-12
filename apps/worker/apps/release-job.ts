// release 준비 job 한 번(apps/releases). supervisor가 준비 요청마다 권한을 좁혀 띄우고 argv의 JSON 한 줄을
// 받아 stdout에 결과 JSON 한 줄을 남긴다. 플랫폼 credential은 받지 않는다(architecture/apps 2.1).
import { prepareFromSource } from "../../../packages/core/apps/releases/prepare/from-source.ts";

export type ReleaseJobInput = {
  dataRoot: string;
  app: string;
  sourceRoot: string;
  commit: string;
};

export type ReleaseJobResult =
  | {
    ok: true;
    bundle_hash: string;
    blueprint_hash: string;
    manifest: unknown;
  }
  | { ok: false; reason: string };

if (import.meta.main) {
  const input = JSON.parse(Deno.args[0] ?? "{}") as ReleaseJobInput;
  const prepared = await prepareFromSource(input);
  const result: ReleaseJobResult = prepared.ok
    ? {
      ok: true,
      bundle_hash: prepared.value.bundleHash,
      blueprint_hash: prepared.value.blueprintHash,
      manifest: prepared.value.manifest,
    }
    : { ok: false, reason: prepared.error.reason };
  console.log(JSON.stringify(result));
}
