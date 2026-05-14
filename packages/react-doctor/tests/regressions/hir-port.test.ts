import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { runOxlint } from "@react-doctor/core";
import type { ProjectInfo } from "@react-doctor/types";

import { setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-hir-port-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const setupHirProject = (caseId: string, files: Record<string, string>): string =>
  setupReactProject(tempRoot, caseId, { files });

const collectRuleHitsWithLine = async (
  projectDir: string,
  ruleId: string,
): Promise<Array<{ filePath: string; message: string; line: number }>> => {
  const project: ProjectInfo = {
    rootDirectory: projectDir,
    projectName: path.basename(projectDir),
    reactVersion: "^19.0.0",
    reactMajorVersion: 19,
    tailwindVersion: null,
    framework: "unknown",
    hasTypeScript: true,
    hasReactCompiler: false,
    hasTanStackQuery: false,
    sourceFileCount: 0,
  };
  const diagnostics = await runOxlint({
    rootDirectory: projectDir,
    project,
  });
  return diagnostics
    .filter((diagnostic) => diagnostic.rule === ruleId)
    .map((diagnostic) => ({
      filePath: diagnostic.filePath,
      message: diagnostic.message,
      line: diagnostic.line,
    }));
};

describe("hir-no-set-state-in-effect — HIR-validated rule", () => {
  it("flags a useEffect that calls a setState directly", async () => {
    const projectDir = setupHirProject("hir-no-set-state-direct", {
      "src/Counter.tsx": `import { useEffect, useState } from "react";

export const Counter = () => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(1);
  }, []);
  return <span>{count}</span>;
};
`,
    });

    const hits = await collectRuleHitsWithLine(projectDir, "hir-no-set-state-in-effect");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].message).toContain("setCount");
    expect(hits[0].message).toContain("HIR-validated");
  });

  it("flags a useEffect that calls a setState via an aliased const (SSA propagation)", async () => {
    const projectDir = setupHirProject("hir-no-set-state-aliased", {
      "src/Aliased.tsx": `import { useEffect, useState } from "react";

export const Aliased = () => {
  const [count, setCount] = useState(0);
  const writer = setCount;
  useEffect(() => {
    writer(2);
  }, []);
  return <span>{count}</span>;
};
`,
    });

    const hits = await collectRuleHitsWithLine(projectDir, "hir-no-set-state-in-effect");
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("reports at the setState call site (not the component declaration line)", async () => {
    const projectDir = setupHirProject("hir-no-set-state-call-site-loc", {
      "src/Counter.tsx": `import { useEffect, useState } from "react";

export const Counter = () => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(1);
  }, []);
  return <span>{count}</span>;
};
`,
    });

    const hits = await collectRuleHitsWithLine(projectDir, "hir-no-set-state-in-effect");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].line).toBe(6);
  });

  it("does NOT flag setState inside a sub-handler (subscription callback) — that's legit", async () => {
    const projectDir = setupHirProject("hir-no-set-state-subscribe", {
      "src/Sync.tsx": `import { useEffect, useState } from "react";

declare const subscribe: (handler: () => void) => () => void;

export const Sync = () => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    return subscribe(() => setTick(tick + 1));
  }, [tick]);
  return <span>{tick}</span>;
};
`,
    });

    const hits = await collectRuleHitsWithLine(projectDir, "hir-no-set-state-in-effect");
    expect(hits).toHaveLength(0);
  });

  it("does NOT misclassify `[a, b] = useMemo(...)` as a state destructure", async () => {
    const projectDir = setupHirProject("hir-no-set-state-usememo-tuple", {
      "src/Memo.tsx": `import { useEffect, useMemo } from "react";

declare const compute: () => [number, () => void];

export const Memo = () => {
  const [n, runIt] = useMemo(() => compute(), []);
  useEffect(() => {
    runIt();
  }, [n]);
  return <span>{n}</span>;
};
`,
    });

    const hits = await collectRuleHitsWithLine(projectDir, "hir-no-set-state-in-effect");
    expect(hits).toHaveLength(0);
  });
});

describe("hir-no-derived-computations-in-effects — HIR-validated rule", () => {
  it("defers to noDerivedStateEffect on the single-setter-call shape", async () => {
    const projectDir = setupHirProject("hir-derived-fullname-defer", {
      "src/Form.tsx": `import { useEffect, useState } from "react";

export const Form = () => {
  const [firstName] = useState("Taylor");
  const [lastName] = useState("Swift");
  const [fullName, setFullName] = useState("");
  useEffect(() => {
    setFullName(firstName + " " + lastName);
  }, [firstName, lastName]);
  return <p>{fullName}</p>;
};
`,
    });

    const hits = await collectRuleHitsWithLine(
      projectDir,
      "hir-no-derived-computations-in-effects",
    );
    expect(hits).toHaveLength(0);
  });

  it("flags the article §1 example when the derivation is bound to a local first (HIR-unique)", async () => {
    const projectDir = setupHirProject("hir-derived-with-local", {
      "src/Form.tsx": `import { useEffect, useState } from "react";

export const Form = () => {
  const [firstName] = useState("Taylor");
  const [lastName] = useState("Swift");
  const [fullName, setFullName] = useState("");
  useEffect(() => {
    const combined = firstName + " " + lastName;
    setFullName(combined);
  }, [firstName, lastName]);
  return <p>{fullName}</p>;
};
`,
    });

    const hits = await collectRuleHitsWithLine(
      projectDir,
      "hir-no-derived-computations-in-effects",
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].message).toContain("HIR-validated");
  });

  it("does NOT flag a useEffect that reads a value NOT in deps (genuine sync)", async () => {
    const projectDir = setupHirProject("hir-derived-not-pure", {
      "src/Logger.tsx": `import { useEffect, useState } from "react";

declare const log: (message: string) => void;

export const Logger = ({ name }: { name: string }) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    log(\`\${name}: \${count}\`);
  }, [count]);
  return <span>{count}</span>;
};
`,
    });

    const hits = await collectRuleHitsWithLine(
      projectDir,
      "hir-no-derived-computations-in-effects",
    );
    expect(hits).toHaveLength(0);
  });
});
