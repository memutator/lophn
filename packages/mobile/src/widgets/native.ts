// The part of home screen widgets only Android can do. The native widget reads two files in the app's private folder
// (`widgets/bindings.json`, `widgets/cache.json`) and draws from them without JS; this is how JS reaches that folder.
// `widgetNative` is the memory fake until the native module replaces it.
export type WidgetNative = {
  /** Null when the file does not exist. `name` is relative to the app's private folder, like "widgets/cache.json". */
  readText(name: string): Promise<string | null>;
  writeText(name: string, text: string): Promise<void>;
  /** appWidgetIds of the widgets the launcher has placed. */
  placedIds(): Promise<number[]>;
  /** Draws the widgets again from the cache file; every placed widget when `ids` is absent. */
  redraw(ids?: number[]): Promise<void>;
};

export type MemoryNative = WidgetNative & {
  files: Map<string, string>;
  placed: number[];
  redraws: (number[] | undefined)[];
};

export function memoryNative(placed: number[] = []): MemoryNative {
  const files = new Map<string, string>();
  const redraws: (number[] | undefined)[] = [];
  const self: MemoryNative = {
    files,
    placed,
    redraws,
    readText: async (name) => files.get(name) ?? null,
    writeText: async (name, text) => {
      files.set(name, text);
    },
    placedIds: async () => self.placed,
    redraw: async (ids) => {
      redraws.push(ids);
    },
  };
  return self;
}

export const widgetNative: WidgetNative = memoryNative();
