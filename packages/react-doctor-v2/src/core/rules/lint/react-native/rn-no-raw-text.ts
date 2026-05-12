import { defineRule } from "../../registry.js";
import {
  getRawTextDescription,
  hasDirective,
  isInsideWebPlatformBranch,
  isRawTextContent,
  isTextHandlingComponent,
  resolveJsxElementName,
} from "./utils/index.js";
import type { EsTreeNode, Rule, RuleContext } from "./utils/index.js";

const WEB_FILE_EXTENSION_PATTERN = /\.web\.[jt]sx?$/;

export const rnNoRawText = defineRule<Rule>({
  recommendation:
    "Wrap raw strings in React Native Text components so text layout and accessibility are valid.",
  examples: [
    {
      before: `<FlatList renderItem={({ item }) => <Row style={{ padding: 8 }} item={item} />} />`,
      after: `const renderItem = ({ item }) => <Row item={item} />;
<FlatList renderItem={renderItem} />`,
    },
  ],
  create: (context: RuleContext) => {
    let isWebOnlyFile = false;
    let isDomComponentFile = false;

    return {
      Program(programNode: EsTreeNode) {
        isDomComponentFile = hasDirective(programNode, "use dom");
        isWebOnlyFile = WEB_FILE_EXTENSION_PATTERN.test(context.getFilename?.() ?? "");
      },
      JSXElement(node: EsTreeNode) {
        if (isDomComponentFile || isWebOnlyFile || isInsideWebPlatformBranch(node)) return;

        const elementName = resolveJsxElementName(node.openingElement);
        if (elementName && isTextHandlingComponent(elementName)) return;

        for (const child of node.children ?? []) {
          if (!isRawTextContent(child)) continue;

          context.report({
            node: child,
            message: `Raw ${getRawTextDescription(child)} outside a <Text> component - this will crash on React Native`,
          });
        }
      },
    };
  },
});
