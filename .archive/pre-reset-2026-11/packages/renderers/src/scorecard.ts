import type { QualityScorecardV1 } from "@apexops/contracts";
import { markdownTable, optional } from "./markdown.js";

export interface ScorecardMeasurement {
  readonly metric: string;
  readonly scenario: string;
  readonly value?: number;
  readonly samples: number;
}

export type ScorecardDecision = "pass" | "fail" | "omitted";

export interface ScorecardEvaluation {
  readonly metric: string;
  readonly scenario: string;
  readonly decision: ScorecardDecision;
  readonly value?: number;
  readonly samples: number;
  readonly reason: string;
}

export class ScorecardValidationError extends Error {
  constructor(
    public readonly path: "/scorecard/rules" | "/qualityMeasurements/measurements",
    message: string,
  ) {
    super(message);
    this.name = "ScorecardValidationError";
  }
}

function unavailableDecision(unavailable: "block" | "omit-claim"): ScorecardDecision {
  return unavailable === "block" ? "fail" : "omitted";
}

function scorecardKey(metric: string, scenario: string): string {
  return JSON.stringify([metric, scenario]);
}

export function evaluateQualityScorecard(
  scorecard: QualityScorecardV1,
  measurements: readonly ScorecardMeasurement[],
): readonly ScorecardEvaluation[] {
  const seenRules = new Set<string>();
  for (const rule of scorecard.rules) {
    const key = scorecardKey(rule.metric, rule.scenario);
    if (seenRules.has(key)) {
      throw new ScorecardValidationError(
        "/scorecard/rules",
        `Duplicate scorecard rule for ${rule.metric} (${rule.scenario})`,
      );
    }
    seenRules.add(key);
    if (rule.direction === "exact" && rule.tolerance !== 0) {
      throw new ScorecardValidationError(
        "/scorecard/rules",
        `Exact scorecard rule ${rule.metric} (${rule.scenario}) must have tolerance 0`,
      );
    }
  }

  const indexed = new Map<string, ScorecardMeasurement>();
  for (const item of measurements) {
    if (!Number.isSafeInteger(item.samples) || item.samples < 0) {
      throw new ScorecardValidationError(
        "/qualityMeasurements/measurements",
        `Invalid scorecard sample count for ${item.metric} (${item.scenario})`,
      );
    }
    if (item.value !== undefined && !Number.isFinite(item.value)) {
      throw new ScorecardValidationError(
        "/qualityMeasurements/measurements",
        `Invalid scorecard measurement value for ${item.metric} (${item.scenario})`,
      );
    }
    const key = scorecardKey(item.metric, item.scenario);
    if (indexed.has(key)) {
      throw new ScorecardValidationError(
        "/qualityMeasurements/measurements",
        `Duplicate scorecard measurement for ${item.metric} (${item.scenario})`,
      );
    }
    indexed.set(key, item);
  }

  return [...scorecard.rules]
    .sort((left, right) => left.metric.localeCompare(right.metric) || left.scenario.localeCompare(right.scenario))
    .map((rule): ScorecardEvaluation => {
      const measurement = indexed.get(scorecardKey(rule.metric, rule.scenario));
      if (measurement === undefined || measurement.value === undefined) {
        return {
          metric: rule.metric,
          scenario: rule.scenario,
          decision: unavailableDecision(rule.unavailable),
          samples: measurement?.samples ?? 0,
          reason: "measurement unavailable",
        };
      }
      if (measurement.samples < rule.minimumSamples) {
        return {
          metric: rule.metric,
          scenario: rule.scenario,
          decision: unavailableDecision(rule.unavailable),
          value: measurement.value,
          samples: measurement.samples,
          reason: `requires at least ${rule.minimumSamples} samples`,
        };
      }
      const passed =
        rule.direction === "min"
          ? measurement.value >= rule.target - rule.tolerance
          : rule.direction === "max"
            ? measurement.value <= rule.target + rule.tolerance
            : measurement.value === rule.target;
      return {
        metric: rule.metric,
        scenario: rule.scenario,
        decision: passed ? "pass" : "fail",
        value: measurement.value,
        samples: measurement.samples,
        reason: passed ? "target satisfied" : "target not satisfied",
      };
    });
}

export function renderQualityScorecardEvaluation(
  scorecard: QualityScorecardV1,
  measurements: readonly ScorecardMeasurement[],
): string {
  const evaluations = evaluateQualityScorecard(scorecard, measurements);
  const rules = new Map(scorecard.rules.map((rule) => [scorecardKey(rule.metric, rule.scenario), rule]));
  const rows = evaluations.map((evaluation) => {
    const rule = rules.get(scorecardKey(evaluation.metric, evaluation.scenario))!;
    return [
      evaluation.metric,
      evaluation.scenario,
      rule.direction,
      rule.target,
      rule.tolerance,
      optional(evaluation.value),
      `${evaluation.samples}/${rule.minimumSamples}`,
      evaluation.decision.toUpperCase(),
      evaluation.reason,
    ];
  });
  return [
    "# Quality Scorecard Evaluation",
    "",
    `- **Frozen at:** ${scorecard.frozenAt}`,
    "",
    markdownTable(
      ["Metric", "Scenario", "Direction", "Target", "Tolerance", "Value", "Samples", "Decision", "Reason"],
      rows,
    ),
  ].join("\n");
}
