import type { ReactNode } from "react";

import styles from "./provider-list.module.css";
import {
  VendorIcon,
  vendorOf,
} from "../../../parts/vendor-icon/vendor-icon.tsx";

/** provider 이름과 vendor 아이콘. 아이콘이 없는 이름(Custom provider)은 이름만 쓴다. */
export function ProviderName({ name }: { name: string }): ReactNode {
  const vendor = vendorOf(name);
  return (
    <span className={styles.name} data-provider-name="">
      {vendor === undefined ? null : <VendorIcon vendor={vendor} size={18} />}
      {name}
    </span>
  );
}
