import { componentMark } from "@lophn/ui/shared";
import type { ReactElement } from "react";
import styles from "./place-mark.module.css";

export interface PlaceMarkProps {
  readonly kind: "project" | "app";
  /** 색을 정하는 값. 이름을 바꿔도 색이 그대로이도록 id를 준다. */
  readonly id: string;
  readonly name: string;
  /** 이미지 src(favicon 등). 없거나 못 읽으면 첫 글자와 색 배경이다. */
  readonly icon?: string;
}

const TONES = 8;

// 같은 id는 늘 같은 색이다. 저장하지 않고 id에서 계산한다.
function toneOf(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash % TONES;
}

/** project(둥근 사각형)와 app(원)의 표식. 런처 카드와 place switcher 목록이 같이 쓴다. */
export function PlaceMark({
  kind,
  id,
  name,
  icon,
}: PlaceMarkProps): ReactElement {
  return (
    <span
      className={styles.mark}
      data-kind={kind}
      data-tone={toneOf(id)}
      data-image={icon === undefined ? undefined : ""}
      aria-hidden="true"
      {...componentMark("PlaceMark")}
    >
      {icon === undefined ? (
        [...name][0]?.toUpperCase()
      ) : (
        <img className={styles.image} src={icon} alt="" />
      )}
    </span>
  );
}
