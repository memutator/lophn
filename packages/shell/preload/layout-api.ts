import {
  PLACE_LAYOUT_READ_CHANNEL,
  PLACE_LAYOUT_SAVE_CHANNEL,
  type PlaceLayoutReadResult,
  type PlaceLayoutSaveResult,
} from "../ipc/workspace.ts";

interface LayoutTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
}

/** 작업대 layout 통로. 탭과 정보 패널만 보내고 main이 다시 검사한다. */
interface LophnLayoutApi {
  readPlace(input: { place: string }): Promise<PlaceLayoutReadResult>;
  savePlace(input: {
    place: string;
    layout: unknown;
  }): Promise<PlaceLayoutSaveResult>;
}

export function createLayoutApi(transport: LayoutTransport): LophnLayoutApi {
  return Object.freeze({
    readPlace: async (input) => {
      try {
        return (await transport.invoke(
          PLACE_LAYOUT_READ_CHANNEL,
          input,
        )) as PlaceLayoutReadResult;
      } catch {
        return { ok: false, code: "unavailable", message: "" };
      }
    },
    savePlace: async (input) => {
      try {
        return (await transport.invoke(
          PLACE_LAYOUT_SAVE_CHANNEL,
          input,
        )) as PlaceLayoutSaveResult;
      } catch {
        return { ok: false, code: "unavailable", message: "" };
      }
    },
  } satisfies LophnLayoutApi);
}
