// 대화 안 오류 메시지. provider가 요청을 거절하는 등 server 요청이 실패하면 어떤 오류인지와 [Retry]가 대화에 남는다.
import { Button, StatusMark } from "@lophn/design/components";

import t from "./agent-tab.module.css";

export function ErrorMessage(
  { title, detail }: { title: string; detail: string },
) {
  return (
    <div className={t.error} role="alert">
      <div className={t.errorText}>
        <StatusMark tone="critical" label={title} />
        <p className={t.errorDetail}>{detail}</p>
      </div>
      <Button size="sm">Retry</Button>
    </div>
  );
}
