// PageViewSource를 창의 core 통로(`page_view/*`)로 만든다. `core`는 탭 범위의 기계 core다.
import {
  pageViewControl,
  pageViewInput,
  pageViewList,
  pageViewOpen,
  pageViewSnapshot,
  pageViewWatch,
} from "../../../../protocol/lophn-agent/page-view.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import { call } from "../../desktop/settings/core-call.ts";
import { newId } from "../../prefixed-id.ts";
import type { PageRow, PageSnapshot, PageViewSource } from "./source.ts";

export function corePageViewSource(core: CoreSource): PageViewSource {
  const memory = async (
    route: { readonly resource: string; readonly method: string },
    body: unknown,
  ) => {
    const reply = await call(
      core,
      "memory",
      route.resource,
      route.method,
      body,
    );
    return reply.ok ? { ok: true as const, value: null } : reply;
  };
  return {
    async list() {
      const reply = await call<{ pages: PageRow[] }>(
        core,
        "read",
        pageViewList.resource,
        pageViewList.method,
        {},
      );
      return reply.ok ? { ok: true, value: reply.value.pages } : reply;
    },
    snapshot: (tab) =>
      call<PageSnapshot>(
        core,
        "read",
        pageViewSnapshot.resource,
        pageViewSnapshot.method,
        { tab },
      ),
    watch: (tab, on) => memory(pageViewWatch, { tab, on }),
    input: (tab, input) =>
      memory(pageViewInput, { tab, key: newId("pin"), input }),
    control: (tab, held) => memory(pageViewControl, { tab, held }),
    async open(url) {
      const reply = await call<{ tab: string }>(
        core,
        "memory",
        pageViewOpen.resource,
        pageViewOpen.method,
        { url, key: newId("pop") },
      );
      return reply.ok ? { ok: true, value: reply.value.tab } : reply;
    },
  };
}
