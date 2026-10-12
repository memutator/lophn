import { assert, assertEquals } from "@std/assert";
import {
  click,
  focus,
  render,
  settle,
} from "../../../../../packages/design/components/testing.ts";

import { ViolationToast } from "./violation-toast.tsx";
import { all, buttonNamed, norm } from "./testing.tsx";

function toast(
  count: number,
  handlers: { onView?: () => void; onClose?: () => void } = {},
) {
  return render(
    <ViolationToast
      title="eval"
      count={count}
      onView={handlers.onView ?? (() => {})}
      onClose={handlers.onClose ?? (() => {})}
    />,
  );
}

Deno.test("shell/workspace#R29 [ctx-I44]: toast는 context 이름과 어긋난 문서 수를 알리고 [View]를 보인다", async () => {
  using view = toast(2);
  await settle();
  assert(
    norm(view.container).includes("eval: 2 documents don't match the contract"),
    `unexpected toast: ${norm(view.container)}`,
  );
  assert(buttonNamed(view.container, "View"), "[View] is missing");
});

Deno.test("shell/workspace#R29 [ctx-I44]: 하나뿐이면 단수로 쓴다", async () => {
  using view = toast(1);
  await settle();
  assert(
    norm(view.container).includes(
      "eval: 1 document doesn't match the contract",
    ),
    `unexpected toast: ${norm(view.container)}`,
  );
});

Deno.test("shell/workspace#R29 [ctx-I44]: [View]는 onView를 부르고 toast가 떠도 입력 focus는 그대로다", async () => {
  const typing = document.createElement("input");
  document.body.append(typing);
  try {
    focus(typing);
    let viewed = 0;
    using view = toast(2, { onView: () => viewed += 1 });
    await settle();
    assert(document.activeElement === typing, "the toast took the focus");
    click(buttonNamed(view.container, "View")!);
    assertEquals(viewed, 1);
    assertEquals(
      all(view.container, "button").map(norm).includes("View"),
      true,
    );
  } finally {
    typing.remove();
  }
});
