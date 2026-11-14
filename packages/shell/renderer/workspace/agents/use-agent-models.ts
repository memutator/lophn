// model picker가 고르는 목록(provider, catalog, 켠 model). provider·model이 바뀌면 다시 읽는다.
import { useFollowedRead } from "../../shell/use-left-sidebar.ts";
import type { AgentsSource, ModelsView } from "./source.ts";

/** 아직 못 읽었거나 읽지 못하면 null이다. */
export function useAgentModels(
  source: Pick<AgentsSource, "models">,
): ModelsView | null {
  // 여러 route(provider 목록, catalog page, 켠 model)를 엮는 source 읽기다.
  const models = useFollowedRead(
    () => source.models(),
    ["providers", "models"],
    "",
  ).loaded;
  return models.state === "ready" ? models.value : null;
}
