import path from "node:path";
import { findWorstScoredProject } from "@react-doctor/core";
import type { Diagnostic, JsonReport, JsonReportProjectEntry } from "@react-doctor/types";

const PR_COMMENT_MARKER = "<!-- react-doctor -->";
const MAX_INLINE_DIAGNOSTICS = 25;
const MAX_PROJECTS_LISTED = 12;

interface RuleGroup {
  ruleKey: string;
  diagnostics: Diagnostic[];
}

const groupDiagnosticsByRule = (diagnostics: Diagnostic[]): RuleGroup[] => {
  const groupsByKey = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    const ruleKey = `${diagnostic.plugin}/${diagnostic.rule}`;
    const collected = groupsByKey.get(ruleKey);
    if (collected) {
      collected.push(diagnostic);
    } else {
      groupsByKey.set(ruleKey, [diagnostic]);
    }
  }
  return [...groupsByKey.entries()]
    .map(([ruleKey, ruleDiagnostics]) => ({ ruleKey, diagnostics: ruleDiagnostics }))
    .sort(
      (firstGroup, secondGroup) => secondGroup.diagnostics.length - firstGroup.diagnostics.length,
    );
};

const formatScoreLine = (project: JsonReportProjectEntry | null): string => {
  if (!project?.score) return "";
  return `**Score:** \`${project.score.score}\` / 100 (${project.score.label})\n\n`;
};

const formatHeader = (report: JsonReport): string => {
  const newCount = report.summary.totalDiagnosticCount;
  const baselineCount = report.summary.baselineDiagnosticCount;

  if (newCount === 0 && baselineCount === 0) {
    return `## React Doctor

No issues found.`;
  }

  if (newCount === 0 && baselineCount > 0) {
    return `## React Doctor

${baselineCount} known baseline issue${baselineCount === 1 ? "" : "s"} - **no new violations introduced by this PR.**`;
  }

  const newLabel = `${newCount} new issue${newCount === 1 ? "" : "s"}`;
  const baselineLabel = baselineCount > 0 ? ` (plus ${baselineCount} baseline)` : "";
  return `## React Doctor

${newLabel}${baselineLabel}.`;
};

const formatRelativeFilePath = (filePath: string, baseDirectory: string): string => {
  if (!path.isAbsolute(filePath)) return filePath.split(path.sep).join("/");
  return path.relative(baseDirectory, filePath).split(path.sep).join("/");
};

const formatDiagnosticBullet = (diagnostic: Diagnostic, baseDirectory: string): string => {
  const filePathLabel = formatRelativeFilePath(diagnostic.filePath, baseDirectory);
  const positionLabel = diagnostic.line > 0 ? `${filePathLabel}:${diagnostic.line}` : filePathLabel;
  const severityIcon = diagnostic.severity === "error" ? "❌" : "⚠️";
  const sanitizedMessage = diagnostic.message.replace(/\s+/g, " ").trim();
  return `- ${severityIcon} \`${positionLabel}\` - ${sanitizedMessage}`;
};

const formatProjectSummary = (project: JsonReportProjectEntry, baseDirectory: string): string => {
  const score = project.score ? `${project.score.score}/100` : "-";
  const newCount = project.diagnostics.length;
  const baselineCount = project.baselineDiagnostics?.length ?? 0;
  const projectLabel =
    project.project.projectName ||
    formatRelativeFilePath(project.directory, baseDirectory) ||
    "(root)";
  const newPart = newCount === 0 ? "no new" : `${newCount} new`;
  const baselinePart = baselineCount > 0 ? `, ${baselineCount} baseline` : "";
  return `- **${projectLabel}** - score ${score}, ${newPart}${baselinePart}`;
};

const formatPerProjectSection = (report: JsonReport, baseDirectory: string): string => {
  if (report.projects.length <= 1) return "";
  const projectsToShow = report.projects.slice(0, MAX_PROJECTS_LISTED);
  const overflowCount = Math.max(0, report.projects.length - projectsToShow.length);
  const lines = projectsToShow.map((project) => formatProjectSummary(project, baseDirectory));
  if (overflowCount > 0) {
    lines.push(
      `- _+${overflowCount} more workspace project${overflowCount === 1 ? "" : "s"} not shown_`,
    );
  }
  return `\n\n### Per-package summary\n\n${lines.join("\n")}`;
};

const formatRiskyFixSuppressionHint = (diagnostic: Diagnostic): string => {
  // HACK: per-rule suppression snippet for the diagnostic - keeps PR
  // comments actionable without forcing every user to open the docs.
  if (diagnostic.suppressionHint) return diagnostic.suppressionHint;
  const ruleKey = `${diagnostic.plugin}/${diagnostic.rule}`;
  return `// eslint-disable-next-line ${ruleKey} -- intentional`;
};

const formatDiagnosticsSection = (diagnostics: Diagnostic[], baseDirectory: string): string => {
  if (diagnostics.length === 0) return "";
  const groups = groupDiagnosticsByRule(diagnostics);
  let renderedCount = 0;
  let diagnosticsAccountedForCount = 0;
  const sections: string[] = [];
  for (const group of groups) {
    const { ruleKey: ruleLabel, diagnostics: groupDiagnostics } = group;
    const groupDiagnosticCount = groupDiagnostics.length;
    const bullets: string[] = [];
    for (const diagnostic of groupDiagnostics) {
      if (renderedCount >= MAX_INLINE_DIAGNOSTICS) break;
      bullets.push(formatDiagnosticBullet(diagnostic, baseDirectory));
      renderedCount += 1;
    }
    if (bullets.length === 0) break;
    const remainderCount = groupDiagnosticCount - bullets.length;
    const remainderNote = remainderCount > 0 ? `\n- _+${remainderCount} more in this rule_` : "";
    const suppressionHint = formatRiskyFixSuppressionHint(groupDiagnostics[0]);
    sections.push(
      `<details>
<summary><b>${ruleLabel}</b> · ${groupDiagnosticCount} occurrence${groupDiagnosticCount === 1 ? "" : "s"}</summary>

${bullets.join("\n")}${remainderNote}

Suppress with: \`${suppressionHint}\`
</details>`,
    );
    // The whole group is "accounted for" once its <summary> + remainder
    // line surface its full diagnostic count, even when only the first
    // few bullets are rendered. The footer's "N hidden" should count
    // ONLY rule groups that didn't make it into `sections` at all -
    // otherwise the same diagnostics show up twice (once in the
    // group's "+N more in this rule" line, once in the footer).
    diagnosticsAccountedForCount += groupDiagnosticCount;
    if (renderedCount >= MAX_INLINE_DIAGNOSTICS) break;
  }
  const overflowCount = diagnostics.length - diagnosticsAccountedForCount;
  const overflowNote =
    overflowCount > 0
      ? `\n\n> _${overflowCount} more finding${overflowCount === 1 ? "" : "s"} hidden - run \`npx react-doctor@latest .\` locally for the full list._`
      : "";
  return `\n\n### Findings\n\n${sections.join("\n\n")}${overflowNote}`;
};

const formatFooter = (report: JsonReport): string => {
  const lines: string[] = [];
  if (report.diff) {
    const diffLabel = report.diff.isCurrentChanges
      ? "uncommitted changes"
      : `${report.diff.currentBranch} → ${report.diff.baseBranch}`;
    lines.push(
      `Scanned ${diffLabel} (${report.diff.changedFileCount} file${report.diff.changedFileCount === 1 ? "" : "s"}).`,
    );
  }
  const touchedLinesHidden = report.projects.reduce(
    (totalHidden, project) => totalHidden + (project.diagnosticsHiddenByTouchedLines ?? 0),
    0,
  );
  if (touchedLinesHidden > 0) {
    lines.push(
      `${touchedLinesHidden} diagnostic${touchedLinesHidden === 1 ? "" : "s"} hidden by touched-line filtering.`,
    );
  }
  if (lines.length === 0) return "";
  return `\n\n<sub>${lines.join(" · ")}</sub>`;
};

/**
 * Render a JSON report as sticky-comment-ready markdown. Emits a
 * leading HTML marker (`<!-- react-doctor -->`) so a GitHub Action
 * comment-updater can find and replace its previous post idempotently
 * - the same marker `action.yml` looks for when locating the existing
 * comment.
 */
export const buildPrCommentMarkdown = (
  report: JsonReport,
  options: { baseDirectory?: string } = {},
): string => {
  const baseDirectory = options.baseDirectory ?? report.directory;
  const headlineProject = findWorstScoredProject(report.projects);
  const sections: string[] = [PR_COMMENT_MARKER, formatHeader(report)];
  const scoreLine = formatScoreLine(headlineProject);
  if (scoreLine.length > 0) {
    sections.push(scoreLine.trimEnd());
  }
  const perProjectSection = formatPerProjectSection(report, baseDirectory);
  if (perProjectSection) sections.push(perProjectSection.trimStart());
  const diagnosticsSection = formatDiagnosticsSection(report.diagnostics, baseDirectory);
  if (diagnosticsSection) sections.push(diagnosticsSection.trimStart());
  const footer = formatFooter(report);
  if (footer) sections.push(footer.trimStart());
  return sections.join("\n\n");
};
