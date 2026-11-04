// project sidebar의 Artifacts 쪽. 탭이 그려질 때 한 번 목록을 읽고, 폴더 변경은 따라가지 않는다(다시 보일 때 읽는다).
import { t } from "@lophn/i18n";

import { artifactIcons } from "../../icons/mod.ts";
import { useArtifactList } from "../../artifact/use-artifact-list.ts";
import {
  PanelEmpty,
  PanelRow,
  PanelRows,
  TileIcon,
} from "../../shell/panel-rows.tsx";

export function ArtifactPanel({
  project,
  onOpen,
}: {
  project: string;
  onOpen: (name: string) => void;
}) {
  const { items } = useArtifactList({ kind: "project", id: project });
  if (items.length === 0) {
    return <PanelEmpty>{t("artifact.empty.none")}</PanelEmpty>;
  }
  return (
    <PanelRows label={t("artifact.label.list")}>
      {items.map((item) => (
        <PanelRow
          key={item.name}
          data-artifact={item.name}
          leading={<TileIcon icon={artifactIcons.kind} />}
          title={item.title}
          tag={item.name}
          meta={item.description}
          onClick={() => onOpen(item.name)}
        />
      ))}
    </PanelRows>
  );
}
