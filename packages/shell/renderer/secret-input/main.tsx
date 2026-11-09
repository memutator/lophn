import { useEffect, useState } from "react";

import type {
  SecretInputApi,
  SecretInputDisplay,
} from "../../ipc/secret-input.ts";
import { LoginRequestForm } from "./login-request-form.tsx";
import { SecretInput } from "./secret-input.tsx";

type Bridge = { lophnSecretInput?: SecretInputApi };

/**
 * 보호 preload가 연 API로 화면을 그린다. 표시할 것은 main이 읽어 주고, 값은 이 창에서 main으로
 * 한 번 가서 core로 올라간다. preload가 없으면 아무것도 그리지 않는다.
 */
export function SecretInputApp() {
  const api = (globalThis as unknown as Bridge).lophnSecretInput;
  const [display, setDisplay] = useState<SecretInputDisplay | null>(null);
  useEffect(() => {
    void api?.getDisplay().then(setDisplay, () => setDisplay(null));
  }, [api]);
  if (api === undefined || display === null) return null;
  if (display.request !== undefined) {
    return (
      <LoginRequestForm
        mode={display.request.mode}
        label={display.request.label}
        origin={display.subject}
        onSubmit={(input) => api.submit(input)}
        onCancel={() => void api.cancel()}
      />
    );
  }
  return (
    <SecretInput
      purpose={display.purpose}
      subject={display.subject}
      name={display.name}
      configured={display.configured}
      onSubmit={(value) => api.submit({ value })}
      onCancel={() => void api.cancel()}
    />
  );
}
