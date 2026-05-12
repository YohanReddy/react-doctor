import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const reportRoot = path.join(workspaceRoot, "tmp/leaderboard-regression/reports");
const outputRoot = path.join(reportRoot, "v2-on-v1-projects");
const v2CliPath = path.join(workspaceRoot, "packages/react-doctor-v2/bin/react-doctor.js");
const timeoutMilliseconds = 120_000;

const repositories = [
  "executor",
  "nodejs-org",
  "tldraw",
  "t3code",
  "better-auth",
  "excalidraw",
  "mastra",
  "payload",
  "typebot-io",
  "plane",
];

const runCommand = async (args) =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn("node", args, {
      cwd: workspaceRoot,
      env: { ...process.env, CI: "true", FORCE_COLOR: "0", NO_COLOR: "1" },
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
      resolve({ exitCode, signal, stdout, stderr, durationMilliseconds: Date.now() - startedAt });
    });
  });

const parseJson = (stdout) => {
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return null;
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

const toRuleKey = (issue) => {
  if (issue.source?.pluginName && issue.source?.ruleId) {
    return `${issue.source.pluginName}/${issue.source.ruleId}`;
  }
  return issue.source?.ruleId ?? issue.id ?? "unknown";
};

await fs.mkdir(outputRoot, { recursive: true });
const summaries = [];

for (const repository of repositories) {
  const v1Report = JSON.parse(
    await fs.readFile(path.join(reportRoot, `${repository}.v1.stdout.json`), "utf8"),
  );
  const projectDirectories = (v1Report.projects ?? []).map((project) => project.directory);
  const projectSummaries = [];
  console.log(`\n== ${repository} (${projectDirectories.length} projects) ==`);

  for (const projectDirectory of projectDirectories) {
    const run = await runCommand([
      v2CliPath,
      projectDirectory,
      "--json",
      "--json-compact",
      "--offline",
      "--fail-on",
      "none",
    ]);
    const report = parseJson(run.stdout);
    const issues = Array.isArray(report?.issues) ? report.issues : [];
    const failedChecks = Array.isArray(report?.checks)
      ? report.checks.filter((check) => check.status === "failed")
      : [];
    projectSummaries.push({
      directory: projectDirectory,
      exitCode: run.exitCode,
      signal: run.signal,
      durationMilliseconds: run.durationMilliseconds,
      parsed: Boolean(report),
      framework: report?.project?.framework ?? null,
      score: report?.summary?.score ?? null,
      totalCount: report?.summary?.totalIssueCount ?? issues.length,
      errorCount:
        report?.summary?.errorCount ?? issues.filter((issue) => issue.severity === "error").length,
      warningCount:
        report?.summary?.warningCount ??
        issues.filter((issue) => issue.severity === "warning").length,
      failedChecks: failedChecks.map((check) => ({
        id: check.id,
        error: check.error?.message ?? null,
      })),
      topRules: countBy(issues, toRuleKey),
    });
    console.log(`${path.relative(workspaceRoot, projectDirectory)} issues=${projectSummaries.at(-1).totalCount}`);
  }

  const flattenedTopRules = [];
  for (const project of projectSummaries) {
    for (const rule of project.topRules) {
      flattenedTopRules.push(...Array.from({ length: rule.count }, () => ({ rule: rule.rule })));
    }
  }

  const summary = {
    repository,
    projectCount: projectSummaries.length,
    totalCount: projectSummaries.reduce((total, project) => total + project.totalCount, 0),
    errorCount: projectSummaries.reduce((total, project) => total + project.errorCount, 0),
    warningCount: projectSummaries.reduce((total, project) => total + project.warningCount, 0),
    failedChecks: projectSummaries.flatMap((project) =>
      project.failedChecks.map((check) => ({ directory: project.directory, ...check })),
    ),
    unknownFrameworkCount: projectSummaries.filter((project) => project.framework === "unknown").length,
    topRules: countBy(flattenedTopRules, (item) => item.rule),
    projects: projectSummaries,
  };
  summaries.push(summary);
  await fs.writeFile(
    path.join(outputRoot, `${repository}.summary.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
}

await fs.writeFile(path.join(outputRoot, "summary.json"), `${JSON.stringify(summaries, null, 2)}\n`);
console.log(`\nWrote ${path.join(outputRoot, "summary.json")}`);
