// 이 설치의 기계 신분. `<root>/machine.json`에 한 번 만들고, 기동마다 OS 값과 묶은 binding으로 복사된
// data root를 알아채 새 기계로 바꾼다. 이 file의 주인은 이 module 하나다.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  type Clock,
  err,
  type IdSource,
  type Logger,
  ok,
  type Result,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import { atSchema } from "../../protocol/base/mod.ts";
import {
  machineIdSchema,
  machineNameSchema,
  type MachineStatus,
} from "../../protocol/machine/mod.ts";

const FILE = "machine.json";
const NAME_LIMIT = 64;
const FALLBACK_NAME = "lophn";

const recordSchema = z.object({
  id: machineIdSchema,
  name: machineNameSchema.nullable(),
  binding: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  created_at: atSchema,
  cloned_from: machineIdSchema.nullable(),
  cloned_at: atSchema.nullable(),
});

type MachineRecord = {
  id: Id<"mch">;
  name: string | null;
  binding: string | null;
  created_at: string;
  cloned_from: Id<"mch"> | null;
  cloned_at: string | null;
};

export type MachineIdentity = {
  id: Id<"mch">;
  status(): MachineStatus;
  rename(name: string | null): Promise<Result<MachineStatus>>;
};

export type MachineDeps = {
  root: string;
  osMachineId(): Promise<string | null>;
  hostname(): string;
  ids: IdSource;
  clock: Clock;
  logger?: Logger;
};

// 새 id로 덮으면 host key 표지가 어긋나 기기 등록이 모두 버려지므로 사람이 고르게 한다.
function unreadable(path: string): Result<never> {
  return err({
    code: "unavailable",
    message: `${path}를 읽지 못했다. 지우면 이 컴퓨터는 새 기계가 되고 폰을 다시 pairing해야 한다`,
  });
}

function parseRecord(path: string, text: string): Result<MachineRecord> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return unreadable(path);
  }
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) return unreadable(path);
  return ok(parsed.data as MachineRecord);
}

function missingOrBroken(path: string): Result<never> {
  return err({
    code: "unavailable",
    message: `${path}가 없거나 읽지 못했다`,
  });
}

export async function readMachineId(root: string): Promise<Result<Id<"mch">>> {
  const path = join(root, FILE);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return missingOrBroken(path);
  }
  const record = parseRecord(path, text);
  return record.ok ? ok(record.value.id) : record;
}

export function readMachineIdSync(root: string): Result<Id<"mch">> {
  const path = join(root, FILE);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return missingOrBroken(path);
  }
  const record = parseRecord(path, text);
  return record.ok ? ok(record.value.id) : record;
}

// data root path와 hostname은 넣지 않는다: 같은 기계에서 disk를 옮기거나 이름을 바꿔도 복제가 아니다.
function bindingOf(osValue: string, id: Id<"mch">): string {
  return createHmac("sha256", osValue)
    .update(`lophn-machine:${id}`)
    .digest("hex");
}

// temp에 쓰고 sync한 뒤 rename한다. 반쯤 쓴 file이 신분이 되지 않는다.
async function writeRecord(
  path: string,
  record: MachineRecord,
): Promise<Result<void>> {
  const temporary = `${path}.tmp`;
  try {
    const file = await open(temporary, "w", 0o600);
    try {
      await file.write(`${JSON.stringify(record, null, 2)}\n`);
      await file.datasync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } catch {
    return err({
      code: "unavailable",
      message: `${path}에 기계 기록을 쓰지 못했다`,
    });
  }
  return ok(undefined);
}

function defaultName(hostname: string): string {
  const name = hostname
    .replace(/\.local$/i, "")
    .slice(0, NAME_LIMIT)
    .trim();
  return name === "" ? FALLBACK_NAME : name;
}

async function settle(
  deps: MachineDeps,
  path: string,
  text: string | undefined,
): Promise<Result<MachineRecord>> {
  const osValue = await deps.osMachineId();
  if (text === undefined) {
    const id = deps.ids.newId("mch") as Id<"mch">;
    const record: MachineRecord = {
      id,
      name: null,
      binding: osValue === null ? null : bindingOf(osValue, id),
      created_at: deps.clock.now(),
      cloned_from: null,
      cloned_at: null,
    };
    const written = await writeRecord(path, record);
    return written.ok ? ok(record) : written;
  }
  const parsed = parseRecord(path, text);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  if (osValue === null) {
    deps.logger?.warn({
      component: "machine",
      event: "os_machine_id_unavailable",
      message: "OS의 기계 값을 읽지 못해 복제 판정을 건너뛴다",
    });
    return ok(record);
  }
  // 알 수 없으면 같은 기계다: binding이 없던 기록은 채우기만 한다.
  if (record.binding === null) {
    const bound = { ...record, binding: bindingOf(osValue, record.id) };
    const written = await writeRecord(path, bound);
    return written.ok ? ok(bound) : written;
  }
  if (record.binding === bindingOf(osValue, record.id)) return ok(record);
  // 다른 기계로 복사된 root다. 같은 id 둘은 서로의 변경과 push를 덮으므로 새 기계가 된다.
  // host key·기기 표·sync node는 각자의 machine 표지로 따로 맞춘다.
  const id = deps.ids.newId("mch") as Id<"mch">;
  const now = deps.clock.now();
  const cloned: MachineRecord = {
    id,
    name: null,
    binding: bindingOf(osValue, id),
    created_at: now,
    cloned_from: record.id,
    cloned_at: now,
  };
  const written = await writeRecord(path, cloned);
  if (!written.ok) return written;
  deps.logger?.warn({
    component: "machine",
    event: "machine_cloned",
    message: "다른 기계에서 복사된 data root라 새 기계 id를 만들었다",
    fields: { from: record.id, to: id },
  });
  return ok(cloned);
}

// 기동마다 한 번 부른다. 실패하면 기동이 실패한다.
export async function ensureMachine(
  deps: MachineDeps,
): Promise<Result<MachineIdentity>> {
  const path = join(deps.root, FILE);
  let text: string | undefined;
  try {
    text = await readFile(path, "utf8");
  } catch (thrown) {
    if ((thrown as NodeJS.ErrnoException).code !== "ENOENT") {
      return unreadable(path);
    }
  }
  const settled = await settle(deps, path, text);
  if (!settled.ok) return settled;
  let record = settled.value;

  const status = (): MachineStatus => {
    const hostname = deps.hostname();
    return {
      id: record.id,
      name: record.name ?? defaultName(hostname),
      name_source: record.name === null ? "hostname" : "person",
      hostname,
      cloned_from: record.cloned_from,
      cloned_at: record.cloned_at,
    };
  };

  return ok({
    id: record.id,
    status,
    async rename(name) {
      const trimmed = name?.trim() ?? "";
      const next = trimmed === "" ? null : trimmed;
      if (next !== null && !machineNameSchema.safeParse(next).success) {
        return err({
          code: "invalid_input",
          message: `기계 이름은 1~${NAME_LIMIT}자다`,
        });
      }
      const updated = { ...record, name: next };
      const written = await writeRecord(path, updated);
      if (!written.ok) return written;
      record = updated;
      return ok(status());
    },
  });
}
