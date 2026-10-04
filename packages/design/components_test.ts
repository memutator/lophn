// 공통 컴포넌트·reading·SDK UI의 *_test.tsx를 한 bundle에 묶어 happy-dom 위에서 등록한다.
import { assert, assertEquals } from "@std/assert";
import { registerComponentTests } from "./component-tests.ts";

const bundled = await registerComponentTests([
  new URL("./components/", import.meta.url),
  new URL("./reading/", import.meta.url),
  new URL("../sdk/ui-table/", import.meta.url),
  new URL("../sdk/ui-chart/", import.meta.url),
  new URL(
    "../../apps/shell/renderer/confirmation/screens/",
    import.meta.url,
  ),
]);

Deno.test("shell/design-system#R43: 컴포넌트 test bundle은 React 한 벌과 scope된 CSS Modules class map을 쓴다", () => {
  const react = bundled.js.match(
    /exports\.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE =/g,
  );
  assertEquals(react?.length, 1);
  const scoped = bundled.css.match(/^\.(button_[A-Za-z]+)/m)?.[1];
  assert(scoped && scoped !== "button", "button class is not scoped");
  assert(bundled.js.includes(`"${scoped}"`), "class map is missing");
  assert(!/^\.button\s*\{/m.test(bundled.css));
});
