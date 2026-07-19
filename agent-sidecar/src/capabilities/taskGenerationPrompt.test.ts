import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTaskGenerationQuery,
  TASK_GENERATION_CODE_CONTEXT_AUGMENTATION,
  TASK_GENERATION_DEPENDENCY_AUGMENTATION,
  TASK_GENERATION_SYSTEM_PROMPT,
} from "./taskGenerationPrompt";

test("task-generation queries always include dependency augmentation", () => {
  const query = buildTaskGenerationQuery([
    { role: "user", content: "Plan the endpoint and tests." },
    { role: "assistant", content: "T1: endpoint\nT2: tests" },
  ]);

  assert.match(query, /USER: Plan the endpoint and tests\./);
  assert.match(query, /ASSISTANT: T1: endpoint/);
  assert.ok(query.includes(TASK_GENERATION_DEPENDENCY_AUGMENTATION));
  assert.ok(query.endsWith(TASK_GENERATION_CODE_CONTEXT_AUGMENTATION));
  assert.match(query, /every later task dependsOn the immediately preceding task/i);
  assert.match(query, /Preserve the snippet verbatim/i);
});

test("task-generation schema includes code contexts and their target tasks", () => {
  assert.match(TASK_GENERATION_SYSTEM_PROMPT, /"contexts"/);
  assert.match(TASK_GENERATION_SYSTEM_PROMPT, /"content"/);
  assert.match(TASK_GENERATION_SYSTEM_PROMPT, /"taskKeys"/);
});

test("explicit generation instructions appear before mandatory dependency augmentation", () => {
  const query = buildTaskGenerationQuery(
    [{ role: "user", content: "Create the tasks." }],
    "T2 and T3 may run in parallel.",
  );

  const explicitInstructionIndex = query.indexOf("T2 and T3 may run in parallel.");
  const augmentationIndex = query.indexOf("TASK DEPENDENCY AND CONNECTION REQUIREMENTS:");
  assert.ok(explicitInstructionIndex >= 0);
  assert.ok(augmentationIndex > explicitInstructionIndex);
  assert.match(query, /Preserve any dependency, ordering, independence, or parallelism/i);
});
