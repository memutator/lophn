// pane 안의 artifact 탭 하나: 탭 줄, toolbar, page 영역. 탭 줄은 renderer의 TabStrip이고 toolbar와 page 영역은 새 모양이다.
// page 영역은 `lophn-artifact:` 문서가 들어갈 native view 자리라서 gallery에는 고정 그림이 들어간다.
import type { ReactNode } from "react";
import { Button } from "@lophn/ui/primitives";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import { TabStrip } from "../../../../packages/shell/renderer/parts/tab-strip/tab-strip.tsx";
import { editorIcons } from "../../../../packages/shell/renderer/icons/mod.ts";
import { artifactIcons } from "./icons.ts";
import styles from "./artifact.module.css";

export interface ArtifactTabProps {
  /** 탭 줄에 보이는 이름. page의 `<title>`, 없으면 폴더 이름이다. */
  readonly title: string;
  /** toolbar에서 제목 옆에 흐리게 보이는 신원(폴더 이름, 사람의 파일이면 파일 이름). */
  readonly name: string;
  /** 사람의 폴더에 있는 파일을 열었을 때 root를 알리는 글. */
  readonly rootNote?: string;
  readonly annotateOn?: boolean;
  /** 폴더가 없는 탭. 단추가 꺼진다. */
  readonly missing?: boolean;
  /** page 영역 위에 얹는 것(toast, 모은 목록 panel). */
  readonly overlay?: ReactNode;
  readonly children: ReactNode;
}

export function ArtifactTab(
  {
    title,
    name,
    rootNote,
    annotateOn = false,
    missing = false,
    overlay,
    children,
  }: ArtifactTabProps,
) {
  return (
    <div className={styles.pane}>
      <TabStrip
        tabs={[{
          key: "artifact",
          title,
          icon: <Icon icon={artifactIcons.kind} pixels={iconPixels("small")} />,
        }]}
        selected="artifact"
        onClose={() => {}}
      />
      <div className={styles.toolbar} data-artifact-toolbar="">
        <span className={styles.heading}>
          <span className={styles.headTitle}>
            <span className={styles.title}>{title}</span>
            <span className={styles.name}>{name}</span>
          </span>
          {rootNote === undefined
            ? null
            : <span className={styles.rootNote}>{rootNote}</span>}
        </span>
        <span className={styles.actions}>
          <Button
            size="sm"
            variant="ghost"
            icon={artifactIcons.editSource}
            disabled={missing}
          >
            {t("artifact.button.edit-source")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={editorIcons.edit}
            aria-pressed={annotateOn}
            disabled={missing}
          >
            {t("artifact.button.annotate")}
          </Button>
        </span>
      </div>
      <div className={styles.region} data-artifact-region="">
        <div className={styles.column}>{children}</div>
        {overlay}
      </div>
    </div>
  );
}
