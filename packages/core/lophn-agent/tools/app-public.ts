import { ok } from "../../../base/mod.ts";
import type { AppToolkit } from "./app-toolkit.ts";

// 다른 앱의 비공개 command를 뺀다. agent는 자기가 놓인 앱 place의 command를 다 보고, 그 밖(다른 앱, project, home의 lophn)은
// `public` command만 본다. `lophn <slug> <command>`가 부를 때마다 거른다.
export function withPublicOnly(toolkit: AppToolkit): AppToolkit {
  const load: AppToolkit["load"] = async (who) => {
    const loaded = await toolkit.load(who);
    if (!loaded.ok) return loaded;
    const views = loaded.value.views.map((view) => {
      const own = who.place?.kind === "app" && who.place.id === view.app;
      return {
        ...view,
        tools: view.tools.filter((tool) => own || tool.public),
      };
    });
    return ok({ ...loaded.value, views });
  };

  return { load };
}
