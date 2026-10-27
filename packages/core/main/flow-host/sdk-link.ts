import { mkdir, readlink, rm, symlink } from "node:fs/promises";
import { dirname } from "node:path";
import { err, errorCode, ok, type Result } from "../../../base/mod.ts";
import { FLOW_SDK_NAME } from "../../../protocol/workflows/flow-wire.ts";

// flow file은 `<data>/projects/<prj>/workflows/<name>/`에 산다. 그 공통 조상 폴더에
// `node_modules/@lophn/flow`를 두면 모든 flow file이 같은 SDK 사본으로 풀린다.
// Node는 symlink의 실제 경로가 node_modules 밖일 때만 그 `.ts`를 돌리므로 대상은 설치 사본이다.
function linkPath(dataRoot: string): string {
  return `${dataRoot}/projects/node_modules/${FLOW_SDK_NAME}`;
}

const reasonOf = (thrown: unknown) =>
  thrown instanceof Error ? thrown.message : String(thrown);

// 이미 같은 곳을 가리키면 그대로 둔다. `workflow.check`와 launch가 같은 폴더를 동시에 볼 수 있다.
export async function linkFlowSdk(input: {
  dataRoot: string;
  // `packageInstallPath`의 값. 예: `sdk/flow/1.0.0`.
  installPath: string;
}): Promise<Result<void>> {
  const path = linkPath(input.dataRoot);
  const target = `${input.dataRoot}/${input.installPath}`;
  try {
    if ((await readlink(path)) === target) return ok(undefined);
  } catch (thrown) {
    // 없는 link와 link가 아닌 것은 아래에서 다시 만든다. 그 밖의 오류는 풀리지 않는 link다.
    const code = errorCode(thrown);
    if (code !== "ENOENT" && code !== "EINVAL") {
      return err({
        code: "unavailable",
        message: `flow SDK link is unreadable: ${reasonOf(thrown)}`,
      });
    }
  }
  try {
    await mkdir(dirname(path), { recursive: true });
    await rm(path, { recursive: true, force: true });
    await symlink(target, path, "dir");
    return ok(undefined);
  } catch (thrown) {
    // 다른 launch가 먼저 만들었으면 같은 대상일 때만 받아들인다.
    if (
      errorCode(thrown) === "EEXIST" &&
      (await readlink(path).then(
        (current) => current === target,
        () => false,
      ))
    ) {
      return ok(undefined);
    }
    return err({
      code: "unavailable",
      message: `flow SDK link is not ready: ${reasonOf(thrown)}`,
    });
  }
}
