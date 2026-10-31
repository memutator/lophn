// <home>/shell/places/<place>.json은 main만 쓴다(원자 교체와 mode는 atomic-file.ts). place는 `home`이거나
// project id, app id다. 파일이 없는 project는 옛 layouts/<prj_id>.json을 읽어 올려 돌려주고, 그 파일은 고치지 않는다.
import { join } from "node:path";

import {
  defaultStoreDeps,
  fsError,
  type StoreDeps,
  type StoreResult,
  writeFileAtomic,
} from "./atomic-file.ts";
import { createLayoutStore } from "./layout-store.ts";
import {
  isPlaceKey,
  parsePlaceLayoutFile,
  type PlaceLayoutResult,
  upgradeFromV7,
  validatePlaceLayout,
} from "./place-layout.ts";

export type PlaceStoreResult<T> =
  | StoreResult<T>
  | { ok: false; error: { code: "invalid_input"; message: string } };

const INVALID_PLACE = {
  ok: false,
  error: { code: "invalid_input", message: "invalid place key" },
} as const;

const PROJECT_ID = /^prj_[0-7][0-9a-hjkmnp-tv-z]{25}$/;

export interface PlaceLayoutStore {
  /** 그 place의 layout. 어디에도 없으면 null이고 손상·미지원 판은 안전한 오류 값이다. */
  read(place: string): Promise<PlaceStoreResult<PlaceLayoutResult | null>>;
  /** renderer가 보낸 값을 검증해 원자 교체로 쓴다. 검증에 실패하면 `invalid_input`이고 파일은 그대로다. */
  write(place: string, layout: unknown): Promise<PlaceStoreResult<null>>;
}

export function createPlaceLayoutStore(
  dataRoot: string,
  deps: Partial<StoreDeps> = {},
): PlaceLayoutStore {
  const impl: StoreDeps = { ...defaultStoreDeps, ...deps };
  const legacy = createLayoutStore(dataRoot, impl);
  const fileOf = (place: string) =>
    join(dataRoot, "shell", "places", `${place}.json`);

  return {
    async read(place) {
      if (!isPlaceKey(place)) return INVALID_PLACE;
      let raw: Uint8Array | null = null;
      try {
        raw = await impl.readFile(fileOf(place));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          return {
            ok: false,
            error: fsError(
              code === "EISDIR" ? "not_a_directory" : "unreadable",
            ),
          };
        }
      }
      if (raw !== null) {
        try {
          const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
          return { ok: true, value: parsePlaceLayoutFile(parsed) };
        } catch {
          return { ok: true, value: { ok: false, reason: "corrupt" } };
        }
      }
      if (!PROJECT_ID.test(place)) return { ok: true, value: null };
      const old = await legacy.read(place);
      if (!old.ok) return old;
      if (old.value === null) return { ok: true, value: null };
      if (!old.value.ok) return { ok: true, value: old.value };
      if (old.value.layout.project !== place) return { ok: true, value: null };
      return { ok: true, value: upgradeFromV7(old.value.layout) };
    },
    async write(place, layout) {
      if (!isPlaceKey(place)) return INVALID_PLACE;
      const valid = validatePlaceLayout(layout);
      if (!valid.ok) {
        return {
          ok: false,
          error: { code: "invalid_input", message: "invalid layout" },
        };
      }
      return writeFileAtomic(fileOf(place), JSON.stringify(valid.layout), impl);
    },
  };
}
