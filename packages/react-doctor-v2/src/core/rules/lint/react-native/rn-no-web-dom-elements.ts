import { defineRule } from "../../registry.js";
import {
  REACT_NATIVE_WEB_DOM_ELEMENTS,
  hasDirective,
  isInsideWebPlatformBranch,
  resolveJsxElementName,
} from "./utils/index.js";
import type { EsTreeNode, Rule, RuleContext } from "./utils/index.js";

export const rnNoWebDomElements = defineRule<Rule>({
  recommendation:
    "Use React Native primitives such as View, Text, TextInput, Pressable, and expo-image instead of DOM tags unless the code is inside an Expo DOM component or WebView.",
  examples: [
    {
      before: `<div><img src={avatarUrl} /></div>`,
      after: `<View><Image source={avatarUrl} /></View>`,
    },
  ],
  create: (context: RuleContext) => {
    let isDomComponentFile = false;

    return {
      Program(programNode: EsTreeNode) {
        isDomComponentFile = hasDirective(programNode, "use dom");
      },
      JSXOpeningElement(node: EsTreeNode) {
        if (isDomComponentFile || isInsideWebPlatformBranch(node)) return;
        const elementName = resolveJsxElementName(node);
        if (!elementName || !REACT_NATIVE_WEB_DOM_ELEMENTS.has(elementName)) return;
        context.report({
          node,
          message: `<${elementName}> is a web DOM element - use React Native primitives or isolate web code in an Expo DOM component / WebView`,
        });
      },
    };
  },
});
