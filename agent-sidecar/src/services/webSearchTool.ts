import { createJiti } from "jiti";

type SearchProvider = "auto" | "openai" | "brave" | "parallel" | "tavily" | "exa" | "perplexity" | "gemini";

interface WebSearchArgs {
  query: string;
  numResults?: number;
  recencyFilter?: "day" | "week" | "month" | "year";
  domainFilter?: string[];
  provider?: SearchProvider;
}

type Search = (query: string, options: Omit<WebSearchArgs, "query">) => Promise<{
  provider: string;
  answer: string;
  results: Array<{ title: string; url: string; snippet: string }>;
}>;

let searchImplementation: Search | undefined;

async function getSearchImplementation(): Promise<Search> {
  if (searchImplementation) return searchImplementation;

  // pi-web-access is distributed as TypeScript for Pi's extension loader. Jiti
  // lets Agent Tab load the same source without bundling it into the sidecar.
  const jiti = createJiti(__filename, { interopDefault: true });
  const module = await jiti.import<{ search: Search }>("pi-web-access/gemini-search.ts");
  if (typeof module.search !== "function") {
    throw new Error("Unable to load pi-web-access search implementation.");
  }
  searchImplementation = module.search;
  return searchImplementation;
}

/**
 * Adapts pi-web-access for Axiom's OpenAI-compatible Agent Tab loop.
 *
 * Canvas tasks load the package as a native Pi extension. Agent Tab runs its
 * own tool loop, so it needs the same search implementation exposed as a
 * standard callable tool.
 */
export function createWebSearchTool(sendLog: (message: string) => void) {
  return {
    name: "web_search",
    description: "Search the public web for current information and return an answer with source links.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The web search query." },
        numResults: { type: "number", description: "Number of results to return (default: 5, maximum: 20)." },
        recencyFilter: { type: "string", enum: ["day", "week", "month", "year"], description: "Optional recency filter." },
        domainFilter: { type: "array", items: { type: "string" }, description: "Optional domain allowlist; prefix a domain with '-' to exclude it." },
        provider: { type: "string", enum: ["auto", "openai", "brave", "parallel", "tavily", "exa", "perplexity", "gemini"], description: "Optional search provider; defaults to automatic selection." }
      },
      required: ["query"]
    },
    execute: async ({ query, numResults, recencyFilter, domainFilter, provider = "auto" }: WebSearchArgs) => {
      if (!query?.trim()) {
        throw new Error("A web search query is required.");
      }

      sendLog(`Searching the web: ${query}`);
      const search = await getSearchImplementation();
      const response = await search(query.trim(), {
        provider,
        numResults: numResults ? Math.min(Math.max(Math.floor(numResults), 1), 20) : undefined,
        recencyFilter,
        domainFilter,
      });

      const sources = response.results
        .map((result, index) => `${index + 1}. ${result.title}\n   ${result.url}${result.snippet ? `\n   ${result.snippet}` : ""}`)
        .join("\n");

      return [
        `Web search provider: ${response.provider}`,
        response.answer || "The search returned sources without a synthesized answer.",
        sources ? `Sources:\n${sources}` : "No sources were returned."
      ].join("\n\n");
    }
  };
}
