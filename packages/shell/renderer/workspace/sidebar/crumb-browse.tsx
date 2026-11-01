// card 머리 경로의 한 조각을 눌렀을 때 뜨는 popover 안의 파일 tree. Explorer의 읽기(useFileTree)와 줄(Row)을 그대로 쓰고,
// 폴더는 그 자리에서 펼치고 접으며 파일은 Explorer처럼 연다. Popover 안에서만 mount되어 열 때마다 새로 읽는다.
import { useEffect } from "react";

import type { WorkspaceSource } from "../source.ts";
import { Row } from "./explorer-row.tsx";
import { type FileRow, useFileTree } from "./use-file-tree.ts";
import styles from "./crumb-browse.module.css";
import treeStyles from "./explorer.module.css";

const noop = () => {};

export function CrumbBrowse({
  source,
  dir,
  current,
  onOpenFile,
}: {
  source: WorkspaceSource;
  /** 보여 줄 폴더(절대 경로). */
  dir: string;
  /** 지금 탭의 파일. 그쪽 길을 펼치고 고른다. */
  current: string;
  /** keep이면 고정 탭, 아니면 preview 탭. 연 뒤 닫는 일은 부르는 쪽이 한다. */
  onOpenFile: (path: string, keep?: boolean) => void;
}) {
  const tree = useFileTree(source, dir);
  useEffect(() => {
    tree.reveal(current);
  }, [current]);
  const activate = (row: FileRow, keep = false) => {
    if (row.folder) tree.toggle(row.id);
    else onOpenFile(row.id, keep);
  };
  return (
    <div className={`${treeStyles.tree} ${styles.panel}`} role="tree">
      {tree.rows.map((row) => (
        <Row
          key={row.id}
          row={row}
          current={row.id === current}
          selected={false}
          dropping={false}
          tabStop
          onActivate={activate}
          onSelect={noop}
          onMenu={noop}
          onDragStart={(_, event) => event.preventDefault()}
          onDragOver={noop}
          onDrop={noop}
          onDragEnd={noop}
        />
      ))}
    </div>
  );
}
