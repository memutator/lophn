// domain Drafts가 같이 쓰는 조각: 줄 menu, domain 줄(A), domain chip 줄(B), 새 domain dialog.
// 모두 design component(Menu, Button, Dialog, Field)로 그린다. 고르면 renderer로 옮긴다(`pages.tsx`의 표).
import { type ReactElement, useState } from "react";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";
import { Field, Input } from "@lophn/ui/input";
import {
  Dialog,
  Menu,
  MenuIcon,
  type MenuItem,
  Tooltip,
} from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import {
  commonIcons,
  editorIcons,
  workspaceIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";
import type {
  AppDomain,
  DomainRow,
  ProjectDomain,
} from "../../mock/domain/data.ts";
import styles from "./domain.module.css";

const noop = () => {};

/** 줄과 chip이 같이 쓰는 menu. lastOne이면 Archive가 꺼지고 이유를 tooltip으로 보인다. */
export function DomainMenu(
  { trigger, startOpen = false, lastOne = false }: {
    trigger: ReactElement;
    startOpen?: boolean;
    /** 앱의 마지막 domain이다. */
    lastOne?: boolean;
  },
) {
  const [open, setOpen] = useState(startOpen);
  const archive = t("domain.button.archive");
  const items: MenuItem[] = [
    {
      id: "doc",
      leading: <MenuIcon icon={workspaceIcons.document} />,
      label: t("domain.button.open-doc"),
    },
    {
      id: "archive",
      leading: <MenuIcon icon={commonIcons.archive} />,
      label: lastOne
        ? (
          <Tooltip
            open
            content={t("domain.notice.app-last")}
            placement="beside"
          >
            <span>{archive}</span>
          </Tooltip>
        )
        : archive,
      textValue: archive,
      disabled: lastOne,
    },
  ];
  return (
    <Menu
      trigger={trigger}
      items={items}
      onSelect={noop}
      open={open}
      onOpenChange={setOpen}
    />
  );
}

// Menu trigger가 ref와 event를 받아야 하므로 component가 아니라 요소를 돌려준다.
const rowMenuButton = (title: string) => (
  <IconButton
    icon={editorIcons.menu}
    label={t("domain.label.row-menu", { title })}
    size="sm"
  />
);

/** A: sidebar Domains 탭. 위쪽 [New domain]과 줄(이름, 한 줄 목적, 개수). 첫 줄의 menu를 열어 둔다. */
export function DomainList(
  { domains, onNew = noop, openFirst = false }: {
    domains: readonly ProjectDomain[];
    onNew?: () => void;
    openFirst?: boolean;
  },
) {
  return (
    <>
      <div className={styles.head}>
        <h2 className={styles.headLabel}>{t("domain.heading.list")}</h2>
        <Button size="sm" icon={commonIcons.add} onClick={onNew}>
          {t("domain.button.new")}
        </Button>
      </div>
      {domains.length === 0
        ? <p className={styles.empty}>{t("domain.empty.project")}</p>
        : (
          <ul className={styles.rows} aria-label={t("domain.heading.list")}>
            {domains.map((domain, at) => (
              <li key={domain.name} className={styles.row}>
                <span className={styles.rowText}>
                  <span className={styles.rowHead}>
                    <span className={styles.rowTitle}>{domain.title}</span>
                    <span className={styles.rowName}>{domain.name}</span>
                  </span>
                  <span className={styles.rowLine}>{domain.purpose}</span>
                  <span className={styles.rowLine}>
                    {t("domain.label.counts", {
                      kinds: domain.kinds,
                      skills: domain.skills,
                      artifacts: domain.artifacts,
                    })}
                  </span>
                </span>
                <span className={styles.rowAction}>
                  <DomainMenu
                    startOpen={openFirst && at === 0}
                    trigger={rowMenuButton(domain.title)}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
    </>
  );
}

/** B와 앱 A: domain chip 줄. chip 하나가 domain 하나이고 끝에 + chip이 있다. chip을 누르면 menu가 열린다. */
export function DomainChips(
  { domains, bar = false, openFirst = false, onNew = noop }: {
    domains: readonly DomainRow[];
    /** 앱 위쪽 바 안의 모양(여백 없음). */
    bar?: boolean;
    openFirst?: boolean;
    onNew?: () => void;
  },
) {
  return (
    <div
      className={`${styles.chips} ${bar ? styles.chipsBar : ""}`}
      role="group"
      aria-label={t("domain.heading.list")}
    >
      {domains.map((domain, at) => (
        <DomainMenu
          key={domain.name}
          startOpen={openFirst && at === 0}
          trigger={
            <button type="button" className={styles.chip}>
              {domain.title}
              <Icon
                icon={editorIcons.detailsClosed}
                pixels={iconPixels("small")}
              />
            </button>
          }
        />
      ))}
      <Tooltip content={t("domain.button.add")}>
        <button
          type="button"
          className={`${styles.chip} ${styles.chipAdd}`}
          aria-label={t("domain.button.add")}
          onClick={onNew}
        >
          <Icon icon={commonIcons.add} pixels={iconPixels("small")} />
        </button>
      </Tooltip>
    </div>
  );
}

/** 앱 B: 앱 상세 패널의 Domains 절. 줄마다 tool 수와 public tool 수. */
export function AppDomainsSection(
  { domains, openFirst = false, lastOne = false }: {
    domains: readonly AppDomain[];
    openFirst?: boolean;
    lastOne?: boolean;
  },
) {
  return (
    <section className={styles.section} aria-label={t("domain.heading.list")}>
      <div className={styles.sectionHead}>
        <h4 className={styles.sectionLabel}>{t("domain.heading.list")}</h4>
        <Button size="sm" icon={commonIcons.add}>
          {t("domain.button.new")}
        </Button>
      </div>
      <div>
        {domains.map((domain, at) => (
          <div key={domain.name} className={styles.toolRow}>
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>{domain.title}</span>
              <span className={styles.rowName}>{domain.name}</span>
            </span>
            <span className={styles.toolCounts}>
              {t("domain.label.tool-counts", {
                tools: domain.tools,
                shared: domain.shared,
              })}
            </span>
            <span className={styles.rowAction}>
              <DomainMenu
                startOpen={openFirst && at === 0}
                lastOne={lastOne}
                trigger={rowMenuButton(domain.title)}
              />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** [New domain] dialog. name은 slug, title, 목적 한 줄이다. A와 B가 같다. */
export function NewDomainDialog({ open = true }: { open?: boolean }) {
  const [shown, setShown] = useState(open);
  return (
    <Dialog
      open={shown}
      onOpenChange={setShown}
      title={t("domain.title.create")}
      actions={
        <>
          <Button onClick={() => setShown(false)}>
            {t("common.button.cancel")}
          </Button>
          <Button variant="primary">{t("domain.button.create")}</Button>
        </>
      }
    >
      <div className={styles.form}>
        <Field label={t("domain.label.name")} help={t("domain.note.name-help")}>
          <Input defaultValue="eval" />
        </Field>
        <Field label={t("domain.label.title")}>
          <Input defaultValue="Eval" />
        </Field>
        <Field
          label={t("domain.label.purpose")}
          help={t("domain.note.purpose-help")}
        >
          <Input defaultValue="Experiments, rubrics and scenario runs for the query tools." />
        </Field>
      </div>
    </Dialog>
  );
}
