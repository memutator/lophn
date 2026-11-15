// 이 계기를 어느 기기에 알릴지. 조용히 빠뜨리거나 쏟아내기 쉬운 규칙이라 순수 함수 하나로 둔다. 지연은 없다(첫 판).
import {
  anyDesktopPresent,
  isPresent,
  type PresenceTable,
} from "./presence.ts";
import { buildMessage } from "./message.ts";
import type { PushDevice, PushMessage } from "./ports.ts";
import { CAUSE_ROW, type Cause } from "./triggers.ts";

export function decide(input: {
  cause: Cause;
  devices: readonly PushDevice[];
  presence: PresenceTable;
  now: number;
  host: string;
}): PushMessage[] {
  const { cause, presence, now } = input;
  const setting = CAUSE_ROW[cause.kind].setting;
  const desktopPresent = anyDesktopPresent(presence, now);
  const messages: PushMessage[] = [];
  for (const device of input.devices) {
    if (!device.prefs[setting]) continue;
    // 그 폰을 사람이 지금 보고 있으면 그 폰에는 보내지 않는다(다른 기기에는 보낸다).
    const own = presence.get(`device:${device.id}`);
    if (own !== undefined && isPresent(`device:${device.id}`, own, now)) {
      continue;
    }
    if (device.prefs.quiet_when_present && desktopPresent) continue;
    messages.push(buildMessage(cause, device, input.host));
  }
  return messages;
}
