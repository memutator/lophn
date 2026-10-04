// desktop/의 *_test.tsx를 design 컴포넌트 test와 같은 local-css bundle·happy-dom에서 등록한다.
import { registerComponentTests } from "@lophn/design/component-tests";

await registerComponentTests(
  [new URL("./", import.meta.url)],
  [new URL("../deno.json", import.meta.url)],
);
