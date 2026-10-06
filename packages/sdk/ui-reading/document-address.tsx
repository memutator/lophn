import { t } from "@lophn/wording";
import {
  type Clipboard,
  CopyButton,
  systemClipboard,
} from "@lophn/design/components";
import styles from "./reading.module.css";

export interface DocumentAddressProps {
  // 문서 주소 전체(예: mahas/weekly-report#summary@3). 줄이지 않고 그대로 보인다.
  address: string;
  clipboard?: Clipboard;
}

// 문서 주소를 code 글꼴로 보이고 그대로 복사한다. 긴 주소는 자르지 않고 줄을 바꾼다.
export function DocumentAddress(
  { address, clipboard = systemClipboard }: DocumentAddressProps,
) {
  return (
    <span className={styles.address} data-address="">
      <code className={styles.value}>{address}</code>
      <CopyButton
        text={address}
        label={t("common.button.copy-address")}
        clipboard={clipboard}
      />
    </span>
  );
}
