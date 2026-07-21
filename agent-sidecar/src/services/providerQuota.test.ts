import assert from "node:assert/strict";
import test from "node:test";
import {
  mapCodexQuota,
  mapClaudeCodeQuota,
  mapCopilotQuota,
  mapUnavailableProviderQuota,
} from "./providerQuota";

test("Claude Code quota mapper uses local login and normalizes usage windows", () => {
  const quota = mapClaudeCodeQuota(
    { id: "anthropic-claude-code", name: "Claude Code" },
    {
      authenticated: true,
      email: "developer@example.com",
      plan: "pro",
      usage: {
        five_hour: { utilization: 21, resets_at: "2026-07-21T15:00:00Z" },
        seven_day: { utilization: 64.5, resets_at: "2026-07-27T00:00:00Z" },
      },
    },
  );

  assert.equal(quota.state, "available");
  assert.equal(quota.account, "developer@example.com");
  assert.equal(quota.windows[0].label, "5-hour limit");
  assert.equal(quota.windows[0].remainingPercent, 79);
  assert.equal(quota.windows[1].label, "Weekly limit");
  assert.equal(quota.windows[1].remainingPercent, 35.5);
});

test("Claude Code quota mapper reports sign-in only when Claude itself is logged out", () => {
  const quota = mapClaudeCodeQuota(
    { id: "anthropic-claude-code", name: "Claude Code" },
    { authenticated: false, message: "Sign in with Claude Code first." },
  );
  assert.equal(quota.state, "unauthenticated");
  assert.match(quota.message || "", /Sign in/);
});

test("Copilot quota mapper normalizes premium requests and unlimited windows", () => {
  const quota = mapCopilotQuota(
    { id: "github-copilot", name: "GitHub Copilot" },
    {
      authenticated: true,
      login: "octocat",
      plan: "individual",
      quotaSnapshots: {
        completions: {
          isUnlimitedEntitlement: true,
          entitlementRequests: -1,
          usedRequests: 25,
          remainingPercentage: 100,
          overage: 0,
          resetDate: "2026-08-01T00:00:00Z",
        },
        premium_interactions: {
          isUnlimitedEntitlement: false,
          entitlementRequests: 300,
          usedRequests: 75,
          remainingPercentage: 75,
          overage: 0,
          resetDate: "2026-08-01T00:00:00Z",
        },
      },
    },
  );

  assert.equal(quota.state, "available");
  assert.equal(quota.plan, "individual");
  assert.equal(quota.account, "octocat");
  assert.deepEqual(quota.windows.map((window) => window.id), ["premium_interactions", "completions"]);
  assert.equal(quota.windows[0].remaining, 225);
  assert.equal(quota.windows[0].remainingPercent, 75);
  assert.equal(quota.windows[1].unlimited, true);
  assert.equal(quota.windows[1].limit, undefined);
});

test("Codex quota mapper converts used percentages into remaining quota", () => {
  const quota = mapCodexQuota(
    { id: "openai-codex", name: "OpenAI Codex" },
    {
      authenticated: true,
      email: "developer@example.com",
      plan: "plus",
      rateLimitResult: {
        rateLimits: {
          planType: "pro",
          primary: { usedPercent: 26, windowDurationMins: 300, resetsAt: 1_787_000_000 },
          secondary: { usedPercent: 60, windowDurationMins: 10_080, resetsAt: 1_787_600_000 },
          individualLimit: { limit: "100", used: "35", remainingPercent: 65, resetsAt: 1_788_000_000 },
          credits: { hasCredits: true, unlimited: false, balance: "42.50" },
        },
        rateLimitResetCredits: { availableCount: 2 },
        spendControlReached: false,
      },
    },
  );

  assert.equal(quota.state, "available");
  assert.equal(quota.plan, "pro");
  assert.equal(quota.windows[0].label, "5-hour limit");
  assert.equal(quota.windows[0].remainingPercent, 74);
  assert.equal(quota.windows[1].label, "Weekly limit");
  assert.equal(quota.windows[1].remainingPercent, 40);
  assert.equal(quota.windows[2].label, "Monthly spend limit");
  assert.equal(quota.windows[2].remaining, 65);
  assert.deepEqual(quota.balance, { formatted: "42.50", unlimited: false });
  assert.equal(quota.resetCreditsAvailable, 2);
});

test("providers without a quota API distinguish missing credentials from unavailable data", () => {
  const unauthenticated = mapUnavailableProviderQuota(
    { id: "opencode", name: "OpenCode Zen" },
    false,
  );
  const unavailable = mapUnavailableProviderQuota(
    { id: "opencode", name: "OpenCode Zen" },
    true,
  );

  assert.equal(unauthenticated.state, "unauthenticated");
  assert.equal(unavailable.state, "unavailable");
  assert.match(unavailable.message || "", /does not expose Zen balance/);
  assert.equal(unavailable.manageUrl, "https://opencode.ai/console");
});
