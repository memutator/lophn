// `<root>/always-on.json`: 사람이 이 기계에 남긴 "늘 켜 둠" 표시. 이 module만 읽고 쓴다.
// 기계 id를 같이 적어, 다른 기계로 복사된 root의 표시는 꺼진 것으로 읽는다.
import { open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { err, type Logger, ok, type Result } from "../../base/mod.ts";
import { atSchema, type Id } from "../../protocol/base/mod.ts";
import { machineIdSchema } from "../../protocol/machine/mod.ts";
import type { ServiceEnv } from "./ports.ts";

const FILE = "always-on.json";

const markerSchema = z.strictObject({
  machine: machineIdSchema,
  keep_running: z.boolean(),
  keep_awake: z.boolean(),
  service_env: z.strictObject({
    PATH: z.string(),
    TMPDIR: z.string().optional(),
  }),
  updated_at: atSchema,
});

export type Marker = {
  machine: Id<"mch">;
  keep_running: boolean;
  keep_awake: boolean;
  service_env: ServiceEnv;
  updated_at: string;
};

export type MarkerRead = {
  // file이 있다(깨졌거나 다른 기계 것이어도). 없으면 한 번도 켠 적 없는 root라 기동 맞추기가 OS를 부르지 않는다.
  exists: boolean;
  foreign: boolean;
  // 이 기계의 읽힌 표시. 없거나 깨졌거나 다른 기계 것이면 null이고 꺼짐이다.
  own: Marker | null;
};

export async function readMarker(
  root: string,
  machine: Id<"mch">,
  logger: Logger,
): Promise<MarkerRead> {
  const path = join(root, FILE);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (thrown) {
    if ((thrown as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, foreign: false, own: null };
    }
    return broken(path, logger);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return broken(path, logger);
  }
  const parsed = markerSchema.safeParse(value);
  if (!parsed.success) return broken(path, logger);
  const marker = parsed.data as Marker;
  if (marker.machine !== machine) {
    logger.info({
      component: "always-on",
      event: "always_on_foreign",
      message: "다른 기계의 표시라 꺼진 것으로 읽는다",
      fields: { marked: marker.machine, here: machine },
    });
    return { exists: true, foreign: true, own: null };
  }
  return { exists: true, foreign: false, own: marker };
}

// 깨진 file은 덮지 않는다. 사람이 다시 켜면 그때 새로 쓴다.
function broken(path: string, logger: Logger): MarkerRead {
  logger.warn({
    component: "always-on",
    event: "always_on_unreadable",
    message: `${path}를 읽지 못해 꺼진 것으로 읽는다`,
  });
  return { exists: true, foreign: false, own: null };
}

// temp에 0600으로 쓰고 sync한 뒤 rename한다. 반쯤 쓴 file이 표시가 되지 않는다.
export async function writeMarker(
  root: string,
  marker: Marker,
): Promise<Result<void>> {
  const path = join(root, FILE);
  const temporary = `${path}.tmp`;
  try {
    const file = await open(temporary, "w", 0o600);
    try {
      await file.write(`${JSON.stringify(marker, null, 2)}\n`);
      await file.datasync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } catch {
    return err({
      code: "unavailable",
      message: `${path}에 늘 켜 둠 표시를 쓰지 못했다`,
    });
  }
  return ok(undefined);
}
