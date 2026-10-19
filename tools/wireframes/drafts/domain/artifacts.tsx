// Artifacts 목록이 domain 단위가 되는 두 모양과 domain이 하나뿐일 때. 줄 모양은 renderer의 artifact-panel과 같은 CSS를 쓴다.
import { useState } from "react";
import { Icon } from "@lophn/ui/primitives";
import { Field, Select } from "@lophn/ui/input";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import {
  artifactIcons,
  commonIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";
import rowStyles from "../../../../packages/shell/renderer/workspace/sidebar/artifact-panel.module.css";
import {
  DOMAIN_ARTIFACTS,
  type DomainArtifact,
  PROJECT_DOMAINS,
} from "../../mock/domain/data.ts";
import {
  DraftProjectWindow,
  DraftSidebar,
  SIDEBAR_KEYS,
} from "./project-frame.tsx";
import styles from "./domain.module.css";

const titleOf = (name: string) =>
  PROJECT_DOMAINS.find((domain) => domain.name === name)?.title ?? name;

function Row({ item, badge }: { item: DomainArtifact; badge?: boolean }) {
  return (
    <li>
      <button type="button" className={rowStyles.row} data-artifact={item.name}>
        <span className={rowStyles.icon}>
          <Icon icon={artifactIcons.kind} pixels={iconPixels("base")} />
        </span>
        <span className={rowStyles.text}>
          <span className={rowStyles.head}>
            <span className={rowStyles.title}>{item.title}</span>
            <span className={rowStyles.name}>{item.name}</span>
            {badge === true
              ? <span className={styles.badge}>{titleOf(item.domain)}</span>
              : null}
          </span>
          <span className={rowStyles.desc}>{item.description}</span>
        </span>
      </button>
    </li>
  );
}

function Rows(
  { items, badge }: { items: readonly DomainArtifact[]; badge?: boolean },
) {
  return (
    <ul className={rowStyles.rows} aria-label={t("artifact.label.list")}>
      {items.map((item) => <Row key={item.name} item={item} badge={badge} />)}
    </ul>
  );
}

/** A: domain 제목 아래 묶음(접기 가능). docs는 접혀 있다. */
function Grouped() {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set(["docs"]));
  return (
    <>
      {PROJECT_DOMAINS.map((domain) => {
        const items = DOMAIN_ARTIFACTS.filter((item) =>
          item.domain === domain.name
        );
        const folded = closed.has(domain.name);
        return (
          <section key={domain.name} className={styles.group}>
            <button
              type="button"
              className={styles.groupHead}
              aria-expanded={!folded}
              onClick={() => {
                const next = new Set(closed);
                if (!next.delete(domain.name)) next.add(domain.name);
                setClosed(next);
              }}
            >
              <Icon
                icon={folded ? commonIcons.expand : commonIcons.collapse}
                pixels={iconPixels("small")}
              />
              {domain.title}
              <span className={styles.groupCount}>{items.length}</span>
            </button>
            {folded ? null : <Rows items={items} />}
          </section>
        );
      })}
    </>
  );
}

/** B: 한 목록에 domain 배지와 위쪽 domain 선택. */
function Flat() {
  const [domain, setDomain] = useState("all");
  const items = domain === "all"
    ? DOMAIN_ARTIFACTS
    : DOMAIN_ARTIFACTS.filter((item) => item.domain === domain);
  return (
    <>
      <div className={styles.filter}>
        <Field label={t("domain.label.filter")}>
          <Select
            size="sm"
            value={domain}
            onValueChange={setDomain}
            options={[
              { value: "all", label: t("domain.label.all-domains") },
              ...PROJECT_DOMAINS.map((one) => ({
                value: one.name,
                label: one.title,
              })),
            ]}
          />
        </Field>
      </div>
      <Rows items={items} badge />
    </>
  );
}

export function ArtifactsPage({ variant }: { variant: "a" | "b" | "single" }) {
  return (
    <DraftProjectWindow
      sidebar={
        <DraftSidebar keys={SIDEBAR_KEYS} selected="artifact">
          {variant === "a" ? <Grouped /> : null}
          {variant === "b" ? <Flat /> : null}
          {variant === "single"
            ? (
              <Rows
                items={DOMAIN_ARTIFACTS.filter((item) =>
                  item.domain === "eval"
                )}
              />
            )
            : null}
        </DraftSidebar>
      }
    />
  );
}
