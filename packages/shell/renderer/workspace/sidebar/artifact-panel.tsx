// project sidebar의 Artifacts 쪽. 탭이 그려질 때 한 번 목록을 읽고, 폴더 변경은 따라가지 않는다(다시 보일 때 읽는다).
// 지우기는 줄에 마우스를 올리거나 focus가 들어올 때 보이는 휴지통이고, 확인 dialog를 거친다.
import { useState } from "react";
import { t } from "@lophn/i18n";
import { Dialog, Tooltip } from "@lophn/ui/overlay";
import { Button, IconButton } from "@lophn/ui/primitives";

import type { ArtifactListItem } from "../../../ipc/artifact.ts";
import { useArtifactApi } from "../../artifact/artifact-api.tsx";
import { useArtifactList } from "../../artifact/use-artifact-list.ts";
import { actionIcons, artifactIcons } from "../../icons/mod.ts";
import {
  PanelEmpty,
  PanelRow,
  PanelRows,
  TileIcon,
} from "../../shell/panel-rows.tsx";
import styles from "./artifact-panel.module.css";

export function ArtifactPanel({
  project,
  onOpen,
}: {
  project: string;
  onOpen: (name: string) => void;
}) {
  const api = useArtifactApi();
  const { items, reload } = useArtifactList({ kind: "project", id: project });
  const [target, setTarget] = useState<ArtifactListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function remove(item: ArtifactListItem) {
    if (api === null) return;
    setBusy(true);
    setFailed(false);
    try {
      await api.delete({ project, name: item.name });
      setTarget(null);
      reload();
    } catch (error) {
      // 이미 없는 폴더면 목록만 맞추면 된다.
      if (error instanceof Error && error.message === "not_found") {
        setTarget(null);
        reload();
      } else setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const cancel = () => {
    if (busy) return;
    setTarget(null);
    setFailed(false);
  };

  if (items.length === 0) {
    return <PanelEmpty>{t("artifact.empty.none")}</PanelEmpty>;
  }
  return (
    <>
      <PanelRows label={t("artifact.label.list")}>
        {items.map((item) => {
          const label = t("artifact.button.delete-named", { name: item.title });
          return (
            <PanelRow
              key={item.name}
              data-artifact={item.name}
              leading={<TileIcon icon={artifactIcons.kind} />}
              title={item.title}
              tag={item.name}
              meta={item.description}
              hoverTrailing
              trailing={
                <Tooltip content={label}>
                  <IconButton
                    icon={actionIcons.delete}
                    label={label}
                    size="sm"
                    data-action="delete-artifact"
                    onClick={() => setTarget(item)}
                  />
                </Tooltip>
              }
              onClick={() => onOpen(item.name)}
            />
          );
        })}
      </PanelRows>
      {target === null ? null : (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) cancel();
          }}
          title={t("artifact.dialog.delete-title", { title: target.title })}
          actions={
            <>
              <Button disabled={busy} onClick={cancel}>
                {t("common.button.cancel")}
              </Button>
              <Button
                variant="danger"
                icon={actionIcons.delete}
                disabled={busy}
                data-action="confirm-delete-artifact"
                onClick={() => void remove(target)}
              >
                {t("artifact.button.delete")}
              </Button>
            </>
          }
        >
          <p className={styles.text}>{t("artifact.dialog.delete-text")}</p>
          {failed ? (
            <p className={styles.failure} role="alert">
              {t("artifact.error.delete-failed", { title: target.title })}
            </p>
          ) : null}
        </Dialog>
      )}
    </>
  );
}
