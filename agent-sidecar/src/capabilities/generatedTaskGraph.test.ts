import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGeneratedTaskGraph } from "./generatedTaskGraph";

test("parses code contexts and keeps only valid target task keys", () => {
  const graph = parseGeneratedTaskGraph(JSON.stringify({
    tasks: [
      { key: "task-1", title: "Add endpoint", description: "Implement it", dependsOn: [] },
      { key: "task-2", title: "Add tests", description: "Test it", dependsOn: ["task-1"] },
    ],
    contexts: [{
      key: "context-1",
      title: "Controller example",
      content: "```java\n@GetMapping(\"/me\")\n```",
      taskKeys: ["task-1", "missing-task", "task-1"],
    }],
  }));

  assert.deepEqual(graph.contexts, [{
    key: "context-1",
    title: "Controller example",
    content: "```java\n@GetMapping(\"/me\")\n```",
    taskKeys: ["task-1"],
  }]);
});

test("drops empty or unconnected generated contexts", () => {
  const graph = parseGeneratedTaskGraph(JSON.stringify({
    tasks: [{ key: "task-1", title: "Task", description: "Description", dependsOn: [] }],
    contexts: [
      { key: "empty", title: "Empty", content: "", taskKeys: ["task-1"] },
      { key: "orphan", title: "Orphan", content: "const value = 1;", taskKeys: ["unknown"] },
    ],
  }));

  assert.deepEqual(graph.contexts, []);
});
