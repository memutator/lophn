import { assert, assertEquals } from "@std/assert";
import {
  click,
  one,
  render,
  settle,
} from "../../../../../packages/design/components/testing.ts";

import { ContextSearchList } from "./context-search-list.tsx";
import {
  createFakeContextsSource,
  EVAL,
  RELEASE_NOTES,
} from "./fake-source.ts";
import type { SearchTabState } from "./search-tab.tsx";
import { all, norm } from "./testing.tsx";

function list(context: string) {
  const opened: SearchTabState[] = [];
  const asked = { count: 0 };
  const source = createFakeContextsSource();
  const view = render(
    <ContextSearchList
      source={source}
      context={context}
      onOpenSearch={(state) => opened.push(state)}
      onAsk={() => asked.count += 1}
    />,
  );
  return { view, source, opened, asked };
}

Deno.test("shell/workspace#R22 [ctx-I53]: 선언된 검색 목록은 context.contract의 content.searches에서 오고 고르면 그 검색을 연다", async () => {
  const { view, source, opened } = list(EVAL);
  using _ = view;
  await settle();
  const contract = await source.contract(EVAL);
  assert(contract.ok && contract.value.content !== null);
  const declared = contract.value.content.searches;
  assert(declared.length > 0);
  assertEquals(
    all(view.container, "[data-search-list] [data-declared]").map(norm),
    declared.map((search) => search.title),
  );
  click(one(view.container, `[data-declared='${declared[0]!.name}']`));
  assertEquals(opened.map((state) => [state.context, state.search]), [
    [EVAL, declared[0]!.name],
  ]);
});

Deno.test("shell/workspace#R22 [ctx-I53]: 적용된 판이 없어 계약 내용이 없는 context는 선언된 검색 없이 [Ask Context Engineer]를 보인다", async () => {
  const { view, asked } = list(RELEASE_NOTES);
  using _ = view;
  await settle();
  assertEquals(view.container.querySelector("[data-search-list]"), null);
  const ask = all(view.container, "button").find((button) =>
    norm(button) === "Ask Context Engineer"
  );
  assert(ask !== undefined, "the ask button is missing");
  click(ask);
  assertEquals(asked.count, 1);
});
