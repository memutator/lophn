import { open, readFile, rename } from "node:fs/promises";
import { err, ok, type Result } from "../../../base/mod.ts";

// ledger 식별. `H/ledger-id` 파일 하나에 ledger를 만들거나 복원할 때마다
// 새 값을 둔다. derived는 자기 출처에 이 값을 함께 적고, 값이 다르면 다른 ledger의 같은
// seq를 이어 처리하지 않도록 버리고 다시 만든다.
// ledger 안 표가 아니라 파일인 이유: restore는 옛 ledger의 안쪽을 그대로 들여오므로
// 안쪽 값은 복원 때 바뀌지 않는다. 파일은 restore가 ledger를 바꾸기 전에 새 값으로 쓰고,
// 중간에 죽어도 값이 틀리는 쪽은 "다시 만든다"뿐이다.
const LEDGER_ID_FILE = "ledger-id";

const LEDGER_ID = /^ldg_[0-9a-f]{32}$/;

function isLedgerId(value: string): boolean {
  return LEDGER_ID.test(value);
}

// 식별은 모의 시간·결정적 seed에 묶지 않는다. 같은 값이 두 ledger에 붙으면 이 값의
// 이유가 사라진다.
function newLedgerId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `ldg_${
    [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
  }`;
}

async function readLedgerId(root: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(`${root}/${LEDGER_ID_FILE}`, "utf8");
  } catch {
    return undefined;
  }
  const value = text.trim();
  return isLedgerId(value) ? value : undefined;
}

// 임시 파일에 쓰고 sync한 뒤 rename한다. 반쯤 쓴 값이 식별이 되지 않는다.
async function writeLedgerId(
  root: string,
  id: string,
): Promise<Result<void>> {
  if (!isLedgerId(id)) {
    return err({ code: "invalid_input", message: "ledger 식별 형식이 아니다" });
  }
  const target = `${root}/${LEDGER_ID_FILE}`;
  const temporary = `${target}.tmp`;
  try {
    const file = await open(temporary, "w", 0o600);
    try {
      await file.write(new TextEncoder().encode(`${id}\n`));
      await file.datasync();
    } finally {
      await file.close();
    }
    await rename(temporary, target);
  } catch {
    return err({
      code: "unavailable",
      message: "ledger 식별을 남기지 못했다",
    });
  }
  return ok(undefined);
}

// 기동이 쓴다. ledger를 새로 만드는 기동이거나 식별 파일이 없거나 읽을 수 없으면 새 값이다.
// 있는 ledger와 있는 식별은 그대로다.
export async function ensureLedgerId(
  root: string,
  ledgerExisted: boolean,
): Promise<Result<string>> {
  if (ledgerExisted) {
    const current = await readLedgerId(root);
    if (current !== undefined) return ok(current);
  }
  const id = newLedgerId();
  const written = await writeLedgerId(root, id);
  if (!written.ok) return written;
  return ok(id);
}
