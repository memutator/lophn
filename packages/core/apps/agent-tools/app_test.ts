import { assertEquals } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import type { ToolContext } from "../../lophn-agent/tools/spi.ts";
import { APP_TOOLS } from "./app.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const ITEMS = "dom_01hzzzzzzzzzzzzzzzzzzzzzza";
const OTHER = "dom_01hzzzzzzzzzzzzzzzzzzzzzzb";
const common = { as_of_seq: "1", next_cursor: null };

function tool(name: string, domain: string, open: boolean) {
  return {
    name,
    title: name,
    description: name,
    effect: "read",
    public: open,
    domain,
  };
}

// 다른 domain의 비공개 tool이 `app.app_api` 결과에 새면 그 domain 밖 agent가 tool 이름과 모양을 얻는다.
Deno.test("app.app_api는 맡지 않은 domain의 비공개 tool을 싣지 않고 public tool은 싣는다", async () => {
  const handler = APP_TOOLS.find((t) => t.name === "app.app_api")!.handler!;
  const core = (path: string) =>
    Promise.resolve(ok(
      path === "/apps/app_api_index"
        ? {
          ...common,
          apps: [{
            app: APP,
            name: "Items",
            description: "Keeps items.",
            tools: [
              tool("mine", "items", false),
              tool("theirs", "other", false),
              tool("open", "other", true),
            ],
          }],
        }
        : {
          ...common,
          domains: [ITEMS, OTHER].map((id, at) => ({
            id,
            name: ["items", "other"][at],
            title: "t",
            purpose: "",
            owner: { kind: "app", id: APP },
            revision: "1",
            status: "active",
          })),
        },
    ));
  const names = async (domains: string[]) => {
    const result = await handler(
      {},
      { core, domains } as unknown as ToolContext,
    );
    if (!result.ok) throw new Error("app.app_api failed");
    const body = result.value.content as unknown as {
      apps: { tools: { name: string }[] }[];
    };
    return body.apps[0].tools.map((t) => t.name);
  };
  assertEquals(await names([ITEMS]), ["mine", "open"]);
  assertEquals(await names([]), ["open"]);
});
