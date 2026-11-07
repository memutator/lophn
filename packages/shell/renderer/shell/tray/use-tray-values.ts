// 앱이 낸 tray 값. 값은 core 메모리에만 있어 event는 "바뀌었다"만 알리고 목록을 다시 읽는다.
// 창이 뜰 때와 core가 다시 붙을 때도 ready로 읽는다.
import { useEffect, useState } from "react";

import { appTrayList, type TrayValue } from "../../../../protocol/apps/tray.ts";
import { useEventClient } from "../../desktop/connection/events/hooks.tsx";

export function useTrayValues(): readonly TrayValue[] {
  const client = useEventClient();
  const [values, setValues] = useState<readonly TrayValue[]>([]);
  useEffect(() => {
    // 늦게 온 옛 읽기가 새 값을 덮지 않게 한다.
    let latest = 0;
    const read = async () => {
      const mine = ++latest;
      const reply = await client.core
        .call({
          kind: "memory",
          resource: appTrayList.resource,
          method: appTrayList.method,
          body: {},
        })
        .catch(() => null);
      if (mine !== latest || !reply?.ok) return;
      const parsed = appTrayList.output.safeParse(reply.value);
      if (parsed.success) setValues(parsed.data.values);
    };
    return client.subscribe({ types: ["AppTrayChanged"] }, (message) => {
      if (message.kind !== "disconnected") void read();
    });
  }, [client]);
  return values;
}
