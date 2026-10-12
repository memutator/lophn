import { useCallback, useEffect, useState } from "react";
import { Button } from "@lophn/design/components";
import { launcherIcons, workspaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import type { TrackingProject, TrackingSource } from "./source.ts";
import { TrackingDialog } from "./tracking-dialog.tsx";
import { NoticeCard } from "../notice-card.tsx";

export interface TrackingStripProps {
  project: string;
  source: TrackingSource;
  /** 추적이 켜졌다. 작업대가 문서 목록을 다시 읽는다. */
  onTracking?: () => void;
  /** 안내 카드를 닫는다. 작업대가 상단 바의 안내 단추로 다시 열게 한다. */
  onDismiss?: () => void;
}

// 추적 꺼짐 안내: 본문 자리를 쓰지 않는 떠 있는 카드와 [Turn on tracking]. 등록과
// 추적 켜기를 구별하고, 켜기는 미리보기를 본 뒤에만 한다(flow first-project 2~4단계).
export function TrackingStrip(
  { project, source, onTracking, onDismiss }: TrackingStripProps,
) {
  const [current, setCurrent] = useState<TrackingProject | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const read = await source.project(project);
    setCurrent(read.ok ? read.value : null);
  }, [project, source]);

  useEffect(() => {
    void load();
  }, [load]);

  if (current === null || current.tracking.enabled) return null;
  const noFolder = current.folders.length === 0;
  return (
    <>
      <NoticeCard
        data={{ "data-tracking": "off" }}
        icon={noFolder ? workspaceIcons.folder : launcherIcons.preview}
        text={t(
          noFolder
            ? "project-workspace.tracking.no-folder"
            : "project-workspace.tracking.off",
        )}
        onDismiss={onDismiss}
        actions={noFolder ? null : (
          <Button
            variant="primary"
            size="sm"
            data-turn-on-tracking=""
            onClick={() => setOpen(true)}
          >
            {t("project-workspace.button.turn-on-tracking")}
          </Button>
        )}
      />
      {open
        ? (
          <TrackingDialog
            project={current}
            source={source}
            onClose={() => setOpen(false)}
            onApplied={(applied) => {
              setOpen(false);
              setCurrent(applied);
              onTracking?.();
            }}
          />
        )
        : null}
    </>
  );
}
