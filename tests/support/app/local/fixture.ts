// 폰에서도 도는 test 앱(`runs_on: ["computer", "phone"]`)을 release 준비가 읽는 source로 만든다. 폰 화면의 kit stand-in과
// 빈 module은 `tests/support/app/phone`의 것을 쓰고(그 fixture가 data root에 깔고 commit한다), 이 폴더의 file이
// 그 위에 backend(main.ts, handlers, migration)와 선언을 덮는다. cap-store·cap-tool·declaration은 진짜 SDK 사본이다.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installSdkCopies } from "../../../../packages/core/apps/packages/install.ts";
import { makeTreeWritable } from "../../../../packages/core/apps/releases/bundle/seal.ts";
import { createPhoneApp } from "../phone/fixture.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PACKAGES = fileURLToPath(
  new URL("../../../../packages/", import.meta.url),
);

export async function createLocalApp(
  dataRoot: string,
  patch?: (dir: string) => Promise<void>,
): Promise<{ sourceRoot: string; commit: string }> {
  const installed = await installSdkCopies({
    dataRoot,
    packagesRoot: PACKAGES,
  });
  if (!installed.ok) throw new Error(installed.error.message);
  // 폰 fixture의 stand-in이 같은 자리에 깔리도록 진짜 kit 사본은 치운다(진짜 kit은 react-native를 npm에서 받아야 한다).
  await makeTreeWritable(join(dataRoot, "sdk"));
  for (const kit of ["ui-native", "app-ui-native"]) {
    await rm(join(dataRoot, "sdk", kit), { recursive: true });
  }
  return await createPhoneApp(dataRoot, async (dir) => {
    const phone = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    for (const entry of await readdir(HERE, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".tmpl")) continue;
      const path = join(entry.parentPath, entry.name).slice(HERE.length);
      const target = join(dir, path.replace(/\.tmpl$/, ""));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await readFile(join(HERE, path)));
    }
    // package.json은 덮지 않고 합친다: kit과 workspace stand-in은 폰 fixture의 것이다.
    const local = JSON.parse(
      await readFile(join(HERE, "package.json.tmpl"), "utf8"),
    );
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        ...phone,
        name: local.name,
        dependencies: local.dependencies,
      }),
    );
    await patch?.(dir);
  });
}
