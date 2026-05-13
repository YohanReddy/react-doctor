import { defineRule } from "../../registry.js";
import {
  ROUTE_HANDLER_FILE_PATTERN,
  buildProgramBindingLookup,
  extractMutatingRouteSegment,
  findSideEffect,
  isExportedGetHandler,
  resolveGetHandlerBodies,
} from "./utils/index.js";
import { CRON_ROUTE_PATTERN } from "../constants.js";
import type { EsTreeNode, Rule, RuleContext } from "./utils/index.js";

export const nextjsNoSideEffectInGetHandler = defineRule<Rule>({
  recommendation:
    "Keep GET route handlers idempotent and move mutations, logging with side effects, and writes to POST or server actions.",
  examples: [
    {
      before: `export async function GET() { await db.user.create({ data }); }`,
      after: `export async function POST() { await db.user.create({ data }); }`,
    },
  ],
  create: (context: RuleContext) => {
    let resolveBinding: (identifierName: string) => EsTreeNode | null = () => null;

    return {
      Program(node: EsTreeNode) {
        resolveBinding = buildProgramBindingLookup(node);
      },
      ExportNamedDeclaration(node: EsTreeNode) {
        const filename = context.getFilename?.() ?? "";
        if (!ROUTE_HANDLER_FILE_PATTERN.test(filename)) return;
        if (CRON_ROUTE_PATTERN.test(filename)) return;
        if (!isExportedGetHandler(node)) return;

        const mutatingSegment = extractMutatingRouteSegment(filename);
        if (mutatingSegment) {
          context.report({
            node,
            message: `GET handler on "/${mutatingSegment}" route - use POST to prevent CSRF and unintended prefetch triggers`,
          });
          return;
        }

        const handlerBodies = resolveGetHandlerBodies(node, resolveBinding);
        for (const handlerBody of handlerBodies) {
          const sideEffect = findSideEffect(handlerBody);
          if (!sideEffect) continue;
          context.report({
            node,
            message: `GET handler has side effects (${sideEffect}) - use POST to prevent CSRF and unintended prefetch triggers`,
          });
          return;
        }
      },
    };
  },
});
