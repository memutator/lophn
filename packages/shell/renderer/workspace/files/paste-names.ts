/**
 * 같은 이름이 있으면 비켜 간다. copy는 `a copy.md`, `a copy 2.md`. number는 `image 2.png`. 점으로 시작하는 이름의 점은 확장자로 보지 않는다.
 */
export function freeName(
  name: string,
  taken: Iterable<string>,
  style: "copy" | "number",
): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  // `.env`처럼 점으로 시작하는 이름에는 확장자가 없다.
  const dot = name.startsWith(".") ? -1 : name.lastIndexOf(".");
  const base = dot < 0 ? name : name.slice(0, dot);
  const extension = dot < 0 ? "" : name.slice(dot);
  for (let count = 1; ; count++) {
    const label =
      style === "copy"
        ? count === 1
          ? " copy"
          : ` copy ${count}`
        : ` ${count + 1}`;
    const candidate = `${base}${label}${extension}`;
    if (!used.has(candidate)) return candidate;
  }
}
