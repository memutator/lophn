import { useEffect, useState } from "react";
import { tokens } from "../../tokens.ts";
import { milliseconds, systemTimer, type Timer } from "../shared.ts";

// 첫 조회가 loading.delay 안에 끝나면 아무것도 보이지 않는다. 다시 loading이면 지연을 처음부터 잰다.
export function useDelayedLoading(
  loading: boolean,
  timer: Timer = systemTimer,
): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(false);
    if (!loading) return;
    const handle = timer.set(
      () => setShown(true),
      milliseconds(tokens.loading.delay),
    );
    return () => timer.clear(handle);
  }, [loading, timer]);
  return loading && shown;
}
