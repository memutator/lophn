// 읽기 전용 bundle 사본과 seal(apps/releases#R1, architecture/apps 3.2).
// 사본은 `apps/<app ID>/bundles/<bundle hash>/`의 파일 0444·디렉터리 0555다.
// 그 안의 정규 `blueprint.json`과 source map 자리는 problems test runner가 쓴다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { BundleManifest } from "../../../contracts/apps/mod.ts";

export type SealFailure = {
  code: "unavailable" | "invalid_input";
  message: string;
};

// bundle 사본 위치 규칙(apps/plan apps#T6, contracts#T36에 경로 함수가 없으므로
// 이 leaf가 직접 계산한다). app ID와 hash는 caller가 schema로 검사한 값이다.
export function bundleCopyPath(
  dataRoot: string,
  app: string,
  bundleHash: string,
): string {
  return `${dataRoot}/apps/${app}/bundles/${bundleHash}`;
}

// 정규 blueprint.json과 source map 자리. bundle 사본 안의 고정 이름이다.
export const BLUEPRINT_COPY_NAME = "blueprint.json";
export const SOURCE_MAP_COPY_NAME = "app.js.map";

// bundle byte·manifest·정규 blueprint JSON·source map을 봉인한다.
// 파일은 0444, 디렉터리는 0555로 좁힌다(R1, apps/sdk#R9의 설치 사본과 같은 규칙).
export async function sealBundle(
  input: {
    copyPath: string;
    manifest: BundleManifest;
    blueprintJson: Uint8Array;
    bundleFiles: readonly { path: string; bytes: Uint8Array }[];
    sourceMap?: { path: string; bytes: Uint8Array };
  },
): Promise<Result<void, SealFailure>> {
  const directories: string[] = [input.copyPath];
  try {
    await Deno.mkdir(input.copyPath, { recursive: true, mode: 0o755 });
    for (const file of input.bundleFiles) {
      const slash = file.path.lastIndexOf("/");
      if (slash > 0) {
        const directory = `${input.copyPath}/${file.path.slice(0, slash)}`;
        await Deno.mkdir(directory, { recursive: true, mode: 0o755 });
        directories.push(directory);
      }
      await Deno.writeFile(`${input.copyPath}/${file.path}`, file.bytes, {
        mode: 0o444,
      });
    }
    await Deno.writeFile(
      `${input.copyPath}/${BLUEPRINT_COPY_NAME}`,
      input.blueprintJson,
      { mode: 0o444 },
    );
    if (input.sourceMap) {
      await Deno.writeFile(
        `${input.copyPath}/${SOURCE_MAP_COPY_NAME}`,
        input.sourceMap.bytes,
        { mode: 0o444 },
      );
    }
    void input.manifest;
  } catch (thrown) {
    return err({
      code: "unavailable",
      message: `bundle 사본을 쓰지 못했다: ${
        thrown instanceof Error ? thrown.message : thrown
      }`,
    });
  }
  for (const directory of [...directories].reverse()) {
    try {
      await Deno.chmod(directory, 0o555);
    } catch {
      // 이미 0555면 없어도 된다.
    }
  }
  return ok(undefined);
}

// 사본이 정말 0444·0555인지 본다(R1). 테스트가 쓴다.
export async function verifySealedPermissions(
  copyPath: string,
): Promise<Result<void, SealFailure>> {
  let stat;
  try {
    stat = await Deno.stat(copyPath);
  } catch {
    return err({ code: "invalid_input", message: "bundle copy is missing" });
  }
  if (!stat.isDirectory) {
    return err({
      code: "invalid_input",
      message: "bundle copy is not a directory",
    });
  }
  if (((stat.mode ?? 0) & 0o222) !== 0) {
    return err({
      code: "invalid_input",
      message: "bundle copy directory is writable",
    });
  }
  for await (const entry of Deno.readDir(copyPath)) {
    const child = await Deno.stat(`${copyPath}/${entry.name}`);
    if (((child.mode ?? 0) & 0o222) !== 0) {
      return err({
        code: "invalid_input",
        message: `bundle copy is writable: ${entry.name}`,
      });
    }
  }
  return ok(undefined);
}
