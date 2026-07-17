import { readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  ImprovementDecisionV1Schema,
  ImprovementObservationV1Schema,
  ImprovementPolicyV1Schema,
  ImprovementProposalV1Schema,
  type ImprovementCategory,
  type ImprovementDecisionV1,
  type ImprovementObservationV1,
  type ImprovementPolicyV1,
  type ImprovementProposalV1,
  type ImprovementRecurrenceV1,
  type ImprovementSource,
  type ImprovementTarget,
  registerContractFormats,
} from "@apex/contracts";
import { Value } from "@sinclair/typebox/value";
import { sha256Json } from "./canonical.js";
import { atomicWriteJson } from "./files.js";

const INJECTION = [
  /ignore (?:all|any|the) previous instructions/i,
  /(?:system|developer) prompt/i,
  /(?:call|invoke|execute|run) (?:the )?(?:tool|command)/i,
  /(?:approve|deploy|publish|merge|create a pull request) (?:this|it|now)/i,
  /<\/?(?:system|assistant|tool|developer)>/i,
];
const SECRET_VALUE =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]{16,}|(?:AccountKey|SharedAccessSignature)=|\b(?:secret|password|token|api[-_]?key)\s*[:=]\s*\S+/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

export interface ImprovementObservationInput {
  projectId: string;
  runId: string;
  taskId?: string;
  observedAt?: string;
  source: ImprovementSource;
  category: ImprovementCategory;
  severity: ImprovementObservationV1["severity"];
  statement: string;
  evidenceRefs: string[];
}

export interface ImprovementDecisionInput {
  projectId: string;
  proposalId: string;
  actor: string;
  decision: ImprovementDecisionV1["decision"];
  rationale: string;
  externalRef?: string;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readDirectory<T>(directory: string): Promise<T[]> {
  try {
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    return await Promise.all(names.map(async (name) => JSON.parse(await readFile(join(directory, name), "utf8")) as T));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function sanitizedStatement(statement: string, maximum: number): { statement: string; redactionCount: number } {
  if (statement.length === 0 || statement.length > maximum) {
    throw new Error(`Observation statement must contain 1-${maximum} characters`);
  }
  let redactionCount = 0;
  const redact = () => {
    redactionCount += 1;
    return "[REDACTED]";
  };
  const value = statement.replace(SECRET_VALUE, redact).replace(EMAIL, redact).trim();
  if (value.length === 0) throw new Error("Observation statement is empty after redaction");
  return { statement: value, redactionCount };
}

function targetFor(category: ImprovementCategory, allowed: ImprovementTarget[]): ImprovementTarget {
  const preferred: Record<ImprovementCategory, ImprovementTarget> = {
    correctness: "validator",
    security: "validator",
    reliability: "architecture",
    performance: "architecture",
    usability: "documentation",
    documentation: "documentation",
    "capability-gap": "backlog",
  };
  return allowed.includes(preferred[category]) ? preferred[category] : allowed[0]!;
}

export class ImprovementStore {
  private readonly root: string;
  private readonly observationsRoot: string;
  private readonly proposalsRoot: string;
  private readonly decisionsRoot: string;

  constructor(
    projectRoot: string,
    readonly policy: ImprovementPolicyV1,
    private readonly clock: () => Date = () => new Date(),
  ) {
    registerContractFormats();
    if (!Value.Check(ImprovementPolicyV1Schema, policy)) throw new Error("Improvement policy is invalid");
    this.root = resolve(projectRoot, ".apex", "quality", "improvement");
    this.observationsRoot = join(this.root, "observations");
    this.proposalsRoot = join(this.root, "proposals");
    this.decisionsRoot = join(this.root, "decisions");
  }

  async observe(
    input: ImprovementObservationInput,
  ): Promise<{ observation: ImprovementObservationV1; deduplicated: boolean }> {
    if (!this.policy.allowedSources.includes(input.source))
      throw new Error(`Observation source is not allowed: ${input.source}`);
    if (!this.policy.allowedCategories.includes(input.category)) {
      throw new Error(`Observation category is not allowed: ${input.category}`);
    }
    if (input.evidenceRefs.length < 1 || input.evidenceRefs.length > this.policy.limits.evidenceRefs) {
      throw new Error("Observation evidence reference count is outside policy");
    }
    if (
      new Set(input.evidenceRefs).size !== input.evidenceRefs.length ||
      input.evidenceRefs.some((hash) => !/^[0-9a-f]{64}$/.test(hash))
    ) {
      throw new Error("Observation evidence references must be unique SHA-256 hashes");
    }
    const redacted = sanitizedStatement(input.statement, this.policy.limits.statementCharacters);
    const observedAt = input.observedAt ?? this.clock().toISOString();
    const observedTime = Date.parse(observedAt);
    if (!Number.isFinite(observedTime) || new Date(observedTime).toISOString() !== observedAt) {
      throw new Error("Observation timestamp must be canonical ISO-8601");
    }
    if (observedTime > this.clock().getTime()) throw new Error("Observation timestamp cannot be in the future");
    const disposition = INJECTION.some((pattern) => pattern.test(redacted.statement)) ? "quarantined" : "active";
    const patternKey = sha256Json({ category: input.category, statement: redacted.statement.toLowerCase() });
    const observationId = sha256Json({
      projectId: input.projectId,
      runId: input.runId,
      taskId: input.taskId ?? null,
      source: input.source,
      category: input.category,
      severity: input.severity,
      statement: redacted.statement,
      evidenceRefs: [...input.evidenceRefs].sort(),
    });
    const path = join(this.observationsRoot, `${observationId}.json`);
    const existing = await readJson<ImprovementObservationV1>(path);
    if (existing !== undefined) return { observation: existing, deduplicated: true };
    const observations = await this.listObservations();
    if (observations.length >= this.policy.limits.observations)
      throw new Error("Improvement observation limit reached");
    const observation: ImprovementObservationV1 = {
      schemaVersion: "1.0.0",
      projectId: input.projectId,
      runId: input.runId,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      observationId,
      patternKey,
      observedAt,
      source: input.source,
      category: input.category,
      severity: input.severity,
      statement: redacted.statement,
      evidenceRefs: [...input.evidenceRefs].sort(),
      disposition,
      redactionCount: redacted.redactionCount,
    };
    if (!Value.Check(ImprovementObservationV1Schema, observation))
      throw new Error("Improvement observation is invalid");
    await atomicWriteJson(path, observation, { refuseOverwrite: true });
    return { observation, deduplicated: false };
  }

  async listObservations(): Promise<ImprovementObservationV1[]> {
    return await readDirectory<ImprovementObservationV1>(this.observationsRoot);
  }

  async scan(
    projectId: string,
  ): Promise<{ recurrences: ImprovementRecurrenceV1[]; proposals: ImprovementProposalV1[] }> {
    const now = this.clock();
    const cutoff = now.getTime() - this.policy.recurrence.windowDays * 86_400_000;
    const observations = (await this.listObservations()).filter(
      (item) => item.projectId === projectId && item.disposition === "active" && Date.parse(item.observedAt) >= cutoff,
    );
    const groups = Map.groupBy(observations, (item) => item.patternKey);
    const recurrences: ImprovementRecurrenceV1[] = [];
    const proposals: ImprovementProposalV1[] = [];
    for (const [patternKey, items] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const runIds = [...new Set(items.map(({ runId }) => runId))].sort();
      if (runIds.length < this.policy.recurrence.threshold) continue;
      const ordered = [...items].sort((left, right) => left.observedAt.localeCompare(right.observedAt));
      const evidenceRefs = [...new Set(items.flatMap(({ evidenceRefs: refs }) => refs))].sort();
      const recurrence: ImprovementRecurrenceV1 = {
        schemaVersion: "1.0.0",
        projectId,
        patternKey,
        category: ordered[0]!.category,
        detectedAt: now.toISOString(),
        firstSeenAt: ordered[0]!.observedAt,
        lastSeenAt: ordered.at(-1)!.observedAt,
        occurrenceCount: items.length,
        distinctRunCount: runIds.length,
        runIds,
        observationIds: ordered.map(({ observationId }) => observationId).sort(),
        evidenceRefs,
        confidence: runIds.length >= this.policy.recurrence.threshold + 2 ? "high" : "medium",
      };
      recurrences.push(recurrence);
      const target = targetFor(recurrence.category, this.policy.proposalTargets);
      const proposalId = sha256Json({ projectId, patternKey, target });
      const path = join(this.proposalsRoot, `${proposalId}.json`);
      let proposal = await readJson<ImprovementProposalV1>(path);
      if (proposal === undefined) {
        proposal = {
          schemaVersion: "1.0.0",
          projectId,
          proposalId,
          patternKey,
          generatedAt: now.toISOString(),
          target,
          title: `Review recurring ${recurrence.category} observation`,
          summary: `Review ${recurrence.occurrenceCount} redacted observations across ${recurrence.distinctRunCount} distinct runs through the normal human change workflow.`,
          occurrenceCount: recurrence.occurrenceCount,
          runIds,
          evidenceRefs,
          confidence: recurrence.confidence,
          status: "pending",
          inert: true,
        };
        if (!Value.Check(ImprovementProposalV1Schema, proposal)) throw new Error("Improvement proposal is invalid");
        await atomicWriteJson(path, proposal, { refuseOverwrite: true });
      }
      proposals.push(proposal);
    }
    return { recurrences, proposals };
  }

  async listProposals(projectId?: string): Promise<ImprovementProposalV1[]> {
    const proposals = await readDirectory<ImprovementProposalV1>(this.proposalsRoot);
    return projectId === undefined ? proposals : proposals.filter((proposal) => proposal.projectId === projectId);
  }

  async decide(input: ImprovementDecisionInput): Promise<ImprovementDecisionV1> {
    const proposalPath = join(this.proposalsRoot, `${input.proposalId}.json`);
    const proposal = await readJson<ImprovementProposalV1>(proposalPath);
    if (proposal === undefined || proposal.projectId !== input.projectId)
      throw new Error("Improvement proposal not found");
    const decisionPath = join(this.decisionsRoot, `${input.proposalId}.json`);
    if ((await readJson<ImprovementDecisionV1>(decisionPath)) !== undefined) {
      throw new Error("Improvement proposal already has a human decision");
    }
    const decision: ImprovementDecisionV1 = {
      schemaVersion: "1.0.0",
      projectId: input.projectId,
      proposalId: input.proposalId,
      decidedAt: this.clock().toISOString(),
      actor: input.actor,
      decision: input.decision,
      rationale: input.rationale,
      ...(input.externalRef === undefined ? {} : { externalRef: input.externalRef }),
    };
    if (!Value.Check(ImprovementDecisionV1Schema, decision)) throw new Error("Improvement decision is invalid");
    await atomicWriteJson(decisionPath, decision, { refuseOverwrite: true });
    await atomicWriteJson(proposalPath, { ...proposal, status: input.decision });
    return decision;
  }

  async listDecisions(): Promise<ImprovementDecisionV1[]> {
    return await readDirectory<ImprovementDecisionV1>(this.decisionsRoot);
  }

  async deleteObservation(observationId: string): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(observationId)) throw new Error("Observation ID must be a SHA-256 hash");
    await rm(join(this.observationsRoot, `${observationId}.json`), { force: true });
  }

  async prune(): Promise<{ observations: number; decisions: number }> {
    const now = this.clock().getTime();
    let observationCount = 0;
    for (const observation of await this.listObservations()) {
      if (Date.parse(observation.observedAt) < now - this.policy.retention.observationDays * 86_400_000) {
        await this.deleteObservation(observation.observationId);
        observationCount += 1;
      }
    }
    let decisionCount = 0;
    for (const decision of await this.listDecisions()) {
      if (Date.parse(decision.decidedAt) < now - this.policy.retention.decisionDays * 86_400_000) {
        await rm(join(this.decisionsRoot, `${decision.proposalId}.json`), { force: true });
        decisionCount += 1;
      }
    }
    return { observations: observationCount, decisions: decisionCount };
  }
}
