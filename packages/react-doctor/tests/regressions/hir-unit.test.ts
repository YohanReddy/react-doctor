import { describe, expect, it } from "vite-plus/test";
import { parse } from "@typescript-eslint/parser";
import type { EsTreeNode } from "../../../oxlint-plugin-react-doctor/src/plugin/utils/es-tree-node.js";
import { lowerFunction } from "../../../oxlint-plugin-react-doctor/src/plugin/hir/lower.js";
import { inferTypes } from "../../../oxlint-plugin-react-doctor/src/plugin/hir/infer-types.js";
import { validateNoSetStateInEffects } from "../../../oxlint-plugin-react-doctor/src/plugin/hir/validators/validate-no-set-state-in-effect.js";
import { validateNoDerivedComputationsInEffects } from "../../../oxlint-plugin-react-doctor/src/plugin/hir/validators/validate-no-derived-computations-in-effects.js";

const lowerFromSource = (source: string) => {
  const ast = parse(source, { loc: true, range: true, jsx: true });
  // HACK: parser returns a Program node; .body[0] is a
  // FunctionDeclaration whose dynamic shape conforms to EsTreeNode.
  const componentNode = ast.body[0] as unknown as EsTreeNode;
  const fn = lowerFunction(componentNode);
  inferTypes(fn);
  return fn;
};

describe("HIR — direct lower + validate", () => {
  it("lowers a Counter and emits a setState-in-effect finding", () => {
    const fn = lowerFromSource(`
function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(1);
  }, []);
  return null;
}
`);
    const hits = validateNoSetStateInEffects(fn);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].setterPlace.identifier.name).toBe("setCount");
    expect(hits[0].setterPlace.identifier.type).toBe("StateSetter");
  });

  it("emits a derived-state finding only when the body has an intermediate local", () => {
    const fn = lowerFromSource(`
function Form() {
  const [firstName] = useState("Taylor");
  const [lastName] = useState("Swift");
  const [fullName, setFullName] = useState("");
  useEffect(() => {
    const combined = firstName + " " + lastName;
    setFullName(combined);
  }, [firstName, lastName]);
  return null;
}
`);
    const hits = validateNoDerivedComputationsInEffects(fn);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});
