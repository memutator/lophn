// page-view 탭 kind. 다른 기계의 창에서 그 기계의 browser page를 보고 다룬다(`browser-tab.md` "멀리서 보기"). key `pages`의
// 탭은 page 목록이고, 목록에서 고른 page는 key `page-view:<탭 id>`의 탭이다. 다른 기계의 창의 layout은 메모리에만 있어
// fromStored·toStored가 없다. 이 컴퓨터의 agent page는 browser 탭이라 새 탭 menu가 다른 기계의 창에서만 이 탭을 연다.
import { useMemo } from "react";
import { t } from "@lophn/i18n";

import { corePageViewSource } from "../../browser/page-view/core-source.ts";
import { PageList } from "../../browser/page-view/page-list.tsx";
import { PageView } from "../../browser/page-view/page-view.tsx";
import { useEventClient } from "../../desktop/connection/events/hooks.tsx";
import { useWindowMachine } from "../../desktop/machines/context.tsx";
import { browserIcons } from "../../icons/mod.ts";
import type { TabItem } from "../model.ts";
import { PaddedTab } from "../padded-tab.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

const PAGES_KEY = "pages";
const PAGE_PREFIX = "page-view:";

/** page 목록 탭을 연다. 이미 열려 있으면 고르기만 한다. */
export function openPages(host: TabHost): void {
  host.openTab({
    key: PAGES_KEY,
    kind: "page-view",
    title: t("machines.page.kind"),
  });
}

function PageViewTab({ tab, host }: { tab: TabItem; host: TabHost }) {
  const client = useEventClient();
  const source = useMemo(() => corePageViewSource(client.core), [client]);
  const machineName = useWindowMachine()?.name ?? "";
  return (
    <PaddedTab bare>
      {tab.key === PAGES_KEY ? (
        <PageList
          source={source}
          machineName={machineName}
          onOpen={(page, title) =>
            host.openTab({
              key: `${PAGE_PREFIX}${page}`,
              kind: "page-view",
              title,
            })
          }
        />
      ) : (
        <PageView
          source={source}
          tab={tab.key.slice(PAGE_PREFIX.length)}
          machineName={machineName}
        />
      )}
    </PaddedTab>
  );
}

export const pageViewKind: TabKindDef = {
  kind: "page-view",
  labelKey: "machines.page.kind",
  icon: browserIcons.globe,
  render: (tab, _active, host) => <PageViewTab tab={tab} host={host} />,
};
