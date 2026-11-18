// 다른 기계의 page 목록 탭 본문. 그 기계의 core가 아는 browser 탭(agent가 연 탭과 사람이 연 탭)을 제목, 주소, 연 쪽으로
// 보이고, 누르면 그 page의 탭을 연다. 다룰 수 있는 기기면 위에 새 page를 여는 주소 칸이 선다. 목록은
// `StateChanged{browser_pages}`에 다시 읽는다.
import { useState } from "react";
import { List, ListItem } from "@lophn/ui/data";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { Toast } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import { useFollowedRead } from "../../desktop/connection/core-read.ts";
import { useMachineGrant } from "../../desktop/machines/context.tsx";
import { actionIcons } from "../../icons/mod.ts";
import { AddressInput, withScheme } from "./address-input.tsx";
import styles from "./page-view.module.css";
import type { PageViewSource } from "./source.ts";

export function PageList({
  source,
  machineName,
  onOpen,
}: {
  source: PageViewSource;
  machineName: string;
  /** page 하나의 탭을 연다. */
  onOpen(tab: string, title: string): void;
}) {
  const { loaded, reload } = useFollowedRead(
    () => source.list(),
    ["browser_pages"],
    "",
  );
  // page 열기는 `page_view/control`처럼 그 기계가 이 컴퓨터에 터미널 입력을 허락했어야 한다.
  const grant = useMachineGrant();
  const [address, setAddress] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const name = { name: machineName };

  const open = async () => {
    const url = withScheme(address);
    if (url === "") return;
    const opened = await source.open(url);
    if (!opened.ok) {
      setNotice(t("machines.page.error.open", name));
      return;
    }
    setAddress("");
    onOpen(opened.value, url);
  };

  if (loaded.state === "failed") {
    return (
      <ErrorState target={t("machines.page.target", name)} onRetry={reload} />
    );
  }
  const pages = loaded.state === "ready" ? loaded.value : [];
  return (
    <div className={styles.page} data-page-list="">
      <h1 className={styles.title}>{t("machines.page.title", name)}</h1>
      {notice === null ? null : (
        <div className={styles.toastSlot}>
          <Toast title={notice} tone="error" onClose={() => setNotice(null)} />
        </div>
      )}
      {grant === "granted" ? (
        <div className={styles.open} data-page-open="">
          <AddressInput
            value={address}
            label={t("machines.page.open-label", name)}
            placeholder={t("machines.page.open-placeholder", name)}
            onChange={setAddress}
            onSubmit={() => void open()}
          />
          <Button
            size="sm"
            icon={actionIcons.open}
            disabled={address.trim() === ""}
            onClick={() => void open()}
          >
            {t("machines.page.open")}
          </Button>
        </div>
      ) : grant === "denied" ? (
        <p className={styles.line} data-page-view-only="">
          {t("machines.page.view-only", name)}
        </p>
      ) : null}
      <Loading
        loading={loaded.state === "loading"}
        placeholder={<Skeleton lines={3} />}
      >
        {pages.length === 0 ? (
          <p className={styles.emptyLine}>{t("machines.page.empty", name)}</p>
        ) : (
          <List>
            {pages.map((page) => {
              const title = page.title || t("machines.page.untitled");
              return (
                <ListItem
                  key={page.tab}
                  title={title}
                  meta={`${page.url} · ${
                    page.by === null
                      ? t("machines.page.by-you")
                      : t("machines.page.by-agent", { agent: page.by })
                  }`}
                  onSelect={() => onOpen(page.tab, title)}
                />
              );
            })}
          </List>
        )}
      </Loading>
    </div>
  );
}
