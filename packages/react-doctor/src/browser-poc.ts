import {
  _fiberRoots,
  getDisplayName,
  getNearestHostFiber,
  getTimings,
  getType,
  instrument,
  isCompositeFiber,
  secure,
  traverseFiber,
  type Fiber,
  type FiberRoot,
} from "bippy";
import { initSync, parseSync } from "@oxc-parser/wasm/web/oxc_parser_wasm.js";
import oxcParserWasmBytes from "@oxc-parser/wasm/web/oxc_parser_wasm_bg.wasm";
import reactDoctorPlugin from "./plugin/index.js";
import type { EsTreeNode, RuleVisitors } from "./plugin/types.js";
import {
  BROWSER_POC_FUNCTION_SOURCE_MAX_CHARS,
  BROWSER_POC_HOST_SELECTOR_MAX_COUNT,
  ERROR_RULE_PENALTY,
  PERFECT_SCORE,
  SCORE_GOOD_THRESHOLD,
  SCORE_OK_THRESHOLD,
  WARNING_RULE_PENALTY,
} from "./constants.js";

export interface BrowserPocOptions {
  dangerouslyRunInProduction?: boolean;
  log?: boolean;
}

export interface BrowserPocSourceLocation {
  fileName: string;
  lineNumber: number;
  columnNumber: number | null;
}

export interface BrowserPocRuntimeDiagnostic {
  rule: string;
  severity: "warning" | "error";
  message: string;
  lineNumber: number | null;
  columnNumber: number | null;
}

export interface BrowserPocRuleFailure {
  rule: string;
  error: string;
}

export interface BrowserPocRuleRunResult {
  attempted: number;
  completed: number;
  failed: number;
  failedRules: BrowserPocRuleFailure[];
}

export interface BrowserPocParseResult {
  status: "parsed" | "parse-error" | "skipped" | "wasm-error";
  error: string | null;
}

export interface BrowserPocComponentRecord {
  id: number;
  displayName: string;
  tag: number;
  instanceCount: number;
  commitCount: number;
  selfTime: number;
  totalTime: number;
  hookNames: string[];
  hostSelector: string | null;
  sourceLocation: BrowserPocSourceLocation | null;
  source: string | null;
  parseResult: BrowserPocParseResult;
  ruleRunResult: BrowserPocRuleRunResult;
  diagnostics: BrowserPocRuntimeDiagnostic[];
}

interface BrowserPocAstNode extends EsTreeNode {
  type: string;
  name?: string;
  value?: unknown;
  raw?: string;
  operator?: string;
  argument?: BrowserPocAstNode;
  object?: BrowserPocAstNode;
  property?: BrowserPocAstNode;
  callee?: BrowserPocAstNode;
  id?: BrowserPocAstNode;
  init?: BrowserPocAstNode;
  body?: BrowserPocAstNode | BrowserPocAstNode[];
  program?: BrowserPocAstNode;
  declarations?: BrowserPocAstNode[];
  elements?: Array<BrowserPocAstNode | null>;
  expressions?: BrowserPocAstNode[];
  arguments?: BrowserPocAstNode[];
  params?: BrowserPocAstNode[];
  [key: string]: unknown;
}

export interface BrowserPocScoreResult {
  score: number;
  label: string;
}

export interface BrowserPocSnapshot {
  isActive: boolean;
  lastRendererID: number | null;
  rootCount: number;
  commitCount: number;
  components: BrowserPocComponentRecord[];
  scoreResult: BrowserPocScoreResult;
}

export interface BrowserPocController {
  snapshot: () => BrowserPocSnapshot;
  collectNow: () => BrowserPocSnapshot;
}

declare global {
  interface Window {
    __reactDoctorBrowserPocOptions?: BrowserPocOptions;
    reactDoctorBrowserPoc: BrowserPocController;
  }
}

const componentRecordsByType = new Map<unknown, BrowserPocComponentRecord>();
const componentTypesByID = new Map<number, unknown>();
let nextComponentID = 1;
let lastRendererID: number | null = null;
let commitCount = 0;
let isActive = false;
let oxcWasmState: "pending" | "ready" | BrowserPocParseResult = "pending";
const STACK_LOCATION_PATTERN = /\(?((?:[a-zA-Z][a-zA-Z\d+.-]*:\/\/|\/).+):(\d+):(\d+)\)?$/;

const SKIPPED_PARSE_RESULT: BrowserPocParseResult = {
  status: "skipped",
  error: null,
};

const SKIPPED_RULE_RUN_RESULT: BrowserPocRuleRunResult = {
  attempted: 0,
  completed: 0,
  failed: 0,
  failedRules: [],
};

const initializeOxcWasm = (): BrowserPocParseResult | null => {
  if (oxcWasmState === "ready") return null;
  if (typeof oxcWasmState === "object") return oxcWasmState;
  try {
    initSync(oxcParserWasmBytes);
    oxcWasmState = "ready";
    return null;
  } catch (error) {
    const wasmError: BrowserPocParseResult = {
      status: "wasm-error",
      error: error instanceof Error ? error.message : String(error),
    };
    oxcWasmState = wasmError;
    return wasmError;
  }
};

interface BrowserPocFunctionSource {
  code: string;
  isTruncated: boolean;
}

const getFunctionSource = (componentType: unknown): BrowserPocFunctionSource | null => {
  if (typeof componentType !== "function") return null;
  const source = Function.prototype.toString.call(componentType);
  if (!source || source.includes("[native code]")) return null;
  if (source.length > BROWSER_POC_FUNCTION_SOURCE_MAX_CHARS) {
    return {
      code: source.slice(0, BROWSER_POC_FUNCTION_SOURCE_MAX_CHARS),
      isTruncated: true,
    };
  }
  return { code: source, isTruncated: false };
};

const getSourceLocation = (fiber: Fiber): BrowserPocSourceLocation | null => {
  const debugSource = fiber._debugSource;
  if (debugSource) {
    return {
      fileName: debugSource.fileName,
      lineNumber: debugSource.lineNumber,
      columnNumber: debugSource.columnNumber ?? null,
    };
  }

  const debugStack = fiber._debugStack?.stack;
  if (!debugStack) return null;
  for (const stackLine of debugStack.split("\n")) {
    const match = STACK_LOCATION_PATTERN.exec(stackLine.trim());
    if (!match) continue;
    const fileName = match[1];
    const lineNumber = Number(match[2]);
    const columnNumber = Number(match[3]);
    if (!fileName || !Number.isFinite(lineNumber)) continue;
    if (fileName.includes("/node_modules/")) continue;
    return {
      fileName,
      lineNumber,
      columnNumber: Number.isFinite(columnNumber) ? columnNumber : null,
    };
  }
  return null;
};

const getHostSelector = (fiber: Fiber): string | null => {
  const hostFiber = getNearestHostFiber(fiber);
  const hostNode = hostFiber?.stateNode;
  if (!(hostNode instanceof Element)) return null;
  const selectorParts: string[] = [];
  let currentElement: Element | null = hostNode;
  while (
    currentElement &&
    selectorParts.length < BROWSER_POC_HOST_SELECTOR_MAX_COUNT &&
    currentElement !== document.documentElement
  ) {
    const id = currentElement.id ? `#${CSS.escape(currentElement.id)}` : "";
    const testId = currentElement.getAttribute("data-testid");
    const dataSelector = testId ? `[data-testid="${CSS.escape(testId)}"]` : "";
    const selector = id || dataSelector || currentElement.tagName.toLowerCase();
    selectorParts.unshift(selector);
    if (id) break;
    currentElement = currentElement.parentElement;
  }
  return selectorParts.join(" > ");
};

const getHookNames = (fiber: Fiber): string[] => {
  const hookNames = fiber._debugHookTypes;
  return Array.isArray(hookNames) ? [...new Set(hookNames)] : [];
};

const isAstNode = (value: unknown): value is BrowserPocAstNode => {
  if (!value || typeof value !== "object") return false;
  const maybeNode = value as Record<string, unknown>;
  return typeof maybeNode.type === "string";
};

const walkAst = (node: unknown, visitor: (child: BrowserPocAstNode) => void): void => {
  if (!isAstNode(node)) return;
  visitor(node);
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "parent") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        walkAst(item, visitor);
      }
    } else {
      walkAst(value, visitor);
    }
  }
};

const isIdentifier = (node: BrowserPocAstNode | null | undefined, name: string): boolean =>
  node?.type === "Identifier" && node.name === name;

const isHookCall = (node: BrowserPocAstNode, hookName: string): boolean => {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;
  if (isIdentifier(callee, hookName)) return true;
  return callee?.type === "MemberExpression" && isIdentifier(callee.property, hookName);
};

const isFetchCall = (node: BrowserPocAstNode): boolean =>
  node.type === "CallExpression" && isIdentifier(node.callee, "fetch");

const getEffectCallback = (node: BrowserPocAstNode): BrowserPocAstNode | null => {
  if (!isHookCall(node, "useEffect")) return null;
  const callback = node.arguments?.[0];
  if (callback?.type === "ArrowFunctionExpression" || callback?.type === "FunctionExpression") {
    return callback;
  }
  return null;
};

const hasFetchCall = (node: BrowserPocAstNode): boolean => {
  let didFindFetch = false;
  walkAst(node, (child) => {
    if (isFetchCall(child)) didFindFetch = true;
  });
  return didFindFetch;
};

const createBrowserPocDiagnosticsFromAst = (
  program: BrowserPocAstNode,
): BrowserPocRuntimeDiagnostic[] => {
  const diagnostics: BrowserPocRuntimeDiagnostic[] = [];
  walkAst(program, (node) => {
    const effectCallback = getEffectCallback(node);
    if (!effectCallback) return;
    if (hasFetchCall(effectCallback)) {
      diagnostics.push({
        rule: "browser-poc/no-fetch-in-effect",
        severity: "warning",
        message: "Component has fetch() inside useEffect().",
        lineNumber: null,
        columnNumber: null,
      });
    }
  });
  return diagnostics;
};

const getLineColumn = (
  source: string,
  offset: unknown,
): { lineNumber: number | null; columnNumber: number | null } => {
  if (typeof offset !== "number" || !Number.isFinite(offset)) {
    return { lineNumber: null, columnNumber: null };
  }
  let lineNumber = 1;
  let columnNumber = 1;
  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      columnNumber = 1;
    } else {
      columnNumber += 1;
    }
  }
  return { lineNumber, columnNumber };
};

const getAstChildren = (node: BrowserPocAstNode): BrowserPocAstNode[] => {
  const children: BrowserPocAstNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item)) children.push(item);
      }
    } else if (isAstNode(value)) {
      children.push(value);
    }
  }
  return children;
};

const visitAst = (
  node: BrowserPocAstNode,
  visitors: RuleVisitors,
  parent?: BrowserPocAstNode,
): void => {
  node.parent = parent;
  const enter = visitors[node.type];
  if (enter) enter(node);
  for (const child of getAstChildren(node)) {
    visitAst(child, visitors, node);
  }
  const exit = visitors[`${node.type}:exit`];
  if (exit) exit(node);
};

const runReactDoctorRules = (
  program: BrowserPocAstNode,
  source: string,
): { diagnostics: BrowserPocRuntimeDiagnostic[]; ruleRunResult: BrowserPocRuleRunResult } => {
  const diagnostics: BrowserPocRuntimeDiagnostic[] = [];
  const failedRules: BrowserPocRuleFailure[] = [];
  let completed = 0;
  const ruleEntries = Object.entries(reactDoctorPlugin.rules);

  for (const [ruleName, rule] of ruleEntries) {
    try {
      const visitors = rule.create({
        getFilename: () => "app/component.tsx",
        report: ({ node, message }) => {
          const location = getLineColumn(source, node.start);
          diagnostics.push({
            rule: `${reactDoctorPlugin.meta.name}/${ruleName}`,
            severity: "warning",
            message,
            lineNumber: location.lineNumber,
            columnNumber: location.columnNumber,
          });
        },
      });
      visitAst(program, visitors);
      completed += 1;
    } catch (error) {
      failedRules.push({
        rule: `${reactDoctorPlugin.meta.name}/${ruleName}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    diagnostics,
    ruleRunResult: {
      attempted: ruleEntries.length,
      completed,
      failed: failedRules.length,
      failedRules,
    },
  };
};

const morphNode = (target: BrowserPocAstNode, replacement: BrowserPocAstNode): void => {
  for (const key of Object.keys(target)) {
    if (key === "start" || key === "end") continue;
    delete target[key];
  }
  for (const [key, value] of Object.entries(replacement)) {
    if (key === "start" || key === "end") continue;
    target[key] = value;
  }
};

const SETTER_PREFIX = "set";

const buildSetterName = (valueName: string): string =>
  `${SETTER_PREFIX}${valueName.charAt(0).toUpperCase()}${valueName.slice(1)}`;

const JSX_CALLEE_NAMES = new Set(["jsx", "jsxs", "_jsx", "_jsxs", "createElement"]);

const getNodeCalleeName = (node: BrowserPocAstNode): string | null => {
  const callee = node.callee;
  if (!callee) return null;
  if (callee.type === "Identifier") return callee.name ?? null;
  if (callee.type === "MemberExpression" && callee.property?.type === "Identifier") {
    return callee.property.name ?? null;
  }
  return null;
};

const buildJsxName = (elementType: BrowserPocAstNode): BrowserPocAstNode | null => {
  if (elementType.type === "Literal" && typeof elementType.value === "string") {
    return { type: "JSXIdentifier", name: elementType.value } as BrowserPocAstNode;
  }
  if (elementType.type === "Identifier") {
    return { type: "JSXIdentifier", name: elementType.name } as BrowserPocAstNode;
  }
  if (elementType.type === "MemberExpression" && elementType.property?.type === "Identifier") {
    const objectJsxName = buildJsxName(elementType.object as BrowserPocAstNode);
    if (!objectJsxName) return null;
    return {
      type: "JSXMemberExpression",
      object: objectJsxName,
      property: { type: "JSXIdentifier", name: elementType.property.name },
    } as BrowserPocAstNode;
  }
  return null;
};

const buildJsxAttributeValue = (valueNode: BrowserPocAstNode): BrowserPocAstNode | null => {
  if (valueNode.type === "Literal" && typeof valueNode.value === "string") {
    return valueNode;
  }
  if (valueNode.type === "Literal" && valueNode.value === true) {
    return null;
  }
  return {
    type: "JSXExpressionContainer",
    expression: valueNode,
  } as BrowserPocAstNode;
};

const JSX_NODE_TYPES = new Set(["JSXElement", "JSXFragment", "JSXText", "JSXExpressionContainer"]);

const wrapJsxChild = (child: BrowserPocAstNode): BrowserPocAstNode => {
  if (JSX_NODE_TYPES.has(child.type)) return child;
  if (child.type === "Literal" && typeof child.value === "string") {
    return { type: "JSXText", value: child.value, raw: String(child.value) } as BrowserPocAstNode;
  }
  return {
    type: "JSXExpressionContainer",
    expression: child,
  } as BrowserPocAstNode;
};

const isFragmentType = (elementType: BrowserPocAstNode): boolean => {
  if (elementType.type === "Identifier" && elementType.name === "Fragment") return true;
  if (
    elementType.type === "MemberExpression" &&
    elementType.property?.type === "Identifier" &&
    elementType.property.name === "Fragment"
  ) {
    return true;
  }
  return false;
};

const reconstructJsx = (node: BrowserPocAstNode): void => {
  if (node.type !== "CallExpression") return;
  const calleeName = getNodeCalleeName(node);
  if (!calleeName || !JSX_CALLEE_NAMES.has(calleeName)) return;

  const nodeArguments = node.arguments;
  if (!Array.isArray(nodeArguments) || nodeArguments.length < 1) return;

  const elementType = nodeArguments[0] as BrowserPocAstNode;
  const isFragment = isFragmentType(elementType);

  if (!isFragment) {
    const jsxName = buildJsxName(elementType);
    if (!jsxName) return;
  }

  const jsxName = isFragment ? null : buildJsxName(elementType);
  if (!isFragment && !jsxName) return;

  const attributes: BrowserPocAstNode[] = [];
  const children: BrowserPocAstNode[] = [];
  const propsArg = nodeArguments[1] as BrowserPocAstNode | undefined;
  const isCreateElement = calleeName === "createElement";

  if (propsArg && propsArg.type === "ObjectExpression" && Array.isArray(propsArg.properties)) {
    for (const property of propsArg.properties as BrowserPocAstNode[]) {
      if (property.type === "SpreadElement" || property.type === "RestElement") {
        attributes.push({
          type: "JSXSpreadAttribute",
          argument: property.argument,
        } as BrowserPocAstNode);
        continue;
      }
      if (property.type !== "Property") continue;

      const keyNode = property.key as BrowserPocAstNode | undefined;
      if (!keyNode) continue;
      const keyName =
        keyNode.type === "Identifier"
          ? keyNode.name
          : keyNode.type === "Literal"
            ? String(keyNode.value)
            : null;
      if (!keyName) continue;

      const propertyValue = property.value as BrowserPocAstNode;

      if (keyName === "children") {
        if (propertyValue.type === "ArrayExpression" && Array.isArray(propertyValue.elements)) {
          for (const element of propertyValue.elements as BrowserPocAstNode[]) {
            if (element) children.push(wrapJsxChild(element));
          }
        } else {
          children.push(wrapJsxChild(propertyValue));
        }
        continue;
      }

      const attributeValue = buildJsxAttributeValue(propertyValue);
      attributes.push({
        type: "JSXAttribute",
        name: { type: "JSXIdentifier", name: keyName },
        value: attributeValue,
      } as unknown as BrowserPocAstNode);
    }
  }

  if (isCreateElement) {
    for (let argumentIndex = 2; argumentIndex < nodeArguments.length; argumentIndex++) {
      children.push(wrapJsxChild(nodeArguments[argumentIndex] as BrowserPocAstNode));
    }
  } else if (nodeArguments.length >= 3) {
    const keyArg = nodeArguments[2] as BrowserPocAstNode;
    if (keyArg && keyArg.type !== "Identifier") {
      attributes.push({
        type: "JSXAttribute",
        name: { type: "JSXIdentifier", name: "key" },
        value: buildJsxAttributeValue(keyArg),
      } as unknown as BrowserPocAstNode);
    }
  }

  if (isFragment) {
    morphNode(node, {
      type: "JSXFragment",
      openingFragment: { type: "JSXOpeningFragment" },
      closingFragment: { type: "JSXClosingFragment" },
      children,
    } as unknown as BrowserPocAstNode);
    return;
  }

  const hasChildren = children.length > 0;
  const openingElement = {
    type: "JSXOpeningElement",
    name: jsxName,
    attributes,
    selfClosing: !hasChildren,
  } as unknown as BrowserPocAstNode;

  morphNode(node, {
    type: "JSXElement",
    openingElement,
    closingElement: hasChildren
      ? ({ type: "JSXClosingElement", name: { ...jsxName } } as unknown as BrowserPocAstNode)
      : null,
    children,
  } as unknown as BrowserPocAstNode);
};

const normalizeMinifiedAst = (node: BrowserPocAstNode, displayName: string | null): void => {
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || key === "type" || key === "start" || key === "end") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item)) normalizeMinifiedAst(item, displayName);
      }
    } else if (isAstNode(value)) {
      normalizeMinifiedAst(value as BrowserPocAstNode, displayName);
    }
  }

  if (
    (node.type === "CallExpression" || node.type === "NewExpression") &&
    node.callee?.type === "SequenceExpression"
  ) {
    const expressions = node.callee.expressions;
    if (Array.isArray(expressions) && expressions.length > 0) {
      node.callee = expressions[expressions.length - 1] as BrowserPocAstNode;
    }
  }

  if (
    node.type === "StringLiteral" ||
    node.type === "NumericLiteral" ||
    node.type === "BooleanLiteral" ||
    node.type === "NullLiteral"
  ) {
    const preservedValue = node.type === "NullLiteral" ? null : node.value;
    const preservedRaw = (node.raw as string | undefined) ?? String(preservedValue);
    morphNode(node, {
      type: "Literal",
      value: preservedValue,
      raw: preservedRaw,
    } as BrowserPocAstNode);
  }

  if (
    node.type === "UnaryExpression" &&
    node.operator === "!" &&
    node.argument?.type === "Literal" &&
    typeof node.argument.value === "number"
  ) {
    const numericValue = node.argument.value as number;
    if (numericValue === 0 || numericValue === 1) {
      morphNode(node, {
        type: "Literal",
        value: numericValue === 0,
        raw: numericValue === 0 ? "true" : "false",
      } as BrowserPocAstNode);
    }
  }

  if (
    node.type === "UnaryExpression" &&
    node.operator === "void" &&
    node.argument?.type === "Literal" &&
    node.argument.value === 0
  ) {
    morphNode(node, { type: "Identifier", name: "undefined" } as BrowserPocAstNode);
  }

  if (node.type === "ReturnStatement" && node.argument?.type === "SequenceExpression") {
    const sequenceExpressions = node.argument.expressions;
    if (Array.isArray(sequenceExpressions) && sequenceExpressions.length > 1) {
      const lastExpression = sequenceExpressions[
        sequenceExpressions.length - 1
      ] as BrowserPocAstNode;
      const sideEffectStatements = sequenceExpressions.slice(0, -1).map(
        (expression) =>
          ({
            type: "ExpressionStatement",
            expression,
          }) as unknown as BrowserPocAstNode,
      );
      node.argument = lastExpression;
      node._hoistedStatements = sideEffectStatements;
    }
  }

  if ((node.type === "BlockStatement" || node.type === "Program") && Array.isArray(node.body)) {
    const expandedBody: BrowserPocAstNode[] = [];
    let didExpand = false;
    for (const statement of node.body as BrowserPocAstNode[]) {
      if (
        Array.isArray(statement._hoistedStatements) &&
        (statement._hoistedStatements as BrowserPocAstNode[]).length > 0
      ) {
        expandedBody.push(...(statement._hoistedStatements as BrowserPocAstNode[]));
        delete statement._hoistedStatements;
        didExpand = true;
      }
      const statementExpression = statement.expression as BrowserPocAstNode | undefined;
      if (
        statement.type === "ExpressionStatement" &&
        statementExpression?.type === "SequenceExpression"
      ) {
        const expressions = statementExpression.expressions;
        if (Array.isArray(expressions)) {
          for (const expression of expressions as BrowserPocAstNode[]) {
            expandedBody.push({
              type: "ExpressionStatement",
              expression,
            } as unknown as BrowserPocAstNode);
          }
          didExpand = true;
          continue;
        }
      }
      expandedBody.push(statement);
    }
    if (didExpand) node.body = expandedBody;
  }

  if (
    node.type === "VariableDeclaration" &&
    Array.isArray(node.declarations) &&
    node.declarations.length > 1 &&
    node.parent &&
    isAstNode(node.parent) &&
    (node.parent.type === "BlockStatement" || node.parent.type === "Program")
  ) {
    node._splitDeclarations = (node.declarations as BrowserPocAstNode[]).map(
      (declarator) =>
        ({
          type: "VariableDeclaration",
          kind: node.kind,
          declarations: [declarator],
        }) as unknown as BrowserPocAstNode,
    );
  }

  if ((node.type === "BlockStatement" || node.type === "Program") && Array.isArray(node.body)) {
    let didSplit = false;
    const splitBody: BrowserPocAstNode[] = [];
    for (const statement of node.body as BrowserPocAstNode[]) {
      if (statement.type === "VariableDeclaration" && Array.isArray(statement._splitDeclarations)) {
        splitBody.push(...(statement._splitDeclarations as BrowserPocAstNode[]));
        delete statement._splitDeclarations;
        didSplit = true;
      } else {
        splitBody.push(statement);
      }
    }
    if (didSplit) node.body = splitBody;
  }

  const arrowBody = node.type === "ArrowFunctionExpression" ? node.body : null;
  if (
    arrowBody &&
    !Array.isArray(arrowBody) &&
    isAstNode(arrowBody) &&
    arrowBody.type === "SequenceExpression" &&
    Array.isArray(arrowBody.expressions)
  ) {
    const arrowExpressions = arrowBody.expressions as BrowserPocAstNode[];
    if (arrowExpressions.length > 1) {
      const lastArrowExpression = arrowExpressions[arrowExpressions.length - 1];
      const leadingStatements = arrowExpressions
        .slice(0, -1)
        .map(
          (expression) =>
            ({ type: "ExpressionStatement", expression }) as unknown as BrowserPocAstNode,
        );
      node.body = {
        type: "BlockStatement",
        body: [
          ...leadingStatements,
          {
            type: "ReturnStatement",
            argument: lastArrowExpression,
          } as unknown as BrowserPocAstNode,
        ],
      } as unknown as BrowserPocAstNode;
    }
  }

  if (
    node.type === "MemberExpression" &&
    node.computed === true &&
    node.property?.type === "Literal" &&
    typeof node.property.value === "string" &&
    /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(node.property.value)
  ) {
    node.computed = false;
    node.property = {
      type: "Identifier",
      name: node.property.value,
    } as BrowserPocAstNode;
  }

  reconstructJsx(node);

  if (displayName) {
    const uppercasedDisplayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);

    if (
      node.type === "VariableDeclarator" &&
      node.id?.type === "Identifier" &&
      node.id.name === "__reactDoctorComponent" &&
      node.init &&
      (node.init.type === "FunctionExpression" || node.init.type === "ArrowFunctionExpression")
    ) {
      node.id.name = uppercasedDisplayName;
    }

    if (
      node.type === "FunctionDeclaration" &&
      node.id?.type === "Identifier" &&
      node.id.name &&
      /^[a-z]/.test(node.id.name) &&
      node.params &&
      Array.isArray(node.params) &&
      node.params.length <= 2
    ) {
      node.id.name = uppercasedDisplayName;
    }
  }
};

const renameMinifiedSetters = (program: BrowserPocAstNode): void => {
  const setterRenames = new Map<string, string>();

  walkAst(program, (node) => {
    if (node.type !== "VariableDeclarator" || node.id?.type !== "ArrayPattern") return;
    const initNode = node.init;
    if (!initNode || initNode.type !== "CallExpression") return;

    const callee = initNode.callee;
    const isUseStateCall =
      (callee?.type === "Identifier" && callee.name === "useState") ||
      (callee?.type === "MemberExpression" &&
        callee.property?.type === "Identifier" &&
        callee.property.name === "useState");
    if (!isUseStateCall) return;

    const elements = node.id.elements;
    if (!Array.isArray(elements) || elements.length < 2) return;
    const valueElement = elements[0] as BrowserPocAstNode | null;
    const setterElement = elements[1] as BrowserPocAstNode | null;
    if (
      valueElement?.type !== "Identifier" ||
      setterElement?.type !== "Identifier" ||
      !valueElement.name ||
      !setterElement.name
    ) {
      return;
    }
    if (/^set[A-Z]/.test(setterElement.name)) return;

    const newSetterName = buildSetterName(valueElement.name);
    setterRenames.set(setterElement.name, newSetterName);
    setterElement.name = newSetterName;
  });

  if (setterRenames.size === 0) return;

  walkAst(program, (node) => {
    if (node.type !== "Identifier" || !node.name) return;
    const newName = setterRenames.get(node.name);
    if (newName) node.name = newName;
  });
};

const parseComponentSource = (
  functionSource: BrowserPocFunctionSource | null,
  displayName: string | null,
): {
  diagnostics: BrowserPocRuntimeDiagnostic[];
  parseResult: BrowserPocParseResult;
  ruleRunResult: BrowserPocRuleRunResult;
} => {
  if (!functionSource) {
    return {
      diagnostics: [],
      parseResult: SKIPPED_PARSE_RESULT,
      ruleRunResult: SKIPPED_RULE_RUN_RESULT,
    };
  }
  if (functionSource.isTruncated) {
    return {
      diagnostics: [],
      parseResult: { status: "skipped", error: null },
      ruleRunResult: SKIPPED_RULE_RUN_RESULT,
    };
  }
  const rawSource = functionSource.code;
  const wasmError = initializeOxcWasm();
  if (wasmError) {
    return { diagnostics: [], parseResult: wasmError, ruleRunResult: SKIPPED_RULE_RUN_RESULT };
  }
  try {
    const wrappedSource = `"use client";\nconst __reactDoctorComponent = ${rawSource};`;
    const result = parseSync(wrappedSource, {
      sourceFilename: "app/component.tsx",
    });
    if (result.errors.length > 0) {
      return {
        diagnostics: [],
        parseResult: {
          status: "parse-error",
          error: result.errors.map((error) => error.message).join("\n"),
        },
        ruleRunResult: SKIPPED_RULE_RUN_RESULT,
      };
    }
    const program = result.program as unknown;
    if (!isAstNode(program)) {
      return {
        diagnostics: [],
        parseResult: {
          status: "parse-error",
          error: "OXC returned a non-ESTree program.",
        },
        ruleRunResult: SKIPPED_RULE_RUN_RESULT,
      };
    }
    normalizeMinifiedAst(program, displayName);
    renameMinifiedSetters(program);
    const reactDoctorRuleResult = runReactDoctorRules(program, wrappedSource);
    const browserPocDiagnostics = createBrowserPocDiagnosticsFromAst(program).filter(
      (diagnostic) =>
        diagnostic.rule !== "browser-poc/no-fetch-in-effect" ||
        !reactDoctorRuleResult.diagnostics.some(
          (reactDoctorDiagnostic) =>
            reactDoctorDiagnostic.rule === `${reactDoctorPlugin.meta.name}/no-fetch-in-effect`,
        ),
    );
    return {
      diagnostics: [...reactDoctorRuleResult.diagnostics, ...browserPocDiagnostics],
      parseResult: {
        status: "parsed",
        error: null,
      },
      ruleRunResult: reactDoctorRuleResult.ruleRunResult,
    };
  } catch (error) {
    return {
      diagnostics: [],
      parseResult: {
        status: "parse-error",
        error: error instanceof Error ? error.message : String(error),
      },
      ruleRunResult: SKIPPED_RULE_RUN_RESULT,
    };
  }
};

const getRecord = (fiber: Fiber): BrowserPocComponentRecord | null => {
  const componentType = getType(fiber.type) ?? fiber.type;
  if (!componentType) return null;
  const existingRecord = componentRecordsByType.get(componentType);
  if (existingRecord) return existingRecord;

  const functionSource = getFunctionSource(componentType);
  const displayName = getDisplayName(componentType) ?? "Anonymous";
  const parsed = parseComponentSource(functionSource, displayName);
  const id = nextComponentID;
  nextComponentID += 1;
  const record: BrowserPocComponentRecord = {
    id,
    displayName,
    tag: fiber.tag,
    instanceCount: 0,
    commitCount: 0,
    selfTime: 0,
    totalTime: 0,
    hookNames: [],
    hostSelector: null,
    sourceLocation: null,
    source: functionSource?.code ?? null,
    parseResult: parsed.parseResult,
    ruleRunResult: parsed.ruleRunResult,
    diagnostics: parsed.diagnostics,
  };
  componentRecordsByType.set(componentType, record);
  componentTypesByID.set(id, componentType);
  return record;
};

const collectFiber = (fiber: Fiber): void => {
  if (!isCompositeFiber(fiber)) return;
  const record = getRecord(fiber);
  if (!record) return;
  record.instanceCount += 1;
  record.commitCount += 1;
  record.hookNames = getHookNames(fiber);
  record.hostSelector = getHostSelector(fiber);
  record.sourceLocation = getSourceLocation(fiber);
  const timings = getTimings(fiber);
  record.selfTime = timings.selfTime;
  record.totalTime = timings.totalTime;
};

const collectRoot = (rendererID: number | null, root: FiberRoot): void => {
  lastRendererID = rendererID;
  commitCount += 1;
  traverseFiber(root.current, collectFiber);
};

const getScoreLabel = (score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return "Great";
  if (score >= SCORE_OK_THRESHOLD) return "Needs work";
  return "Critical";
};

const calculateBrowserPocScore = (
  diagnostics: BrowserPocRuntimeDiagnostic[],
): BrowserPocScoreResult => {
  const errorRules = new Set<string>();
  const warningRules = new Set<string>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") {
      errorRules.add(diagnostic.rule);
    } else {
      warningRules.add(diagnostic.rule);
    }
  }
  const penalty = errorRules.size * ERROR_RULE_PENALTY + warningRules.size * WARNING_RULE_PENALTY;
  const score = Math.max(0, Math.round(PERFECT_SCORE - penalty));
  return { score, label: getScoreLabel(score) };
};

const buildSnapshot = (): BrowserPocSnapshot => {
  const components: BrowserPocComponentRecord[] = [];
  const allDiagnostics: BrowserPocRuntimeDiagnostic[] = [];
  for (const componentID of componentTypesByID.keys()) {
    const componentType = componentTypesByID.get(componentID);
    const record = componentRecordsByType.get(componentType);
    if (record) {
      components.push(record);
      allDiagnostics.push(...record.diagnostics);
    }
  }
  return {
    isActive,
    lastRendererID,
    rootCount: _fiberRoots.size,
    commitCount,
    components,
    scoreResult: calculateBrowserPocScore(allDiagnostics),
  };
};

const collectNow = (): BrowserPocSnapshot => {
  for (const root of _fiberRoots) {
    collectRoot(lastRendererID, root);
  }
  return buildSnapshot();
};

export const startBrowserPoc = (options: BrowserPocOptions = {}): BrowserPocController => {
  const controller: BrowserPocController = {
    snapshot: buildSnapshot,
    collectNow,
  };

  instrument(
    secure(
      {
        name: "react-doctor-browser-poc",
        onActive: () => {
          isActive = true;
        },
        onCommitFiberRoot: (rendererID, root) => {
          collectRoot(rendererID, root);
          if (options.log) console.log("[react-doctor/browser-poc]", buildSnapshot());
        },
      },
      {
        dangerouslyRunInProduction: options.dangerouslyRunInProduction ?? false,
      },
    ),
  );

  window.reactDoctorBrowserPoc = controller;
  return controller;
};

if (typeof window !== "undefined") {
  startBrowserPoc(window.__reactDoctorBrowserPocOptions);
}
