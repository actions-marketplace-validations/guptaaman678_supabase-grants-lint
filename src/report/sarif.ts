/**
 * SARIF 2.1.0 output (spec §6.3). One `reportingDescriptor` per rule, with `helpUri` pinned to the
 * release tag.
 */
import { docsUrl, type Rule, RULES, type Severity } from '../rules/index.js';

export type SarifLevel = 'error' | 'warning' | 'note';

export interface SarifReportingDescriptor {
  readonly id: string;
  readonly name: string;
  readonly shortDescription: { readonly text: string };
  readonly helpUri: string;
  readonly defaultConfiguration: { readonly level: SarifLevel };
}

const LEVELS: Readonly<Record<Severity, SarifLevel>> = {
  error: 'error',
  warn: 'warning',
  info: 'note',
};

export function sarifLevel(severity: Severity): SarifLevel {
  return LEVELS[severity];
}

/** The `tool.driver.rules` array: one descriptor per implemented rule, in rule ID order. */
export function sarifRules(rules: readonly Rule[] = RULES): SarifReportingDescriptor[] {
  return rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    shortDescription: { text: rule.docs },
    helpUri: docsUrl(rule.id),
    defaultConfiguration: { level: sarifLevel(rule.defaultSeverity) },
  }));
}
