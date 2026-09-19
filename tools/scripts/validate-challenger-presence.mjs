#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function validateReviewDependencies(workflow) {
  const required = {
    "gate-1": ["requirements-review"],
    "gate-2": ["architecture-review", "governance-reconciliation-review"],
    "gate-3": ["plan-review"],
  };
  const errors = [];
  for (const [id, reviews] of Object.entries(required)) {
    const gate = workflow.nodes.find((node) => node.id === id);
    for (const review of reviews) {
      if (gate?.kind !== "gate" || !gate.sourceDependencies?.includes(review)) {
        errors.push(`${id} requires ${review}`);
      }
    }
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = validateReviewDependencies(JSON.parse(readFileSync("config/workflow.v1.json", "utf8")));
  for (const error of errors) console.error(error);
  if (errors.length === 0) console.log("All four vNext reviews remain required gate dependencies");
  process.exitCode = errors.length ? 1 : 0;
}
