import type { EsTreeNode } from "../utils/es-tree-node.js";
import { lowerFunction } from "./lower.js";
import { inferTypes } from "./infer-types.js";
import type { HIRFunction, Place } from "./types.js";

// HACK: per-component HIR cache so multiple HIR rules visiting the
// same file lower it once.
const lowerCache = new WeakMap<EsTreeNode, HIRFunction>();

export const getOrLowerHir = (componentNode: EsTreeNode): HIRFunction => {
  const cached = lowerCache.get(componentNode);
  if (cached) return cached;
  const fn = lowerFunction(componentNode);
  inferTypes(fn);
  lowerCache.set(componentNode, fn);
  return fn;
};

export const resolveReportNode = (place: Place, fallbackNode: EsTreeNode): EsTreeNode =>
  place.originNode ?? fallbackNode;
