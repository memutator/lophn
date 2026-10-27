import { useCallback, useState } from "react";

// 값을 주면 caller가 상태를 갖고(controlled), 주지 않으면 component가 기본값에서 시작해 갖는다.
export function useControllable<T>(
  value: T | undefined,
  initial: T,
  onChange: ((next: T) => void) | undefined,
): [T, (next: T) => void] {
  const [own, setOwn] = useState(initial);
  const controlled = value !== undefined;
  const set = useCallback(
    (next: T) => {
      if (!controlled) setOwn(next);
      onChange?.(next);
    },
    [controlled, onChange],
  );
  return [controlled ? value : own, set];
}
