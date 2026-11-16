import { useEffect, useState } from "react";
import type { AppWidget } from "../../../../protocol/apps/widget.ts";
import { listWidgets } from "../../widgets/store.ts";

/** What each computer says its apps' widgets are. A computer not in the map is being asked; null: it could not be asked. */
export function useWidgetLists(
  hosts: readonly string[],
): ReadonlyMap<string, readonly AppWidget[] | null> {
  const [lists, setLists] = useState<
    ReadonlyMap<string, readonly AppWidget[] | null>
  >(new Map());
  // Joined so a new array of the same computers does not ask again.
  const key = JSON.stringify(hosts);
  useEffect(() => {
    let live = true;
    for (const host of JSON.parse(key) as string[]) {
      void listWidgets(host).then((list) => {
        if (live) setLists((prev) => new Map(prev).set(host, list));
      });
    }
    return () => {
      live = false;
    };
  }, [key]);
  return lists;
}
