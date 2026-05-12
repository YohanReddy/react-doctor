import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const benchmarkRoot = path.join(workspaceRoot, "tmp/leaderboard-regression");
const outputRoot = path.join(benchmarkRoot, "reports");
const v1CliPath = path.join(workspaceRoot, "packages/react-doctor/bin/react-doctor.js");
const v2CliPath = path.join(workspaceRoot, "packages/react-doctor-v2/bin/react-doctor.js");
const timeoutMilliseconds = 180_000;

const repositories = [
  { name: "executor", directory: "executor" },
  { name: "nodejs.org", directory: "nodejs-org" },
  { name: "tldraw", directory: "tldraw" },
  { name: "t3code", directory: "t3code" },
  { name: "better-auth", directory: "better-auth" },
  { name: "excalidraw", directory: "excalidraw" },
  { name: "mastra", directory: "mastra" },
  { name: "payload", directory: "payload" },
  { name: "typebot", directory: "typebot-io" },
  { name: "plane", directory: "plane" },
];

const runCommand = async (label, command, args) =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        CI: "true",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, timeoutMilliseconds);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({
        label,
        command: [command, ...args].join(" "),
        exitCode,
        signal,
        durationMilliseconds: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
  });

const parseJsonOutput = (run) => {
  try {
    return JSON.parse(run.stdout.trim());
  } catch (error) {
    return {
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
};

const countBy = (items, getKey) => {
  const counts = new Map();
  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
    .slice(0, 10)
    .map(([rule, count]) => ({ rule, count }));
};

const toV1Summary = (report) => {
  const diagnostics = Array.isArray(report.diagnostics) ? report.diagnostics : [];
  return {
    ok: report.ok === true,
    error: report.error?.message ?? null,
    score: report.summary?.score ?? null,
    scoreLabel: report.summary?.scoreLabel ?? null,
    totalCount: report.summary?.totalDiagnosticCount ?? diagnostics.length,
    errorCount: report.summary?.errorCount ?? diagnostics.filter((item) => item.severity === "error").length,
    warningCount:
      report.summary?.warningCount ?? diagnostics.filter((item) => item.severity === "warning").length,
    affectedFileCount: report.summary?.affectedFileCount ?? null,
    projectFramework: report.projects?.[0]?.project?.framework ?? null,
    topRules: countBy(diagnostics, (item) => `${item.plugin ?? "unknown"}/${item.rule ?? "unknown"}`),
  };
};

const toV2RuleKey = (issue) => {
  if (issue.source?.pluginName && issue.source?.ruleId) {
    return `${issue.source.pluginName}/${issue.source.ruleId}`;
  }
  return issue.source?.ruleId ?? issue.id ?? "unknown";
};

const toV2Summary = (report) => {
  const issues = Array.isArray(report.issues) ? report.issues : [];
  return {
    ok: report.ok === true,
    score: report.summary?.score ?? null,
    scoreLabel: report.summary?.scoreLabel ?? null,
    totalCount: report.summary?.totalIssueCount ?? issues.length,
    errorCount: report.summary?.errorCount ?? issues.filter((item) => item.severity === "error").length,
    warningCount:
      report.summary?.warningCount ?? issues.filter((item) => item.severity === "warning").length,
    affectedFileCount: report.summary?.affectedFileCount ?? null,
    projectFramework: report.project?.framework ?? null,
    failedChecks: Array.isArray(report.checks)
      ? report.checks.filter((check) => check.status === "failed").map((check) => ({
          id: check.id,
          error: check.error?.message ?? null,
        }))
      : [],
    topRules: countBy(issues, toV2RuleKey),
  };
};

const toRegressionFlags = (v1, v2, v1Run, v2Run, parsedV1, parsedV2) => {
  const flags = [];
  if (v1Run.signal || v1Run.exitCode === null) flags.push(`v1 ${v1Run.signal ?? "did not exit"}`);
  if (v2Run.signal || v2Run.exitCode === null) flags.push(`v2 ${v2Run.signal ?? "did not exit"}`);
  if (parsedV1.parseError) flags.push(`v1 JSON parse failed: ${parsedV1.parseError}`);
  if (parsedV2.parseError) flags.push(`v2 JSON parse failed: ${parsedV2.parseError}`);
  if (v2.failedChecks?.length) {
    flags.push(`v2 failed checks: ${v2.failedChecks.map((check) => check.id).join(", ")}`);
  }
  if (typeof v1.score === "number" && typeof v2.score === "number" && v2.score + 10 < v1.score) {
    flags.push(`v2 score is ${v1.score - v2.score} points lower`);
  }
  if (v2.errorCount > v1.errorCount) {
    flags.push(`v2 has ${v2.errorCount - v1.errorCount} more errors`);
  }
  if (v2.totalCount > Math.max(v1.totalCount * 2, v1.totalCount + 25)) {
    flags.push(`v2 issue count is much higher (${v1.totalCount} -> ${v2.totalCount})`);
  }
  return flags;
};

await fs.mkdir(outputRoot, { recursive: true });

const summaries = [];
for (const repository of repositories) {
  const repositoryPath = path.join(benchmarkRoot, repository.directory);
  console.log(`\n== ${repository.name} ==`);
  const v1Run = await runCommand("v1", "node", [
    v1CliPath,
    repositoryPath,
    "--json",
    "--json-compact",
    "--offline",
    "--full",
    "--fail-on",
    "none",
  ]);
  console.log(`v1 exit=${v1Run.exitCode} signal=${v1Run.signal ?? "-"} ms=${v1Run.durationMilliseconds}`);
  const v2Run = await runCommand("v2", "node", [
    v2CliPath,
    repositoryPath,
    "--json",
    "--json-compact",
    "--offline",
    "--fail-on",
    "none",
  ]);
  console.log(`v2 exit=${v2Run.exitCode} signal=${v2Run.signal ?? "-"} ms=${v2Run.durationMilliseconds}`);

  const parsedV1 = parseJsonOutput(v1Run);
  const parsedV2 = parseJsonOutput(v2Run);
  const v1 = toV1Summary(parsedV1);
  const v2 = toV2Summary(parsedV2);
  const regressionFlags = toRegressionFlags(v1, v2, v1Run, v2Run, parsedV1, parsedV2);
  const summary = {
    repository: repository.name,
    path: repositoryPath,
    v1,
    v2,
    durations: {
      v1Milliseconds: v1Run.durationMilliseconds,
      v2Milliseconds: v2Run.durationMilliseconds,
    },
    exit: {
      v1: { exitCode: v1Run.exitCode, signal: v1Run.signal },
      v2: { exitCode: v2Run.exitCode, signal: v2Run.signal },
    },
    regressionFlags,
  };
  summaries.push(summary);
  await fs.writeFile(path.join(outputRoot, `${repository.directory}.v1.stdout.json`), v1Run.stdout);
  await fs.writeFile(path.join(outputRoot, `${repository.directory}.v1.stderr.txt`), v1Run.stderr);
  await fs.writeFile(path.join(outputRoot, `${repository.directory}.v2.stdout.json`), v2Run.stdout);
  await fs.writeFile(path.join(outputRoot, `${repository.directory}.v2.stderr.txt`), v2Run.stderr);
  await fs.writeFile(
    path.join(outputRoot, `${repository.directory}.summary.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
}

await fs.writeFile(path.join(outputRoot, "summary.json"), `${JSON.stringify(summaries, null, 2)}\n`);
console.log(`\nWrote ${path.join(outputRoot, "summary.json")}`);
