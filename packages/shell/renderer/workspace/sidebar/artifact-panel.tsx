// project·앱 sidebar의 Artifacts 쪽. 탭이 그려질 때 한 번 목록을 읽고, 폴더 변경은 따라가지 않는다(다시 보일 때 읽는다).
// 지우기는 줄에 마우스를 올리거나 focus가 들어올 때 보이는 휴지통이고, 확인 dialog를 거친다.

import { t } from "@lophn/i18n";
import { Dialog, Tooltip } from "@lophn/ui/overlay";
import { IconButton } from "@lophn/ui/primitives";
import { useState } from "react";

import type { CleanUpMode } from "../../../../protocol/base/follow-ups.ts";
import type { ArtifactListItem } from "../../../ipc/artifact.ts";
import { useArtifactApi } from "../../artifact/artifact-api.tsx";
import { useArtifactList } from "../../artifact/use-artifact-list.ts";
import { useScopeMachine } from "../../desktop/machines/context.tsx";
import { actionIcons, artifactIcons } from "../../icons/mod.ts";
import {
  CascadeDeleteActions,
  CascadeImpactDetails,
  useImpact,
  useOpenHandoffSession,
} from "../../shell/cascade-delete-confirm.tsx";
import {
  PanelEmpty,
  PanelRow,
  PanelRows,
  TileIcon,
} from "../../shell/panel-rows.tsx";
import styles from "./artifact-panel.module.css";

export function ArtifactPanel({
  workspace,
  onOpen,
}: {
  workspace: { readonly kind: "project" | "app"; readonly id: string };
  onOpen: (name: string) => void;
}) {
  const api = useArtifactApi();
  const remote = useScopeMachine() !== null;
  const openHandoff = useOpenHandoffSession();
  const { items, reload } = useArtifactList(workspace);
  const [target, setTarget] = useState<ArtifactListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const impact = useImpact(
    target === null ? null : { kind: "artifact", workspace, name: target.name },
  );

  async function remove(item: ArtifactListItem, cleanUp: CleanUpMode) {
    if (api === null) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await api.delete(
        workspace.kind === "app"
          ? { app: workspace.id, name: item.name, clean_up: cleanUp }
          : { project: workspace.id, name: item.name, clean_up: cleanUp },
      );
      setTarget(null);
      reload();
      openHandoff(result?.handoff_session);
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
              {...(remote
                ? {}
                : {
                    hoverTrailing: true,
                    trailing: (
                      <Tooltip content={label}>
                        <IconButton
                          icon={actionIcons.delete}
                          label={label}
                          size="sm"
                          data-action="delete-artifact"
                          onClick={() => setTarget(item)}
                        />
                      </Tooltip>
                    ),
                  })}
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
            <CascadeDeleteActions
              report={impact.report}
              loading={impact.loading}
              busy={busy}
              confirmLabel={t("artifact.button.delete")}
              confirmAction="confirm-delete-artifact"
              onCancel={cancel}
              onConfirm={(cleanUp) => void remove(target, cleanUp)}
            />
          }
        >
          <div className={styles.body}>
            <p className={styles.text}>{t("artifact.dialog.delete-text")}</p>
            <CascadeImpactDetails
              report={impact.report}
              loading={impact.loading}
            />
            {failed ? (
              <p className={styles.failure} role="alert">
                {t("artifact.error.delete-failed", { title: target.title })}
              </p>
            ) : null}
          </div>
        </Dialog>
      )}
    </>
  );
}
