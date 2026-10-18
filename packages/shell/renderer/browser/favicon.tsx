// page favicon. main이 받아 data URL로 바꾼 것만 온다(shell CSP는 img-src data:만 받는다). 없으면 Globe다.
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";

import { browserIcons } from "../icons/mod.ts";
import styles from "./bookmark.module.css";

export function Favicon({ src }: { src?: string }) {
  const pixels = iconPixels("small");
  if (src === undefined || src === "") {
    return <Icon icon={browserIcons.globe} pixels={pixels} />;
  }
  return (
    <img
      className={styles.favicon}
      src={src}
      alt=""
      width={pixels}
      height={pixels}
    />
  );
}
