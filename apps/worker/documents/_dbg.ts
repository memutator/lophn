export function dbg(line: string) {
  try {
    Deno.mkdirSync(`${Deno.env.get("LOPHN_HOME")}/documents`, {
      recursive: true,
    });
    Deno.writeTextFileSync(
      `${Deno.env.get("LOPHN_HOME")}/documents/debug.log`,
      line + "\n",
      { append: true, create: true },
    );
  } catch (_e) { /* */ }
}
