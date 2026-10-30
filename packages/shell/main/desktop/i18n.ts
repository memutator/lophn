// main이 OS에 그리는 고정 문구(tray menu, 끄기 확인, 알림 제목). 값은 packages/design의 catalog를
// lophn 화면과 같은 `t`로 만든다.
import {
  type MessageKey,
  type MessageValues,
  t,
} from "../../../design/i18n/format.ts";

export type { MessageKey } from "../../../design/i18n/format.ts";

export function word(key: MessageKey, values?: MessageValues): string {
  return t(key, values);
}
