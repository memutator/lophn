// bundle manifest. entrypoint·각 상대 path·hash·
// 출처가 있는 exact dependencies를 담는다. schema는 contracts의 bundleManifestSchema 하나다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  type BundleManifest,
  bundleManifestSchema,
} from "../../../../protocol/apps/mod.ts";

type ManifestFailure = {
  code: "invalid_input";
  message: string;
};

function parseManifest(
  value: unknown,
): Result<BundleManifest, ManifestFailure> {
  const parsed = bundleManifestSchema.safeParse(value);
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "manifest is not a bundle manifest",
    });
  }
  return ok(parsed.data);
}

export function buildManifest(input: {
  entrypoint: string;
  files: readonly { path: string; hash: string }[];
  dependencies: readonly BundleManifest["dependencies"][number][];
}): Result<BundleManifest, ManifestFailure> {
  return parseManifest({
    entrypoint: input.entrypoint,
    files: [...input.files],
    sdk_dependencies: [],
    dependencies: [...input.dependencies],
  });
}

// manifest + 파일 바이트의 hash. manifest 자체를 bundle byte에 넣지 않는다
// (test 후 byte 수정은 새 bundle이다).
export function manifestBytes(manifest: BundleManifest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(manifest));
}
