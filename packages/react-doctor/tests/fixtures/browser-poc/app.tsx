import React from "react";
import { createRoot } from "react-dom/client";

interface DemoUserCardProps {
  userID: number;
}

interface BrowserPocDemoState {
  componentCount: number;
  diagnosticCount: number;
  names: string[];
}

const DemoUserCard = ({ userID }: DemoUserCardProps) => {
  const [name, setName] = React.useState("loading");

  React.useEffect(() => {
    fetch("data:application/json,%7B%7D").then(() => {
      setName(`user ${userID}`);
    });
  }, [userID]);

  return (
    <article data-testid="demo-user-card">
      <h2>{name}</h2>
      <p>This component intentionally fetches inside an effect for the POC.</p>
    </article>
  );
};

const readSnapshot = (): BrowserPocDemoState => {
  const snapshot = window.reactDoctorBrowserPoc.collectNow();
  const diagnosticCount = snapshot.components.reduce(
    (totalCount, component) => totalCount + component.diagnostics.length,
    0,
  );
  return {
    componentCount: snapshot.components.length,
    diagnosticCount,
    names: snapshot.components.map((component) => component.displayName),
  };
};

const App = () => {
  const [snapshot, setSnapshot] = React.useState<BrowserPocDemoState | null>(null);

  return (
    <main>
      <h1>React Doctor Browser POC</h1>
      <DemoUserCard userID={1} />
      <button type="button" onClick={() => setSnapshot(readSnapshot())}>
        Collect fibers
      </button>
      <pre data-testid="browser-poc-output">{JSON.stringify(snapshot, null, 2)}</pre>
    </main>
  );
};

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element");
}

createRoot(rootElement).render(<App />);
