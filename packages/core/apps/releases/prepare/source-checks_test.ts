import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAppSource } from "./source-checks.ts";

function check(files: Record<string, string>): string | null {
  return checkAppSource(
    Object.entries(files).map(([path, text]) => ({
      path,
      bytes: new TextEncoder().encode(text),
    })),
  );
}

test("소문자 JSX 요소의 title 속성은 file:line과 Tooltip 안내로 거절한다", () => {
  const reason = check({
    "src/a.tsx": `export const A = () => (
  <div>
    <button
      type="button"
      title={label}
    />
  </div>
);`,
  });
  assert.match(reason ?? "", /src\/a\.tsx:5: <button>/);
  assert.match(reason ?? "", /Tooltip from @lophn\/ui\/overlay/);
});

test("title이어도 iframe, 대문자 component, SVG title 요소, node_modules, SDK 사본, 주석은 거절하지 않는다", () => {
  const ok = check({
    "src/a.tsx": `const A = () => (
  <>
    <iframe title="preview" src={url} />
    <Card title="Orders" />
    <svg><title>chart</title></svg>
    {/* <span title="x" /> */}
    <p>don't use {"title"} here</p>
    <input data-title="x" value={a < b ? "title=1" : ""} />
  </>
);`,
    "node_modules/x/b.tsx": `const B = () => <button title="x" />;`,
    ".lophn/sdk/ui/1.0.0/c.tsx": `const C = () => <button title="x" />;`,
  });
  assert.equal(ok, null);
});

test("tab-head action의 icon이 목록에 없으면 file:line과 허용 이름으로 거절한다", () => {
  const reason = check({
    "src/a.tsx": `import { useTabHead } from "@lophn/app-ui";
export function A() {
  useTabHead({
    actions: [
      { id: "ok", label: "Run", icon: "run" },
      { id: "reload", label: "Reload", icon: "reload" },
    ],
  });
}`,
  });
  assert.match(reason ?? "", /src\/a\.tsx:6: .*"reload"/);
  assert.match(
    reason ?? "",
    /refresh, add, open, edit, delete, copy, run, stop, download/,
  );
});

test("app-ui를 쓰지 않는 파일의 icon과 actions 밖의 icon은 거절하지 않는다", () => {
  const ok = check({
    "src/other.tsx": `const rows = { actions: [{ id: "x", icon: "pencil" }] };`,
    "src/b.tsx": `import { useTabHead } from "@lophn/app-ui";
const cards = [{ icon: "pencil" }];
useTabHead({ actions: [{ id: "a", label: "A", icon: "add" }], menu: [{ id: "m", label: "M", icon: "pencil" }] });`,
  });
  assert.equal(ok, null);
});

// 폰 build와 desktop preview가 같은 source를 다르게 읽는 기본 import는 release 준비에서 한 번에 거절한다.
test("react-native-svg의 기본 import는 file:line과 이름 import 안내로 거절하고 이름 import와 type import는 거절하지 않는다", () => {
  const reason = check({
    "src/a.tsx": `import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
export const A = () => <Svg><Circle /></Svg>;`,
    "src/b.tsx": `import Svg from 'react-native-svg'`,
  });
  assert.match(
    reason ?? "",
    /src\/a\.tsx:2: .*import Svg from "react-native-svg".*import \{ Svg, Circle, Path \}/,
  );
  assert.match(reason ?? "", /src\/b\.tsx:1: /);
  assert.equal(
    check({
      "src/c.tsx": `import { Svg, Circle } from "react-native-svg";
import type Other from "react-native-svg";
import * as All from "react-native-svg";
// import Svg from "react-native-svg"`,
    }),
    null,
  );
});
