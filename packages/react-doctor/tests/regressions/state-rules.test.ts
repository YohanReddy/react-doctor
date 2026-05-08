import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { runOxlint } from "../../src/utils/run-oxlint.js";
import { setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-state-rules-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const collectRuleHits = async (
  projectDir: string,
  ruleId: string,
): Promise<Array<{ filePath: string; message: string }>> => {
  const diagnostics = await runOxlint({
    rootDirectory: projectDir,
    hasTypeScript: true,
    framework: "unknown",
    hasReactCompiler: false,
    hasTanStackQuery: false,
  });
  return diagnostics
    .filter((diagnostic) => diagnostic.rule === ruleId)
    .map((diagnostic) => ({
      filePath: diagnostic.filePath,
      message: diagnostic.message,
    }));
};

describe("no-direct-state-mutation", () => {
  it("flags push/pop/splice/sort/reverse and member assignment on useState values", async () => {
    const projectDir = setupReactProject(tempRoot, "no-direct-state-mutation-pos", {
      files: {
        "src/Cart.tsx": `import { useState } from "react";

export const Cart = () => {
  const [items, setItems] = useState<string[]>([]);
  const [profile, setProfile] = useState({ tags: [] as string[] });
  void setItems;
  void setProfile;

  const onAdd = (next: string) => {
    items.push(next);
    items[0] = next;
    profile.tags.push(next);
    items.splice(0, 1);
    items.sort();
    items.reverse();
  };

  return <button onClick={() => onAdd("x")}>{items.length}</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-direct-state-mutation");
    // 6 mutations on \`items\` + 1 on \`profile.tags\`.
    expect(hits.length).toBeGreaterThanOrEqual(6);
    expect(hits.some((hit) => hit.message.includes('"items"'))).toBe(true);
    expect(hits.some((hit) => hit.message.includes('"profile"'))).toBe(true);
  });

  it("does not flag immutable counterparts (toSorted/toReversed/toSpliced)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-direct-state-mutation-immutable", {
      files: {
        "src/Cart.tsx": `import { useState } from "react";

export const Cart = () => {
  const [items, setItems] = useState<string[]>([]);
  const onSort = () => setItems(items.toSorted());
  const onReverse = () => setItems(items.toReversed());
  const onSplice = () => setItems(items.toSpliced(0, 1));
  void onSort;
  void onReverse;
  void onSplice;
  return <span>{items.length}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-direct-state-mutation");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a local variable that shadows a useState name", async () => {
    const projectDir = setupReactProject(tempRoot, "no-direct-state-mutation-shadow", {
      files: {
        "src/Cart.tsx": `import { useState } from "react";

export const Cart = () => {
  const [items, setItems] = useState<string[]>([]);
  void setItems;

  const buildLocal = (raw: string) => {
    const items = raw.split(",");
    items.push("extra");
    return items;
  };

  return <span>{buildLocal("a,b").length + items.length}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-direct-state-mutation");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a parameter that shadows a useState name", async () => {
    const projectDir = setupReactProject(tempRoot, "no-direct-state-mutation-param-shadow", {
      files: {
        "src/Cart.tsx": `import { useState } from "react";

export const Cart = () => {
  const [items, setItems] = useState<string[]>([]);
  void setItems;

  const helper = (items: string[]) => {
    items.push("local");
    return items;
  };

  return <span>{helper(["a"]).length + items.length}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-direct-state-mutation");
    expect(hits).toHaveLength(0);
  });
});

describe("no-set-state-in-render", () => {
  it("flags an unconditional top-level setter call", async () => {
    const projectDir = setupReactProject(tempRoot, "no-set-state-in-render-pos", {
      files: {
        "src/Greeting.tsx": `import { useState } from "react";

export const Greeting = () => {
  const [name, setName] = useState("");
  setName("Alice");
  return <h1>{name}</h1>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-set-state-in-render");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("setName");
  });

  it("does not flag the canonical conditional 'derive state from props' pattern", async () => {
    // https://react.dev/reference/react/useState#storing-information-from-previous-renders
    const projectDir = setupReactProject(tempRoot, "no-set-state-in-render-conditional", {
      files: {
        "src/CountLabel.tsx": `import { useState } from "react";

export const CountLabel = ({ count }: { count: number }) => {
  const [prevCount, setPrevCount] = useState(count);
  const [trend, setTrend] = useState<string | null>(null);
  if (prevCount !== count) {
    setPrevCount(count);
    setTrend(count > prevCount ? "up" : "down");
  }
  return <h1>{trend}</h1>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-set-state-in-render");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a setter call inside an event handler", async () => {
    const projectDir = setupReactProject(tempRoot, "no-set-state-in-render-handler", {
      files: {
        "src/Counter.tsx": `import { useState } from "react";

export const Counter = () => {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-set-state-in-render");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a setter call inside useEffect", async () => {
    const projectDir = setupReactProject(tempRoot, "no-set-state-in-render-effect", {
      files: {
        "src/Loader.tsx": `import { useEffect, useState } from "react";

export const Loader = () => {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    setData("loaded");
  }, []);
  return <div>{data}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-set-state-in-render");
    expect(hits).toHaveLength(0);
  });
});

describe("no-effect-chain", () => {
  it("flags the article §7 Game-style cross-effect chain", async () => {
    // https://react.dev/learn/you-might-not-need-an-effect#chains-of-computations
    const projectDir = setupReactProject(tempRoot, "no-effect-chain-game", {
      files: {
        "src/Game.tsx": `import { useEffect, useState } from "react";

interface Card { gold: boolean }

export const Game = ({ card }: { card: Card | null }) => {
  const [goldCount, setGoldCount] = useState(0);
  const [round, setRound] = useState(1);
  const [isGameOver, setIsGameOver] = useState(false);

  useEffect(() => {
    if (card !== null && card.gold) {
      setGoldCount((c) => c + 1);
    }
  }, [card]);

  useEffect(() => {
    if (goldCount > 3) {
      setRound((r) => r + 1);
      setGoldCount(0);
    }
  }, [goldCount]);

  useEffect(() => {
    if (round > 5) {
      setIsGameOver(true);
    }
  }, [round]);

  return <div>{isGameOver ? "over" : round}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-chain");
    // The downstream effects (reading goldCount and round) should each be
    // flagged once. The first effect (writing goldCount) doesn't read state
    // set elsewhere, so it isn't flagged.
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.some((hit) => hit.message.includes("goldCount"))).toBe(true);
    expect(hits.some((hit) => hit.message.includes("round"))).toBe(true);
  });

  it("does NOT flag a single effect with multiple setters (covered by no-cascading-set-state)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-chain-single-effect", {
      files: {
        "src/Settings.tsx": `import { useEffect, useState } from "react";

export const Settings = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  useEffect(() => {
    setName("default");
    setEmail("default@example.com");
  }, []);
  return <div>{name} {email}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-chain");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag the article's GOOD network-cascade exception", async () => {
    // The article explicitly notes that a chain of effects is appropriate
    // when each effect synchronizes with the network. Each fetch-bearing
    // effect is `isExternalSync = true` and thus exempt.
    const projectDir = setupReactProject(tempRoot, "no-effect-chain-network", {
      files: {
        "src/ShippingForm.tsx": `import { useEffect, useState } from "react";

export const ShippingForm = ({ country }: { country: string }) => {
  const [cities, setCities] = useState<string[] | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [areas, setAreas] = useState<string[] | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch(\`/api/cities?country=\${country}\`)
      .then((response) => response.json())
      .then((json) => {
        if (!ignore) setCities(json);
      });
    return () => {
      ignore = true;
    };
  }, [country]);

  useEffect(() => {
    if (city === null) return;
    let ignore = false;
    fetch(\`/api/areas?city=\${city}\`)
      .then((response) => response.json())
      .then((json) => {
        if (!ignore) setAreas(json);
      });
    return () => {
      ignore = true;
    };
  }, [city]);

  return (
    <select value={city ?? ""} onChange={(event) => setCity(event.target.value)}>
      {cities?.map((entry) => <option key={entry}>{entry}</option>)}
      {areas?.length}
    </select>
  );
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-chain");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag a chat-connection effect even if it shares deps with another effect", async () => {
    // External-system synchronization (createConnection().connect()) sets
    // the upstream effect's `isExternalSync = true`, which exempts both
    // sides of the would-be edge.
    const projectDir = setupReactProject(tempRoot, "no-effect-chain-chat", {
      files: {
        "src/Chat.tsx": `import { useEffect, useState } from "react";

declare const createConnection: (url: string) => {
  connect: () => void;
  disconnect: () => void;
};

export const Chat = ({ roomId }: { roomId: string }) => {
  const [messages, setMessages] = useState<string[]>([]);

  useEffect(() => {
    const connection = createConnection(roomId);
    connection.connect();
    return () => connection.disconnect();
  }, [roomId]);

  useEffect(() => {
    setMessages([]);
  }, [roomId]);

  return <ul>{messages.map((line) => <li key={line}>{line}</li>)}</ul>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-chain");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag a fetch-cascade where one effect uses `axios.get` (Bugbot #156)", async () => {
    // Regression: previously \`get\` was missing from the external-sync
    // member-method allowlist, so an \`axios.get(...)\` effect was
    // classified as internal-only. Two such effects with state-flow
    // dependence got flagged as a chain even though both were
    // legitimately doing network sync.
    const projectDir = setupReactProject(tempRoot, "no-effect-chain-axios-get-cascade", {
      files: {
        "src/Cascade.tsx": `import { useEffect, useState } from "react";

declare const axios: { get: (url: string) => Promise<{ data: unknown }> };

export const Cascade = ({ country }: { country: string }) => {
  const [cities, setCities] = useState<unknown>(null);
  const [city, setCity] = useState<string | null>(null);
  const [areas, setAreas] = useState<unknown>(null);

  useEffect(() => {
    let ignore = false;
    axios.get(\`/api/cities?country=\${country}\`).then((response) => {
      if (!ignore) setCities(response.data);
    });
    return () => {
      ignore = true;
    };
  }, [country]);

  useEffect(() => {
    if (city === null) return;
    let ignore = false;
    axios.get(\`/api/areas?city=\${city}\`).then((response) => {
      if (!ignore) setAreas(response.data);
    });
    return () => {
      ignore = true;
    };
  }, [city]);

  return (
    <div>
      <select value={city ?? ""} onChange={(event) => setCity(event.target.value)}>
        {(cities as Array<string> | null)?.map((entry) => <option key={entry}>{entry}</option>)}
      </select>
      <span>{(areas as Array<string> | null)?.length}</span>
    </div>
  );
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-chain");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag two effects whose written/read state sets are disjoint", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-chain-disjoint", {
      files: {
        "src/Profile.tsx": `import { useEffect, useState } from "react";

export const Profile = ({ userId, theme }: { userId: string; theme: string }) => {
  const [name, setName] = useState("");
  const [highlight, setHighlight] = useState("");
  useEffect(() => {
    setName(userId.toUpperCase());
  }, [userId]);
  useEffect(() => {
    setHighlight(theme === "dark" ? "white" : "black");
  }, [theme]);
  return <span style={{ color: highlight }}>{name}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-chain");
    expect(hits).toHaveLength(0);
  });
});

describe("no-uncontrolled-input", () => {
  it("flags `value` without onChange / readOnly", async () => {
    const projectDir = setupReactProject(tempRoot, "no-uncontrolled-input-no-onchange", {
      files: {
        "src/Form.tsx": `export const Form = () => <input value="frozen" />;
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-uncontrolled-input");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("silently read-only");
  });

  it("flags `value` + `defaultValue` set together", async () => {
    const projectDir = setupReactProject(tempRoot, "no-uncontrolled-input-both", {
      files: {
        "src/Form.tsx": `import { useState } from "react";

export const Form = () => {
  const [name, setName] = useState("");
  return (
    <input
      value={name}
      defaultValue="hello"
      onChange={(event) => setName(event.target.value)}
    />
  );
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-uncontrolled-input");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("defaultValue");
  });

  it("flags useState() with no initial value used as `value`", async () => {
    const projectDir = setupReactProject(tempRoot, "no-uncontrolled-input-flip", {
      files: {
        "src/Form.tsx": `import { useState } from "react";

export const Form = () => {
  const [name, setName] = useState();
  return <input value={name} onChange={(event) => setName(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-uncontrolled-input");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("uncontrolled");
  });

  it("does not flag <input type='checkbox' value='cat'> (value is a form token)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-uncontrolled-input-checkbox", {
      files: {
        "src/Form.tsx": `export const Form = () => <input type="checkbox" value="cat" />;
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-uncontrolled-input");
    expect(hits).toHaveLength(0);
  });

  it("does not flag inputs with spread props (onChange may come from spread)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-uncontrolled-input-spread", {
      files: {
        "src/Form.tsx": `import { useState } from "react";

export const Form = ({ inputProps }: { inputProps: object }) => {
  const [name, setName] = useState("");
  void setName;
  return (
    <>
      <input value={name} {...inputProps} />
      <input {...inputProps} value={name} />
    </>
  );
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-uncontrolled-input");
    expect(hits).toHaveLength(0);
  });
});
