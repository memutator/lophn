// page-view 탭 kind. 다른 기계의 browser page를 이 창의 탭으로 보고 다룬다(`browser-tab.md` "멀리서 보기"). 탭이 기계(`tab.machine`)를
// 든다: 목록 탭은 key `pages-<기계>`로 기계마다 하나이고, 목록에서 고른 page는 key `page-view-<기계>-<page>`의 탭이다(key가 기계를
// 건너 겹치지 않는다). 본문은 탭의 범위(TabScope) 안에서 그 기계의 core로 `page_view/*`를 부른다. page id는 그 기계 core의 것이고
// agent가 닫으면 사라지므로 fromStored·toStored가 없다. 이 컴퓨터의 agent page는 browser 탭이라 새 탭 menu가 다른 기계마다만 연다.
import { useCallback, useMemo } from "react";
import { t } from "@lophn/i18n";

import { corePageViewSource } from "../../browser/page-view/core-source.ts";
import { PageList } from "../../browser/page-view/page-list.tsx";
import { PageView } from "../../browser/page-view/page-view.tsx";
import { useEventClient } from "../../desktop/connection/events/hooks.tsx";
import {
  machineItemOf,
  useMachinesView,
} from "../../desktop/machines/context.tsx";
import { browserIcons } from "../../icons/mod.ts";
import type { TabItem } from "../model.ts";
import { PaddedTab } from "../padded-tab.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

/** 그 기계의 page 목록 탭을 연다. 이미 열려 있으면 고르기만 한다. */
export function openPages(host: TabHost, machine: string): void {
  host.openTab({
    key: `pages-${machine}`,
    kind: "page-view",
    title: t("machines.page.kind"),
    machine,
  });
}

/** 그 기계의 page 하나를 탭으로 연다. 이미 열려 있으면 고르기만 한다. 제목은 page를 읽으면 그 page의 제목이 된다. */
export function openPage(
  host: TabHost,
  machine: string | null,
  page: string,
  title: string = t("machines.page.kind"),
): void {
  host.openTab({
    key: `page-view-${machine}-${page}`,
    kind: "page-view",
    title,
    ...(machine === null ? {} : { machine }),
    fields: { page },
  });
}

function PageViewTab({ tab, host }: { tab: TabItem; host: TabHost }) {
  const client = useEventClient();
  const source = useMemo(() => corePageViewSource(client.core), [client]);
  const machine = tab.machine ?? host.machine;
  const view = useMachinesView();
  const machineName = machine === null ? "" : machineItemOf(view, machine).name;
  const page = tab.fields?.page;
  // page 탭의 이름은 그 page의 제목을 따라간다.
  const onTitle = useCallback(
    (title: string) => {
      if (title !== tab.title) host.patchTab(tab.key, { title });
    },
    [host, tab.key, tab.title],
  );
  return (
    <PaddedTab bare>
      {typeof page !== "string" ? (
        <PageList
          source={source}
          machineName={machineName}
          onOpen={(opened, title) => openPage(host, machine, opened, title)}
        />
      ) : (
        <PageView
          source={source}
          tab={page}
          machineName={machineName}
          onTitle={onTitle}
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
