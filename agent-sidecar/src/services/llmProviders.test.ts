import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverProviderModels,
  providerModelId,
  remoteModelId,
} from "./llmProviders";

test("model references preserve provider-owned slash IDs", () => {
  const reference = providerModelId("github-models", "openai/gpt-4.1");
  assert.equal(reference, "github-models/openai/gpt-4.1");
  assert.equal(remoteModelId(reference, "github-models"), "openai/gpt-4.1");
});

test("Copilot providers cannot fall through to the generic HTTP adapter", async () => {
  await assert.rejects(
    discoverProviderModels({
      id: "github-copilot",
      name: "GitHub Copilot",
      baseUrl: "",
      apiType: "copilot-sdk",
      transport: "github-copilot-sdk",
      authType: "environment",
    }),
    /Copilot SDK adapter/,
  );
});

test("Codex providers cannot fall through to the generic HTTP adapter", async () => {
  await assert.rejects(
    discoverProviderModels({
      id: "openai-codex",
      name: "OpenAI Codex",
      baseUrl: "",
      apiType: "codex-app-server",
      transport: "openai-codex-app-server",
      authType: "environment",
    }),
    /Codex app-server adapter/,
  );
});

test("GitHub catalog arrays are normalized and unsupported models are marked", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer github-token");
    assert.equal((init?.headers as Record<string, string>)["X-GitHub-Api-Version"], "2026-03-10");
    return new Response(JSON.stringify([
      {
        id: "openai/gpt-4.1",
        name: "GPT-4.1",
        capabilities: ["tool-calling"],
        supported_output_modalities: ["text"],
      },
      {
        id: "vendor/embedding-model",
        name: "Embedding Model",
        capabilities: ["embeddings"],
        supported_output_modalities: ["embeddings"],
      },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const models = await discoverProviderModels({
      id: "github-models",
      name: "GitHub Models",
      baseUrl: "https://models.github.ai/inference",
      apiKey: "github-token",
      apiType: "openai-completions",
      authType: "bearer",
      catalogUrl: "https://models.github.ai/catalog/models",
    });
    assert.equal(models[0].id, "github-models/openai/gpt-4.1");
    assert.equal(models[0].remoteId, "openai/gpt-4.1");
    assert.equal(models[0].supported, true);
    assert.equal(models[1].supported, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Anthropic-style custom catalogs use x-api-key authentication", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://gateway.example.test/v1/models");
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], "anthropic-key");
    assert.equal(headers["anthropic-version"], "2023-06-01");
    assert.equal(headers.Authorization, undefined);
    return new Response(JSON.stringify({ data: [{ id: "custom-sonnet" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const models = await discoverProviderModels({
      id: "private-anthropic-gateway",
      name: "Private Anthropic Gateway",
      baseUrl: "https://gateway.example.test/v1",
      apiKey: "anthropic-key",
      apiType: "anthropic-messages",
      authType: "anthropic",
    });
    assert.equal(models[0].apiType, "anthropic-messages");
    assert.equal(models[0].baseUrl, "https://gateway.example.test/v1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("current OpenAI text models stay usable when the bundled catalog lags", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [
      { id: "gpt-5.6-sol" },
      { id: "gpt-realtime-2.1" },
      { id: "text-embedding-3-large" },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const models = await discoverProviderModels({
      id: "openai",
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "openai-key",
      apiType: "openai-responses",
      authType: "bearer",
    });
    const supported = models.filter((model) => model.supported).map((model) => model.remoteId);
    assert.deepEqual(supported, ["gpt-5.6-sol"]);
    assert.equal(models.find((model) => model.remoteId === "gpt-5.6-sol")?.apiType, "openai-responses");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
