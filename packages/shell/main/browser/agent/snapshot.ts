// `Accessibility.getFullAXTree`를 `- <role> "<name>" [ref=eN]` 줄로 쓰고, ref → backendDOMNodeId 표를 든다.
// ref 번호는 탭마다 늘기만 하는 counter에서 나온다. 새 snapshot이 표를 갈아도 옛 ref가 새 node를 가리키지 않는다.
export interface AxNode {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  value?: { value?: unknown };
  childIds?: string[];
  backendDOMNodeId?: number;
}

export const SNAPSHOT_MAX = 60_000;
const NAME_MAX = 200;
// 이름이 없으면 줄로 쓰지 않는 구조용 역할이다.
const PLAIN = new Set(["generic", "none", "presentation", "InlineTextBox"]);

const text = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

export function createRefs() {
  let counter = 0;
  let table = new Map<string, number>();
  return {
    /** 표를 이 snapshot의 것으로 갈고 줄을 낸다. */
    render(nodes: AxNode[]): string {
      const byId = new Map(nodes.map((node) => [node.nodeId, node]));
      const root = nodes[0];
      const next = new Map<string, number>();
      const lines: string[] = [];
      let size = 0;
      let truncated = false;
      // [node, 들여쓰기, 가장 가까운 윗줄의 이름]. 자식을 거꾸로 넣어 앞 자식부터 꺼낸다.
      const stack: [AxNode, number, string][] = root ? [[root, 0, ""]] : [];
      while (stack.length > 0 && !truncated) {
        const [node, depth, above] = stack.pop() as [AxNode, number, string];
        const role = text(node.role?.value);
        const name = text(node.name?.value).slice(0, NAME_MAX);
        // 글자 조각은 윗줄이 이미 그 글을 이름으로 가지면 건너뛴다.
        const covered = role === "StaticText" && above.includes(name);
        const shown =
          node.ignored !== true &&
          node.backendDOMNodeId !== undefined &&
          role !== "" &&
          !covered &&
          (name !== "" || !PLAIN.has(role));
        let inner = above;
        if (shown) {
          const value = text(node.value?.value).slice(0, NAME_MAX);
          const line = `${"  ".repeat(depth)}- ${role}${name === "" ? "" : ` ${JSON.stringify(name)}`}${value === "" ? "" : ` value=${JSON.stringify(value)}`}`;
          // 자른 줄은 ref를 받지 않는다.
          if (size + line.length + 16 > SNAPSHOT_MAX) {
            truncated = true;
            break;
          }
          counter += 1;
          next.set(`e${counter}`, node.backendDOMNodeId as number);
          lines.push(`${line} [ref=e${counter}]`);
          size += line.length + 16;
          inner = name;
        }
        const children = node.childIds ?? [];
        for (let i = children.length - 1; i >= 0; i -= 1) {
          const child = byId.get(children[i] as string);
          if (child !== undefined) {
            stack.push([child, shown ? depth + 1 : depth, inner]);
          }
        }
      }
      table = next;
      return truncated ? `${lines.join("\n")}\n[truncated]` : lines.join("\n");
    },
    resolve: (ref: string): number | undefined => table.get(ref),
    /** main frame이 이동했다. counter는 그대로다. */
    clear(): void {
      table = new Map();
    },
  };
}

export type Refs = ReturnType<typeof createRefs>;
