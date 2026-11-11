import { type ScanPolicy, severities } from "@rollbackiq/scanner-core";

export const policyOptions = {
  "fail-on": { type: "string", default: "none" },
  "fail-incomplete": { type: "boolean", default: false },
  help: { type: "boolean", short: "h" },
} as const;

export function parsePolicy(failOn: string, failOnIncomplete: boolean): ScanPolicy {
  if (failOn === "none") return { failOn, failOnIncomplete };
  const severity = severities.find((value) => value === failOn);
  if (!severity) throw new Error(`--fail-on accepts ${severities.join(", ")}, or none.`);
  return { failOn: severity, failOnIncomplete };
}

export function serialize(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
