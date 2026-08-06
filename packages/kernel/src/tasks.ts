import type { InputAnswerV1, ProjectId, QuestionV1Schema, RunId, TaskEnvelopeV1, TaskResultV1 } from "@apex/contracts";
import { CONTRACT_VERSION } from "@apex/contracts";
import type { Static } from "@sinclair/typebox";
import type { Clock } from "./lease-store.js";
import type { IdSource } from "./project-store.js";

type QuestionV1 = Static<typeof QuestionV1Schema>;

export interface CreateTaskInput extends Omit<TaskEnvelopeV1, "schemaVersion" | "taskId" | "createdAt" | "expiresAt"> {
  ttlMs: number;
}

export function createTaskEnvelope(input: CreateTaskInput, clock: Clock, idSource: IdSource): TaskEnvelopeV1 {
  const now = clock();
  if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0) {
    throw new Error("Task TTL must be positive");
  }
  const { ttlMs, ...task } = input;
  return {
    schemaVersion: CONTRACT_VERSION,
    ...task,
    taskId: idSource(),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
}

export function assertTaskCurrent(task: TaskEnvelopeV1, head: string, ownerEpoch: number, clock: Clock): void {
  if (Date.parse(task.expiresAt) <= clock().getTime()) {
    throw new Error("Task has expired");
  }
  if (task.expectedHead !== head) {
    throw new Error("Task journal head is stale");
  }
  if (task.ownerEpoch !== ownerEpoch) {
    throw new Error("Task owner epoch is stale");
  }
}

export function needsInput(taskId: string, questions: QuestionV1[]): TaskResultV1 {
  if (questions.length === 0) {
    throw new Error("needs_input requires at least one question");
  }
  return { schemaVersion: CONTRACT_VERSION, taskId, status: "needs_input", questions };
}

export function validateInputAnswers(questions: QuestionV1[], submitted: InputAnswerV1[]): InputAnswerV1[] {
  const answers = new Map<string, InputAnswerV1["value"]>();
  for (const answer of submitted) {
    if (answers.has(answer.questionId)) throw new Error(`Duplicate answer: ${answer.questionId}`);
    answers.set(answer.questionId, answer.value);
  }
  for (const answerId of answers.keys()) {
    if (!questions.some(({ id }) => id === answerId)) throw new Error(`Unknown answer: ${answerId}`);
  }
  if (answers.size !== questions.length || questions.some(({ id }) => !answers.has(id))) {
    throw new Error("Every requested question requires exactly one answer");
  }
  return questions.map((question) => {
    const value = answers.get(question.id)!;
    if (question.valueType !== undefined) {
      if (isDeferredOrUnknown(value)) return { questionId: question.id, value };
      if (question.valueType === "environment-set") {
        if (!Array.isArray(value) || value.some((item) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(item))) {
          throw new Error(`Answer shape does not match question: ${question.id}`);
        }
        return { questionId: question.id, value };
      }
      if (typeof value !== "object" || value === null || Array.isArray(value) || value.kind !== question.valueType) {
        throw new Error(`Answer shape does not match question: ${question.id}`);
      }
      return { questionId: question.id, value };
    }
    if (
      (question.multiSelect === true ? !Array.isArray(value) : typeof value !== "string") ||
      (typeof value !== "string" && !Array.isArray(value))
    ) {
      throw new Error(`Answer shape does not match question: ${question.id}`);
    }
    const selected: string[] = Array.isArray(value) ? value : [value];
    if (selected.some((item) => item.trim().length === 0 || /^(?:none|n\/a)$/iu.test(item.trim()))) {
      throw new Error(`Answer must be explicitly provided or deferred: ${question.id}`);
    }
    if (question.options !== undefined) {
      if (selected.some((item) => !question.options!.includes(item))) {
        throw new Error(`Answer is not a declared option: ${question.id}`);
      }
    }
    return {
      questionId: question.id,
      value:
        Array.isArray(value) && question.options !== undefined
          ? question.options.filter((option) => value.includes(option))
          : value,
    };
  });
}

function isDeferredOrUnknown(value: InputAnswerV1["value"]): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value.kind === "deferred" || value.kind === "unknown")
  );
}

export type { ProjectId, RunId };
