import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("no-effect-event-handler");

describe("no-effect-event-handler (widened to MemberExpression test root)", () => {
  it("flags the article §5 `if (product.isInCart)` shape", async () => {
    // https://react.dev/learn/you-might-not-need-an-effect#sharing-logic-between-event-handlers
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-member-expression", {
      files: {
        "src/ProductPage.tsx": `import { useEffect } from "react";

declare const showNotification: (message: string) => void;

interface Product { isInCart: boolean; name: string }

export const ProductPage = ({ product }: { product: Product }) => {
  useEffect(() => {
    if (product.isInCart) {
      showNotification(\`Added \${product.name} to the shopping cart!\`);
    }
  }, [product]);

  return <div>{product.name}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("simulating an event handler");
  });

  it("still flags the bare-Identifier shape", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-identifier", {
      files: {
        "src/Modal.tsx": `import { useEffect } from "react";

export const Modal = ({ isOpen }: { isOpen: boolean }) => {
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add("modal-open");
    }
  }, [isOpen]);
  return <div />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(1);
  });

  it("flags documentElement classList mutations", async () => {
    const projectDir = setupReactProject(
      tempRoot,
      "no-effect-event-handler-document-element-class-list",
      {
        files: {
          "src/Theme.tsx": `import { useEffect } from "react";

export const Theme = ({ isDark }: { isDark: boolean }) => {
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    }
  }, [isDark]);
  return <div />;
};
`,
        },
      },
    );

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(1);
  });

  it("flags member-expression dependency arrays", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-member-dep", {
      files: {
        "src/ProductPage.tsx": `import { useEffect } from "react";

declare const showNotification: (message: string) => void;

interface Product { isInCart: boolean; name: string }

export const ProductPage = ({ product }: { product: Product }) => {
  useEffect(() => {
    if (product.isInCart) {
      showNotification(\`Added \${product.name} to the shopping cart!\`);
    }
  }, [product.isInCart]);

  return <div>{product.name}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(1);
  });

  it("flags non-destructured prop parameters", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-props-parameter", {
      files: {
        "src/ProductPage.tsx": `import { useEffect } from "react";

declare const showNotification: (message: string) => void;

interface Product { isInCart: boolean; name: string }

export const ProductPage = (props: { product: Product }) => {
  useEffect(() => {
    if (props.product.isInCart) {
      showNotification(\`Added \${props.product.name} to the shopping cart!\`);
    }
  }, [props.product.isInCart]);

  return <div>{props.product.name}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(1);
  });

  it("flags aliased destructured props with binary guards", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-aliased-binary", {
      files: {
        "src/ProductPage.tsx": `import { useEffect } from "react";

declare const showNotification: (message: string) => void;

interface Product { isInCart: boolean; name: string }

export const ProductPage = ({ product: item }: { product: Product }) => {
  useEffect(() => {
    if (item.isInCart === true) {
      showNotification(\`Added \${item.name} to the shopping cart!\`);
    }
  }, [item.isInCart]);

  return <div>{item.name}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(1);
  });

  it("flags optional-chain logical guards", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-optional-logical", {
      files: {
        "src/ProductPage.tsx": `import { useEffect } from "react";

declare const showNotification: (message: string) => void;

interface Product { isInCart: boolean; name: string }

export const ProductPage = ({
  product,
  shouldNotify,
}: {
  product: Product | null;
  shouldNotify: boolean;
}) => {
  useEffect(() => {
    if (product?.isInCart && shouldNotify) {
      showNotification(\`Added \${product.name} to the shopping cart!\`);
    }
  }, [product?.isInCart, shouldNotify]);

  return <div>{product?.name}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(1);
  });

  it("flags early-return guarded event-like effects", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-early-return", {
      files: {
        "src/Modal.tsx": `import { useEffect } from "react";

export const Modal = ({ isOpen }: { isOpen: boolean }) => {
  useEffect(() => {
    if (!isOpen) return;
    document.body.classList.add("modal-open");
  }, [isOpen]);
  return <div />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(1);
  });

  it("does NOT treat cleanup-only early returns as event-like effects", async () => {
    const projectDir = setupReactProject(
      tempRoot,
      "no-effect-event-handler-early-return-cleanup-only",
      {
        files: {
          "src/Modal.tsx": `import { useEffect } from "react";

export const Modal = ({ isOpen }: { isOpen: boolean }) => {
  useEffect(() => {
    if (!isOpen) return;
    return () => document.body.classList.remove("modal-open");
  }, [isOpen]);
  return <div />;
};
`,
        },
      },
    );

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(0);
  });

  it("flags wrapped component assignments", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-memo-component", {
      files: {
        "src/ProductPage.tsx": `import { memo, useEffect } from "react";

declare const showNotification: (message: string) => void;

interface Product { isInCart: boolean; name: string }

export const ProductPage = memo(({ product }: { product: Product }) => {
  useEffect(() => {
    if (product.isInCart) {
      showNotification(\`Added \${product.name} to the shopping cart!\`);
    }
  }, [product]);

  return <div>{product.name}</div>;
});
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(1);
  });

  it("flags forwardRef component assignments", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-forward-ref", {
      files: {
        "src/ProductPage.tsx": `import { forwardRef, useEffect } from "react";

declare const showNotification: (message: string) => void;

interface Product { isInCart: boolean; name: string }

export const ProductPage = forwardRef<HTMLDivElement, { product: Product }>(
  ({ product }, ref) => {
    useEffect(() => {
      if (product.isInCart) {
        showNotification(\`Added \${product.name} to the shopping cart!\`);
      }
    }, [product.isInCart]);

    return <div ref={ref}>{product.name}</div>;
  },
);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(1);
  });

  it("flags anonymous default-exported arrow components", async () => {
    const projectDir = setupReactProject(
      tempRoot,
      "no-effect-event-handler-default-export-component",
      {
        files: {
          "src/ProductPage.tsx": `import { useEffect } from "react";

declare const showNotification: (message: string) => void;

interface Product { isInCart: boolean; name: string }

export default ({ product }: { product: Product }) => {
  useEffect(() => {
    if (product.isInCart) {
      showNotification(\`Added \${product.name} to the shopping cart!\`);
    }
  }, [product]);

  return <div>{product.name}</div>;
};
`,
        },
      },
    );

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(1);
  });

  it("flags wrapped default-exported components", async () => {
    const projectDir = setupReactProject(
      tempRoot,
      "no-effect-event-handler-wrapped-default-export-component",
      {
        files: {
          "src/ProductPage.tsx": `import { memo, useEffect } from "react";

declare const showNotification: (message: string) => void;

interface Product { isInCart: boolean; name: string }

export default memo(({ product }: { product: Product }) => {
  useEffect(() => {
    if (product.isInCart) {
      showNotification(\`Added \${product.name} to the shopping cart!\`);
    }
  }, [product]);

  return <div>{product.name}</div>;
});
`,
        },
      },
    );

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(1);
  });

  it("does NOT flag when the test's root identifier is not in the deps", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-unrelated-test", {
      files: {
        "src/Page.tsx": `import { useEffect } from "react";

declare const sideEffect: () => void;

export const Page = ({ unrelated }: { unrelated: boolean }) => {
  useEffect(() => {
    if (window.matchMedia("(max-width: 600px)").matches) {
      sideEffect();
    }
  }, [unrelated]);
  return <div />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag when a member dep is for a different prop field than the guard", async () => {
    const projectDir = setupReactProject(
      tempRoot,
      "no-effect-event-handler-mismatched-member-dep",
      {
        files: {
          "src/ProductPage.tsx": `import { useEffect } from "react";

declare const showNotification: (message: string) => void;

interface Product { isInCart: boolean; name: string }

export const ProductPage = ({ product }: { product: Product }) => {
  useEffect(() => {
    if (product.name) {
      showNotification(\`Added \${product.name} to the shopping cart!\`);
    }
  }, [product.isInCart]);

  return <div>{product.name}</div>;
};
`,
        },
      },
    );

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(0);
  });

  it("does NOT claim mixed local-trigger and prop guards belong to the prop rule", async () => {
    const projectDir = setupReactProject(
      tempRoot,
      "no-effect-event-handler-mixed-local-trigger-and-prop-guard",
      {
        files: {
          "src/Wizard.tsx": `import { useEffect, useState } from "react";

declare const navigate: (path: string) => void;

export const Wizard = ({ isEnabled }: { isEnabled: boolean }) => {
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => {
    if (destination && isEnabled) {
      navigate(destination);
    }
  }, [destination, isEnabled]);
  return <button onClick={() => setDestination("/next")}>Next</button>;
};
`,
        },
      },
    );

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag event-shaped effects for custom-hook-derived data", async () => {
    const projectDir = setupReactProject(
      tempRoot,
      "no-effect-event-handler-hook-derived-event-shaped",
      {
        files: {
          "src/CartNotification.tsx": `import { useEffect } from "react";

declare const showNotification: (message: string) => void;
declare const useCartProduct: () => { product: { isInCart: boolean; name: string } };

export const CartNotification = () => {
  const { product } = useCartProduct();

  useEffect(() => {
    if (product.isInCart) {
      showNotification(\`Added \${product.name} to the shopping cart!\`);
    }
  }, [product]);

  return <div>{product.name}</div>;
};
`,
        },
      },
    );

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag early-return effects for custom-hook-derived data", async () => {
    const projectDir = setupReactProject(
      tempRoot,
      "no-effect-event-handler-hook-derived-early-return",
      {
        files: {
          "src/CartNotification.tsx": `import { useEffect } from "react";

declare const showNotification: (message: string) => void;
declare const useCartProduct: () => { product: { isInCart: boolean; name: string } };

export const CartNotification = () => {
  const { product } = useCartProduct();

  useEffect(() => {
    if (!product.isInCart) return;
    showNotification(\`Added \${product.name} to the shopping cart!\`);
  }, [product.isInCart]);

  return <div>{product.name}</div>;
};
`,
        },
      },
    );

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag local trigger state handled by no-event-trigger-state", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-local-trigger-state", {
      files: {
        "src/Wizard.tsx": `import { useEffect, useState } from "react";

declare const navigate: (path: string) => void;

export const Wizard = () => {
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => {
    if (destination) {
      navigate(destination);
    }
  }, [destination]);
  return <button onClick={() => setDestination("/next")}>Next</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag imported setUser external synchronization", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-imported-set-user", {
      files: {
        "src/SentryUserScope.tsx": `import { setUser } from "@sentry/react";
import { useEffect } from "react";

declare const useViewer: () => { viewer: { userId: string; screenName: string } | null };

export const SentryUserScope = () => {
  const { viewer } = useViewer();

  useEffect(() => {
    if (viewer) {
      setUser({ id: viewer.userId, username: viewer.screenName });
    }
  }, [viewer]);

  return null;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag namespace setUser external synchronization", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-namespace-set-user", {
      files: {
        "src/SentryUserScope.tsx": `import * as Sentry from "@sentry/react";
import { useEffect } from "react";

declare const useViewer: () => { viewer: { userId: string; screenName: string } | null };

export const SentryUserScope = () => {
  const { viewer } = useViewer();

  useEffect(() => {
    if (viewer) {
      Sentry.setUser({ id: viewer.userId, username: viewer.screenName });
    }
  }, [viewer]);

  return null;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(0);
  });
});
