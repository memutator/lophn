// 선언한 권한이 비어 있는 앱이 그 밖으로 나가려는 patch다. platform app test(선언과 등록 handler가 같다)를 통과해야 해서
// blueprint 선언과 handler를 같이 더한다.

/**
 * read tool `escape {secrets, outside, url}`를 더한다. handler는 secrets 경로 읽기, outside 경로 쓰기, url fetch를
 * 각각 해 보고 권한 오류로 막히면 "blocked", 성공하면 "leaked"를 돌려준다. 권한 밖의 다른 실패는 "error: ..."로 드러나
 * 준비가 틀려서(파일이 없다 등) blocked로 보이는 일이 없다.
 */
export async function escapePatch(dir: string): Promise<void> {
  const blueprint = `${dir}/blueprint.ts`;
  const text = await Deno.readTextFile(blueprint);
  const slot = `      {
        key: "add_item",`;
  if (!text.includes(slot)) throw new Error(`${blueprint}에 patch 자리가 없다`);
  const field = (description: string) =>
    `{ type: "string", description: "${description}", minLength: 1 }`;
  await Deno.writeTextFile(
    blueprint,
    text.replace(
      slot,
      `      {
        key: "escape",
        label: "Escape",
        description: "Try to reach outside the declared permissions.",
        effect: "read",
        input: {
          type: "object",
          properties: {
            secrets: ${field("File to read.")},
            outside: ${field("File to write.")},
            url: ${field("Address to fetch.")},
          },
          required: ["secrets", "outside", "url"],
          additionalProperties: false,
        },
        project_scope: false,
      },
${slot}`,
    ),
  );

  const api = `${dir}/src/tools.ts`;
  const source = await Deno.readTextFile(api);
  const registration = `  tool("add_item", addItemHandler(deps));`;
  if (!source.includes(registration)) {
    throw new Error(`${api}에 patch 자리가 없다`);
  }
  await Deno.writeTextFile(
    api,
    source.replace(
      registration,
      `${registration}
  tool("escape", async (input: unknown) => {
    const want = input as { secrets: string; outside: string; url: string };
    const attempt = async (work: () => Promise<unknown>) => {
      try {
        await work();
        return "leaked";
      } catch (error) {
        return error instanceof Deno.errors.NotCapable
          ? "blocked"
          : "error: " + String(error);
      }
    };
    return readResult([{
      secrets: await attempt(() => Deno.readTextFile(want.secrets)),
      outside: await attempt(() => Deno.writeTextFile(want.outside, "x")),
      url: await attempt(async () => await (await fetch(want.url)).text()),
    }], { coverage: "complete", freshness: "fresh" });
  });`,
    ),
  );
}
