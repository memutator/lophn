import { createLedgerHarness } from "../../../../../apps/core/testing/ledger.ts";
import { machineCredential, RUN_NOW, userCredential } from "./runs.ts";

// run ledger 테스트가 함께 여는 실제 임시 ledger(등록 executor와 임시 파일). 실제
// provider는 부르지 않는다. harness는 *_test.ts만 import할 수 있어 여는 일은 여기 둔다.
export async function openRunLedger() {
  const opened = await createLedgerHarness({
    registrationModules: [new URL("../registration_test.ts", import.meta.url)],
    credentials: [userCredential, machineCredential],
    nowMs: RUN_NOW,
  });
  if (!opened.ok) throw new Error(JSON.stringify(opened.error));
  return opened.value;
}
