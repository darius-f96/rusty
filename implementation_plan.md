# Skills Standardization Refactoring Plan

## Overview

The skills system in Axiom is currently scattered across multiple files with inconsistent patterns, hardcoded skill IDs, no guarantee that a chat has a skill, and skill `systemPrompt`/`description` content embedded deep in `store.ts` making it difficult to review or edit.

This plan establishes a **single source of truth** for skills, a **unified `useSkill` hook** that enforces consistent resolution logic everywhere, and a dedicated **skill definitions file** that is easy to read and change.

---

## Current Problems

| Problem | Location(s) |
|---|---|
| Hardcoded `"skill_task_auditor"` string literal in 6+ places | `store.ts`, `AgentTab.tsx`, `GlobalChatNode.tsx`, `useExplorerWebSocket.ts` (×2) |
| Skill fallback logic duplicated differently in each consumer | `AgentTab.tsx`, `useExplorerWebSocket.ts` |
| Skill system prompts (large strings) living inside `store.ts` | `store.ts` lines 527–575 |
| GlobalChatNode UI hardcodes "default auditor" option bypassing the real skill | `GlobalChatNode.tsx` lines 191–196 |
| GlobalChatNode filters out `skill_task_auditor` from the skill list | `GlobalChatNode.tsx` line 198 |
| No enforcement of "always has a skill" — chat can be sent with no skill | `AgentTab.tsx` line 246 (runtime `notify`), but no proactive enforcement |
| Task generation in `useExplorerWebSocket.ts` always hardcodes auditor skill | `useExplorerWebSocket.ts` line 466 |
| `Workspace.tsx` task node execution silently uses `null` skill if `skillId` absent | `Workspace.tsx` line 150 |

---

## User Review Required

> [!IMPORTANT]
> **Built-in skill descriptions**: The system prompts for the four built-in skills (`build`, `plan`, `grind-me`, `task-auditor`) are currently long strings inside `store.ts`. The plan moves them to a dedicated file `src/config/skillDefinitions.ts`. This is purely an organizational change — the actual prompt text stays the same. Please confirm this is acceptable, or specify if you want to edit any of the prompts at the same time.

> [!IMPORTANT]
> **Default skill for GlobalChatNode**: Currently the node shows "default auditor" as a special option that maps to `skill_task_auditor`. The plan removes this special case and makes `skill_task_auditor` appear in the list as a normal, selectable skill. Does this match your intent?

> [!IMPORTANT]
> **"No skill" enforcement**: The plan enforces that a chat cannot be started without a skill — if no skill is selected, the picker is blocked rather than just showing a runtime error. The `ChatInput` will also be disabled (already partially in place). Confirm this is the desired UX.

---

## Open Questions

> [!WARNING]
> Should `GlobalChatNode` always default to `skill_task_auditor`, or should it default to whatever the user's `activeSkillId` is in the store? Currently the store hardcodes `"skill_task_auditor"` when creating a new `globalChatNode`.

---

## Proposed Changes

### 1. Skill Definitions File (New)

---

#### [NEW] [skillDefinitions.ts](file:///Users/suciuvictortraian/Development/axiom/src/config/skillDefinitions.ts)

A new file `src/config/skillDefinitions.ts` that exports:

- A `BUILT_IN_SKILL_IDS` const object (e.g. `{ TASK_AUDITOR: "skill_task_auditor", BUILD: "skill_build", ... }`) to replace all hardcoded string literals.
- A `BUILT_IN_SKILLS: Skill[]` array with the four built-in skill definitions (currently in `store.ts` lines 527–575).
- A `DEFAULT_SKILL_ID` const that points to `BUILT_IN_SKILL_IDS.TASK_AUDITOR` so there is exactly one place to change the default.

**Benefit**: All skill descriptions and system prompts live in one easy-to-find, easy-to-edit file. Removing magic strings from all other files.

---

### 2. Shared `useSkill` Hook (New)

---

#### [NEW] [useSkill.ts](file:///Users/suciuvictortraian/Development/axiom/src/hooks/useSkill.ts)

A new React hook `useSkill` that encapsulates:

```ts
// Returns resolved skill data and helpers
export function useSkill(overrideSkillId?: string | null) {
  const skills = useWorkspaceStore(s => s.skills);
  const activeSkillId = useWorkspaceStore(s => s.activeSkillId);
  const setActiveSkill = useWorkspaceStore(s => s.setActiveSkill);

  const resolvedSkill = resolveSkill(skills, overrideSkillId ?? activeSkillId);

  // Returns { resolvedSkill, skillData, hasSkill, setSkill, skills }
}
```

**Resolution logic** (single, shared algorithm):
1. If a specific `overrideSkillId` is passed and exists → use it.
2. Else if `activeSkillId` exists in the skills list → use it.
3. Else fall back to `DEFAULT_SKILL_ID` (task-auditor).
4. Else use `skills[0]` (last resort).

**Returns:**
- `resolvedSkill: Skill | null` — the full skill object
- `skillData: { systemPrompt, enabledTools, preferredModel } | null` — the slice sent to the sidecar
- `hasSkill: boolean` — true if a valid skill is resolved
- `setSkill(id: string): void` — calls store `setActiveSkill`
- `skills: Skill[]` — all available skills

**Purpose**: Every consumer (AgentTab, GlobalChatNode, useExplorerWebSocket, Workspace.tsx) calls this hook/function instead of duplicating resolution logic.

---

### 3. Store Cleanup

---

#### [MODIFY] [store.ts](file:///Users/suciuvictortraian/Development/axiom/src/store.ts)

- **Remove** the inline built-in skill objects (lines 527–575) and replace with `import { BUILT_IN_SKILLS } from "./config/skillDefinitions"` → `skills: BUILT_IN_SKILLS`.
- **Remove** the hardcoded `skillId: "skill_task_auditor"` in `addGlobalChatNode` (line 1338) and replace with `skillId: DEFAULT_SKILL_ID`.

---

### 4. AgentTab Refactor

---

#### [MODIFY] [AgentTab.tsx](file:///Users/suciuvictortraian/Development/axiom/src/components/tabs/AgentTab.tsx)

- Replace the duplicated skill-resolution `useEffect` (lines 83–93) and associated `selectedSkillId` state management with a call to `useSkill()`.
- The `CustomSelect` for skill now uses `resolvedSkill.id` as value and `setSkill()` as `onChange`.
- The `hasSelectedSkill` guard stays but is driven by `hasSkill` from the hook.
- Remove all hardcoded `"skill_task_auditor"` references.
- The `socket.onopen` callback uses `skillData` directly from `useSkill()` instead of re-fetching from the store.

---

### 5. GlobalChatNode Refactor

---

#### [MODIFY] [GlobalChatNode.tsx](file:///Users/suciuvictortraian/Development/axiom/src/components/nodes/GlobalChatNode.tsx)

- Remove the special-case "default auditor" option (lines 191–196).
- Remove the filter that hides `skill_task_auditor` from the list (line 198).
- Show **all skills** in the dropdown, with `skill_task_auditor` as the default selection (already set in `store.ts`).
- Use `BUILT_IN_SKILL_IDS.TASK_AUDITOR` constant instead of `"skill_task_auditor"` string.
- The fallback display label (currently `"SKILL: default auditor"`) should show the actual skill name from the list.
- The node's `data.skillId` must always be set (enforced by the store's `addGlobalChatNode`).

---

### 6. SidePane / useExplorerWebSocket Refactor

---

#### [MODIFY] [useExplorerWebSocket.ts](file:///Users/suciuvictortraian/Development/axiom/src/components/sidepane/useExplorerWebSocket.ts)

**Chat send path (line 166–175)**:
- Extract the skill resolution block into a shared utility function `resolveSkillData(skills, skillId)` imported from the hook/utility.
- Remove `"skill_task_auditor"` hardcoded string; use `BUILT_IN_SKILL_IDS.TASK_AUDITOR`.

**Task generation / summarize path (line 465–471)**:
- Same: use `BUILT_IN_SKILL_IDS.TASK_AUDITOR` constant.

---

### 7. Workspace.tsx — TaskNode Execution

---

#### [MODIFY] [Workspace.tsx](file:///Users/suciuvictortraian/Development/axiom/src/components/Workspace.tsx)

- In the task execution path (line 149–155): if `nodeSkillId` is absent, fall back to `DEFAULT_SKILL_ID` (the task-auditor) instead of silently passing `null` skill.
- Use `BUILT_IN_SKILL_IDS.TASK_AUDITOR` constant.

---

### 8. SkillsTab — Minor Polish

---

#### [MODIFY] [SkillsTab.tsx](file:///Users/suciuvictortraian/Development/axiom/src/components/tabs/SkillsTab.tsx)

- No logic changes, just import `BUILT_IN_SKILL_IDS` to avoid re-typing `"skill_task_auditor"` anywhere.
- Consider showing the skill `description` beneath the system prompt editor as read-only help text for built-in skills.

---

## File Summary

```
src/
  config/
    skillDefinitions.ts          [NEW] — built-in skill data + ID constants + DEFAULT_SKILL_ID
  hooks/
    useSkill.ts                  [NEW] — shared skill resolution hook
  store.ts                       [MODIFY] — import built-in skills, remove inline strings
  components/
    tabs/
      AgentTab.tsx               [MODIFY] — use useSkill hook
      SkillsTab.tsx              [MODIFY] — use BUILT_IN_SKILL_IDS constant
    nodes/
      GlobalChatNode.tsx         [MODIFY] — remove special-case "default auditor", show all skills
    sidepane/
      useExplorerWebSocket.ts    [MODIFY] — use BUILT_IN_SKILL_IDS constant, shared resolver
    Workspace.tsx                [MODIFY] — fallback to DEFAULT_SKILL_ID when skill absent
```

---

## Verification Plan

### Automated Tests
- No automated test suite currently; verification is manual.

### Manual Verification

1. **AgentTab** — Open an Agent tab; verify the skill selector defaults to `task-auditor`. Change skill; verify the new skill name is shown and the correct system prompt is sent (check sidecar logs).
2. **GlobalChatNode** — Add a Global Explorer node; verify the skill dropdown shows all skills (including `task-auditor`) without a "default auditor" entry. Send a message; verify the correct skill is resolved.
3. **No-skill prevention** — Temporarily clear `skills` in the store; verify that the Chat Input is disabled and a helpful message is shown.
4. **TaskNode execution** — Create a TaskNode without a skill set; verify it falls back to `task-auditor` (check sidecar logs, not null skill).
5. **SkillsTab** — Open Skills tab; verify built-in skills still appear with correct names, descriptions, and prompts.
6. **skillDefinitions.ts** — Open the file directly; confirm all four built-in skill system prompts are readable and editable in one place.
