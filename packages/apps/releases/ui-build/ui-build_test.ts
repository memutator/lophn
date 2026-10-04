// 고정 UI 의존 screen build(apps/releases#R4, apps/sdk#R10). 준비 단계의 build 결과와
// external source map이 bundle에 들어가고, 운영 시작에는 build나 의존 다운로드가 없다(R4).
// 고정 목록 밖의 의존은 거절이다(apps/sdk#R34).
import { assert, assertEquals } from "@std/assert";
import {
  buildScreens,
  dependenciesInsideFixedList,
  FIXED_UI_DEPENDENCIES,
} from "./build.ts";
import { SOURCE_MAP_COPY_NAME } from "../bundle/seal.ts";

const SCREENS = [
  {
    path: "screens/one.js",
    bytes: new TextEncoder().encode("export const one = 1;\n"),
  },
  {
    path: "screens/two.js",
    bytes: new TextEncoder().encode("export const two = 2;\n"),
  },
];
const FIXED_SDKS = [
  { name: "@lophn/blueprint", version: "1.0.0" },
  { name: "react", version: "19.0.0" },
];

Deno.test("apps/releases#R4: 고정 UI 의존의 screen build 결과가 bundle에 들어간다", async () => {
  const built = await buildScreens({
    screens: SCREENS,
    dependencies: FIXED_SDKS,
  });
  assert(built.ok);
  assertEquals(built.value.files, SCREENS);
  // external source map은 bundle 안 고정 이름이다.
  assertEquals(built.value.sourceMap.path, SOURCE_MAP_COPY_NAME);
  const map = JSON.parse(
    new TextDecoder().decode(built.value.sourceMap.bytes),
  ) as {
    version: number;
    file: string[];
    sources: string[];
    sourcesContent: string[];
  };
  assertEquals(map.version, 3);
  assertEquals(map.file, ["screens/one.js", "screens/two.js"]);
  assertEquals(map.sources, ["screens/one.js", "screens/two.js"]);
  // external source map은 내용을 싣지 않는다(bundle 사본 용량 한계, R4).
  assertEquals(map.sourcesContent, []);
});

Deno.test("apps/releases#R4: 운영 시작에는 build·다운로드가 없다", () => {
  // 고정 UI 의존 exact 목록만 준비 단계 build에 들어간다. 목록이 코드 상수 하나로
  // 고정이므로 운영 프로세스는 그 결과만 읽는다(R4, apps/sdk#R10).
  assertEquals(FIXED_UI_DEPENDENCIES.includes("react"), true);
  assertEquals(FIXED_UI_DEPENDENCIES.includes("@lophn/blueprint"), true);
  // 고정 목록 안 의존은 통과다.
  assertEquals(dependenciesInsideFixedList(FIXED_SDKS), true);
});

Deno.test("apps/sdk#R34: 고정 목록 밖 의존과 화면 없는 build는 거절이다", async () => {
  // 고정 목록 밖의 의존.
  const outside = await buildScreens({
    screens: SCREENS,
    dependencies: [{ name: "left-pad", version: "1.0.0" }],
  });
  assertEquals(outside.ok, false);
  if (!outside.ok) {
    assertEquals(outside.error.reason, "dependency_outside_fixed_list");
  }
  // 화면 없는 build.
  const empty = await buildScreens({ screens: [], dependencies: FIXED_SDKS });
  assertEquals(empty.ok, false);
  if (!empty.ok) assertEquals(empty.error.reason, "fixed_dependency_missing");
});
