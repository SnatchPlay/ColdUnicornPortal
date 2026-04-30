import type {
  ConditionBranch,
  ConditionComparisonNode,
  ConditionNode,
  ConditionOperator,
  ConditionRule,
  ConditionValueRef,
} from "./types";

const OPERATORS_REQUIRING_RIGHT: ConditionOperator[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "starts_with",
  "not_starts_with",
  "in",
  "not_in",
];

const OPERATORS_WITHOUT_RIGHT: ConditionOperator[] = ["is_blank", "not_blank"];

function hasValueRefInput(ref: ConditionValueRef | undefined) {
  if (!ref) return false;
  if (typeof ref.metric === "string" && ref.metric.trim().length > 0) return true;
  return Object.prototype.hasOwnProperty.call(ref, "value");
}

function validateValueRef(ref: ConditionValueRef | undefined, path: string, errors: string[]) {
  if (!ref) {
    errors.push(`${path} is missing.`);
    return;
  }

  if (!hasValueRefInput(ref)) {
    errors.push(`${path} must provide either metric or value.`);
  }

  if (ref.metric !== undefined && (typeof ref.metric !== "string" || ref.metric.trim().length === 0)) {
    errors.push(`${path}.metric must be a non-empty string.`);
  }

  if (ref.multiplier !== undefined && typeof ref.multiplier !== "number") {
    errors.push(`${path}.multiplier must be a number.`);
  }

  if (ref.transform !== undefined && !["lower", "upper", "trim", "abs", "round"].includes(ref.transform)) {
    errors.push(`${path}.transform is invalid.`);
  }
}

export function validateConditionNode(node: ConditionNode | null | undefined, path = "node"): string[] {
  const errors: string[] = [];
  if (!node) {
    errors.push(`${path} is required.`);
    return errors;
  }

  if ("all" in node) {
    if (!Array.isArray(node.all) || node.all.length === 0) {
      errors.push(`${path}.all must contain at least one condition.`);
      return errors;
    }
    node.all.forEach((child, index) => {
      errors.push(...validateConditionNode(child, `${path}.all[${index}]`));
    });
    return errors;
  }

  if ("any" in node) {
    if (!Array.isArray(node.any) || node.any.length === 0) {
      errors.push(`${path}.any must contain at least one condition.`);
      return errors;
    }
    node.any.forEach((child, index) => {
      errors.push(...validateConditionNode(child, `${path}.any[${index}]`));
    });
    return errors;
  }

  const comparison = node as ConditionComparisonNode;
  validateValueRef(comparison.left, `${path}.left`, errors);

  if (!comparison.op) {
    errors.push(`${path}.op is required.`);
    return errors;
  }

  if (OPERATORS_REQUIRING_RIGHT.includes(comparison.op)) {
    validateValueRef(comparison.right, `${path}.right`, errors);
  }

  if (OPERATORS_WITHOUT_RIGHT.includes(comparison.op) && comparison.right !== undefined) {
    errors.push(`${path}.right is not allowed for operator ${comparison.op}.`);
  }

  if (comparison.op === "between") {
    const rightValue = comparison.right?.value;
    if (!Array.isArray(rightValue) || rightValue.length !== 2) {
      errors.push(`${path}.right.value must be a two-item array for between.`);
    }
  }

  return errors;
}

export function validateConditionBranches(branches: ConditionBranch[] | null | undefined): string[] {
  const errors: string[] = [];
  if (!Array.isArray(branches) || branches.length === 0) {
    errors.push("At least one branch is required.");
    return errors;
  }

  branches.forEach((branch, index) => {
    if (!branch.label?.trim()) {
      errors.push(`branches[${index}].label is required.`);
    }
    if (!branch.message?.trim()) {
      errors.push(`branches[${index}].message is required.`);
    }
    if (!branch.severity) {
      errors.push(`branches[${index}].severity is required.`);
    }
    errors.push(...validateConditionNode(branch.when, `branches[${index}].when`));
  });

  return errors;
}

export function validateConditionRule(rule: Partial<ConditionRule>) {
  const errors: string[] = [];

  if (!rule.key?.trim()) errors.push("key is required.");
  if (!rule.name?.trim()) errors.push("name is required.");
  if (!rule.surface?.trim()) errors.push("surface is required.");
  if (!rule.metricKey?.trim()) errors.push("metricKey is required.");
  if (!rule.targetEntity) errors.push("targetEntity is required.");
  if (!rule.scopeType) errors.push("scopeType is required.");
  if (!rule.applyTo) errors.push("applyTo is required.");
  if (typeof rule.priority !== "number" || !Number.isFinite(rule.priority)) {
    errors.push("priority must be a valid number.");
  }

  errors.push(...validateConditionBranches(rule.branches));
  if (rule.baseFilter) {
    errors.push(...validateConditionNode(rule.baseFilter, "baseFilter"));
  }

  return errors;
}

export function createDefaultComparisonNode(): ConditionComparisonNode {
  return {
    left: { metric: "value" },
    op: "eq",
    right: { value: 0 },
  };
}

export function createDefaultBranch(): ConditionBranch {
  return {
    severity: "warning",
    label: "New branch",
    message: "Describe why this condition should apply.",
    when: createDefaultComparisonNode(),
  };
}
