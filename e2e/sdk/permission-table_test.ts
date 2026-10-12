// release 준비의 요구 permission 표는 각 capability package의 `checkDeclaration`과 같은 결과여야 한다
// (apps/sdk#R22). core는 SDK 코드를 import하지 않아 표를 옮겨 썼으므로 이 시험이 두 표를 대조한다.
import { assertEquals } from "@std/assert";
import * as fs from "../../packages/sdk/cap-fs/mod.ts";
import * as net from "../../packages/sdk/cap-net/mod.ts";
import * as save from "../../packages/sdk/cap-save/mod.ts";
import * as secret from "../../packages/sdk/cap-secret/mod.ts";
import {
  missingSdkPermission,
  SDK_REQUIRED_PERMISSIONS,
} from "../../packages/core/apps/releases/sdk-permissions.ts";

const PACKAGES = {
  "@lophn/cap-fs": fs,
  "@lophn/cap-net": net,
  "@lophn/cap-save": save,
  "@lophn/cap-secret": secret,
} as const;

Deno.test("apps/sdk#R22: 준비의 요구 permission 표와 SDK 선언 검사가 같다", () => {
  assertEquals(
    Object.keys(SDK_REQUIRED_PERMISSIONS).sort(),
    Object.keys(PACKAGES).sort(),
  );
  const kinds = [
    "fs.read",
    "fs.write",
    "net.fetch",
    "net.listen",
    "secret.use",
    "document.save",
  ] as const;
  for (const [name, sdk] of Object.entries(PACKAGES)) {
    assertEquals(SDK_REQUIRED_PERMISSIONS[name], sdk.REQUIRED_PERMISSIONS);
    // 선언한 permission의 모든 부분집합에서 두 검사의 결과가 같다.
    for (let mask = 0; mask < 1 << kinds.length; mask++) {
      const permissions = kinds.filter((_, index) => (mask >> index) & 1)
        .map((kind) => ({ kind, scope: {}, reason: "r" }));
      const declared = {
        sdk_dependencies: [{ name, version: "1.0.0" }],
        permissions,
      };
      const theirs = sdk.checkDeclaration(declared);
      const ours = missingSdkPermission(declared as never);
      assertEquals(ours === undefined, theirs.ok);
      if (ours !== undefined && !theirs.ok) {
        assertEquals([...ours.permissions], [...theirs.error.permissions]);
      }
    }
  }
});
