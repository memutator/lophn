// The part of home screen widgets only Android can do. The native widget reads two files in the app's private folder
// (`widgets/bindings.json`, `widgets/cache.json`) and draws from them without JS; this is how JS reaches that folder.
import { widgetFiles } from "../../modules/lophn-widgets/index.ts";

export type WidgetNative = {
  /** Null when the file does not exist. `name` is relative to the app's private folder, like "widgets/cache.json". */
  readText(name: string): Promise<string | null>;
  /** Not the bindings file: that changes only through `bind` and `dropUnplaced`. */
  writeText(name: string, text: string): Promise<void>;
  /** Binds a placed widget (its appWidgetId) to a binding's JSON. */
  bind(id: number, binding: string): Promise<void>;
  /** Forgets the bindings of widgets the launcher no longer has; gives the bindings file's text after. */
  dropUnplaced(): Promise<string>;
  /** Draws the widgets again from the cache file; every placed widget when `ids` is absent. */
  redraw(ids?: number[]): Promise<void>;
};

export const widgetNative: WidgetNative = widgetFiles;
