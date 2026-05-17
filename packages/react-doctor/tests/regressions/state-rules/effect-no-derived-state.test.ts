import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("effect-no-derived-state");

describe("no-derived-state (port of eslint-plugin-react-you-might-not-need-an-effect)", () => {
  it("does NOT flag computing in render from internal state", async () => {
    const projectDir = setupReactProject(tempRoot, "valid-compute-in-render-internal", {
      files: {
        "src/Form.tsx": `import { useState } from "react";

export const Form = () => {
  const [firstName] = useState("Taylor");
  const [lastName] = useState("Swift");
  const fullName = firstName + " " + lastName;
  return <span>{fullName}</span>;
};
`,
      },
    });

    expect(await collectRuleHits(projectDir, "no-derived-state")).toHaveLength(0);
  });

  it("does NOT flag computing in render from props", async () => {
    const projectDir = setupReactProject(tempRoot, "valid-compute-in-render-props", {
      files: {
        "src/Form.tsx": `export const Form = ({ firstName, lastName }: { firstName: string; lastName: string }) => {
  const fullName = firstName + " " + lastName;
  return <span>{fullName}</span>;
};
`,
      },
    });

    expect(await collectRuleHits(projectDir, "no-derived-state")).toHaveLength(0);
  });

  it("does NOT flag setting to literal on external state change", async () => {
    const projectDir = setupReactProject(tempRoot, "valid-literal-on-external-state", {
      files: {
        "src/Feed.tsx": `import { useEffect, useState } from "react";
declare const useQuery: (path: string) => { data: unknown[] };

export const Feed = () => {
  const { data: posts } = useQuery("/posts");
  const [scrollPosition, setScrollPosition] = useState(0);
  useEffect(() => {
    setScrollPosition(0);
  }, [posts]);
  return <div>{scrollPosition}</div>;
};
`,
      },
    });

    expect(await collectRuleHits(projectDir, "no-derived-state")).toHaveLength(0);
  });

  it("does NOT flag fetching external state on mount", async () => {
    const projectDir = setupReactProject(tempRoot, "valid-fetch-on-mount", {
      files: {
        "src/Todos.tsx": `import { useEffect, useState } from "react";

export const Todos = () => {
  const [todos, setTodos] = useState<unknown[]>([]);
  useEffect(() => {
    fetch("/todos").then((response) => response.json()).then(setTodos);
  }, []);
  return <div>{todos.length}</div>;
};
`,
      },
    });

    expect(await collectRuleHits(projectDir, "no-derived-state")).toHaveLength(0);
  });

  it("flags derived state from internal state", async () => {
    const projectDir = setupReactProject(tempRoot, "invalid-internal-state", {
      files: {
        "src/Form.tsx": `import { useEffect, useState } from "react";

export const Form = () => {
  const [firstName] = useState("Taylor");
  const [lastName] = useState("Swift");
  const [fullName, setFullName] = useState("");
  useEffect(() => setFullName(firstName + " " + lastName), [firstName, lastName]);
  return <span>{fullName}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-state");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("fullName");
    expect(hits[0].message).toContain("derived state");
  });

  it("flags derived state from props", async () => {
    const projectDir = setupReactProject(tempRoot, "invalid-from-props", {
      files: {
        "src/Form.tsx": `import { useEffect, useState } from "react";

export const Form = ({ firstName, lastName }: { firstName: string; lastName: string }) => {
  const [fullName, setFullName] = useState("");
  useEffect(() => {
    setFullName(firstName + " " + lastName);
  }, [firstName, lastName]);
  return <span>{fullName}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-state");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("fullName");
  });

  it("flags single-setter derived state from external", async () => {
    const projectDir = setupReactProject(tempRoot, "invalid-single-setter-external", {
      files: {
        "src/Feed.tsx": `import { useEffect, useState } from "react";
declare const fetchQuery: (path: string) => { data: unknown[] };

export const Feed = () => {
  const { data: posts } = fetchQuery("/posts");
  const [selectedPost, setSelectedPost] = useState<unknown>();
  useEffect(() => {
    setSelectedPost(posts[0]);
  }, [posts, setSelectedPost]);
  return <div>{String(selectedPost)}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-state");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("selectedPost");
    expect(hits[0].message).toContain("only set here");
  });

  it("flags derived state via intermediate variable", async () => {
    const projectDir = setupReactProject(tempRoot, "invalid-intermediate-variable", {
      files: {
        "src/Form.tsx": `import { useEffect, useState } from "react";

export const Form = ({ title }: { title: string }) => {
  const [name] = useState("Dwayne");
  const [fullName, setFullName] = useState("");
  useEffect(() => {
    const newFullName = title + " " + name;
    setFullName(newFullName);
  }, [title, name]);
  return <span>{fullName}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-state");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("fullName");
  });

  it("flags derived state through TypeScript expression wrappers", async () => {
    const projectDir = setupReactProject(tempRoot, "invalid-typescript-expression-wrappers", {
      files: {
        "src/Form.tsx": `import { useEffect, useState } from "react";

export const Form = ({ count }: { count: number }) => {
  const [doubled, setDoubled] = useState(0);
  useEffect(() => {
    setDoubled((count as number) * 2);
  }, [count]);
  return <span>{doubled}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-state");
    expect(hits).toHaveLength(1);
  });

  it("does NOT flag subscription effect (with cleanup)", async () => {
    const projectDir = setupReactProject(tempRoot, "valid-subscription-effect", {
      files: {
        "src/Status.tsx": `import { useEffect, useState } from "react";
declare const subscribeToStatus: (topic: string, cb: (s: string) => void) => () => void;

export const Status = ({ topic }: { topic: string }) => {
  const [status, setStatus] = useState<string>();
  useEffect(() => {
    const unsubscribe = subscribeToStatus(topic, (newStatus) => {
      setStatus(newStatus);
    });
    return () => unsubscribe();
  }, [topic]);
  return <div>{status}</div>;
};
`,
      },
    });

    expect(await collectRuleHits(projectDir, "no-derived-state")).toHaveLength(0);
  });
});
