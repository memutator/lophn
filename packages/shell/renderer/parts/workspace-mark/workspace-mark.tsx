import { componentMark } from "@lophn/ui/shared";
import type { ReactElement } from "react";
import {
  IconImage,
  lucideNameOf,
  useDrawableIcon,
} from "../icon-upload/icon-image.tsx";
import styles from "./workspace-mark.module.css";

export interface WorkspaceMarkProps {
  readonly kind: "project" | "app";
  /** 색을 정하는 값. 이름을 바꿔도 색이 그대로이도록 id를 준다. */
  readonly id: string;
  readonly name: string;
  /** 이미지 src(favicon 등)나 `lucide:<이름>`. 있으면 배경 없이 그것만, 없거나 못 읽으면 첫 글자와 색 배경이다. */
  readonly icon?: string;
}

const TONES = 8;

// 같은 id는 늘 같은 색이다. 저장하지 않고 id에서 계산한다.
function toneOf(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash % TONES;
}

/** project(둥근 사각형)와 app(원)의 표식. 런처 카드와 workspace switcher 목록이 같이 쓴다. */
export function WorkspaceMark({
  kind,
  id,
  name,
  icon,
}: WorkspaceMarkProps): ReactElement {
  // 이 shell의 lucide에 없는 이름이면 icon이 없는 것처럼 첫 글자 표식이다.
  const shown = useDrawableIcon(icon);
  return (
    <span
      className={styles.mark}
      data-kind={kind}
      // 이미지가 있으면 tone 색을 두지 않는다(tone 규칙이 투명 배경을 덮는다).
      data-tone={shown === undefined ? toneOf(id) : undefined}
      data-image={shown === undefined ? undefined : ""}
      data-lucide={
        shown !== undefined && lucideNameOf(shown) !== null ? "" : undefined
      }
      aria-hidden="true"
      {...componentMark("WorkspaceMark")}
    >
      {shown === undefined ? (
        [...name][0]?.toUpperCase()
      ) : (
        <IconImage src={shown} size="100%" className={styles.image} />
      )}
    </span>
  );
}
