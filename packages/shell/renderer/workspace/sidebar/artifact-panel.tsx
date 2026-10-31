// project sidebar의 Artifacts 쪽. 탭이 그려질 때 한 번 목록을 읽고, 폴더 변경은 따라가지 않는다(다시 보일 때 읽는다).
// domain이 둘 이상이면 domain 제목 아래 접을 수 있는 묶음이고, 하나뿐이면 묶음 없이 한 줄 목록이다.
import { useState } from "react";
import { t } from "@lophn/i18n";

import { artifactIcons } from "../../icons/mod.ts";
import {
  type DomainArtifactItem,
  useArtifactList,
} from "../../artifact/use-artifact-list.ts";
import {
  PanelEmpty,
  PanelRow,
  PanelRows,
  PanelSection,
  TileIcon,
} from "../../shell/panel-rows.tsx";
import type { DomainView } from "../source.ts";

function Rows({
  items,
  onOpen,
}: {
  items: readonly DomainArtifactItem[];
  onOpen: (domain: string, name: string) => void;
}) {
  return (
    <PanelRows label={t("artifact.label.list")}>
      {items.map((item) => (
        <PanelRow
          key={`${item.domain}/${item.name}`}
          data-artifact={item.name}
          leading={<TileIcon icon={artifactIcons.kind} />}
          title={item.title}
          tag={item.name}
          meta={item.description}
          onClick={() => onOpen(item.domain, item.name)}
        />
      ))}
    </PanelRows>
  );
}

export function ArtifactPanel({
  domains,
  onOpen,
}: {
  domains: readonly DomainView[];
  onOpen: (domain: string, name: string) => void;
}) {
  const { items } = useArtifactList(domains.map((domain) => domain.id));
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  if (items.length === 0) {
    return <PanelEmpty>{t("artifact.empty.none")}</PanelEmpty>;
  }
  if (domains.length <= 1) return <Rows items={items} onOpen={onOpen} />;
  return (
    <>
      {domains.map((domain) => {
        const own = items.filter((item) => item.domain === domain.id);
        return (
          <PanelSection
            key={domain.id}
            data-section={domain.name}
            title={domain.title}
            count={own.length}
            folded={folded.has(domain.id)}
            onToggle={() => {
              const next = new Set(folded);
              if (!next.delete(domain.id)) next.add(domain.id);
              setFolded(next);
            }}
          >
            {own.length === 0 ? (
              <PanelEmpty>{t("artifact.empty.none")}</PanelEmpty>
            ) : (
              <Rows items={own} onOpen={onOpen} />
            )}
          </PanelSection>
        );
      })}
    </>
  );
}
