// 탭 머리와 왼쪽 sidebar 세션 줄의 브랜치 꼬리표. MachineTag 옆에 선다. 누르기는 탭 바꾸기를 막지 않는다(그냥 글이다).
import { t } from "@lophn/i18n";
import { Tooltip } from "@lophn/ui/overlay";
import { Icon } from "@lophn/ui/primitives";
import { sourceControlIcons } from "../../icons/mod.ts";
import styles from "./branch-tag.module.css";

export interface BranchTagInfo {
  /** 브랜치 이름(없으면 `detached @ <sha7>`). */
  readonly branch: string;
  /** worktree label. 원래 폴더면 없다. */
  readonly label?: string;
  /** 체크아웃 경로. */
  readonly path?: string;
  readonly dirty?: boolean;
}

export function BranchTag({
  info,
  className,
}: {
  info: BranchTagInfo | null | undefined;
  className?: string;
}) {
  if (info === null || info === undefined) return null;
  const lines = [
    info.branch,
    ...(info.label === undefined || info.label === info.branch
      ? []
      : [info.label]),
    ...(info.path === undefined ? [] : [info.path]),
    ...(info.dirty === true ? [t("worktree.label.branch-tag-dirty")] : []),
  ];
  return (
    <Tooltip
      content={
        <span className={styles.tip}>
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      }
    >
      <span
        className={
          className === undefined ? styles.tag : `${styles.tag} ${className}`
        }
        data-branch-tag={info.branch}
      >
        <Icon icon={sourceControlIcons.branch} pixels={10} />
        <span className={styles.text}>{info.branch}</span>
      </span>
    </Tooltip>
  );
}
