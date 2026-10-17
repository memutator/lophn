import { useCallback, useEffect, useRef, useState } from "react";
import type { Clipboard } from "../../_shared/shared.ts";

export interface CopyState {
  // 마지막 복사가 실패했으면 true. 다음 성공에서 지운다.
  failed: boolean;
  copy(text: string): void;
}

// 복사 실패(sync throw와 rejection 모두)를 상태로 바꿔 화면에 보이고 같은 버튼으로 다시 시도하게 한다.
// unmount 뒤나 더 새로운 시도가 있은 뒤에 끝난 결과는 상태를 바꾸지 않는다.
export function useCopy(clipboard: Clipboard): CopyState {
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  const attempt = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const copy = useCallback((text: string) => {
    const id = ++attempt.current;
    const settle = (ok: boolean) => {
      if (mounted.current && id === attempt.current) setFailed(!ok);
    };
    let pending: Promise<void>;
    try {
      pending = Promise.resolve(clipboard.writeText(text));
    } catch {
      settle(false);
      return;
    }
    pending.then(() => settle(true), () => settle(false));
  }, [clipboard]);
  return { failed, copy };
}
