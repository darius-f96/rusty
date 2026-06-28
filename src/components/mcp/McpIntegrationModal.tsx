import React, { useState } from "react";
import { useForm, useFieldArray, SubmitHandler } from "react-hook-form";
import {
  McpServerConfig,
  McpFormValues,
  TransportType,
  AuthType,
  McpIntegrationModalProps,
} from "./types";
import {
  Plug,
  X,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Info,
} from "lucide-react";
import styles from "./McpIntegrationModal.module.css";

const TRANSPORT_OPTIONS: { value: TransportType; label: string }[] = [
  { value: "http", label: "HTTP (Streamable)" },
  { value: "sse", label: "SSE (Server-Sent Events)" },
  { value: "websocket", label: "WebSocket" },
  { value: "stdio", label: "Stdio (local process)" },
];

const AUTH_OPTIONS: { value: AuthType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "apiKey", label: "API Key (header)" },
  { value: "bearer", label: "Bearer Token" },
  { value: "oauth2", label: "OAuth 2.0" },
];

const GRANT_OPTIONS = [
  { value: "client_credentials", label: "Client Credentials" },
  { value: "authorization_code", label: "Authorization Code" },
];

const emptyFormValues: McpFormValues = {
  name: "",
  displayName: "",
  description: "",
  enabled: true,
  transportType: "http",
  url: "",
  command: "",
  args: [],
  env: [],
  authType: "none",
  header: "",
  value: "",
  token: "",
  clientId: "",
  clientSecret: "",
  tokenUrl: "",
  scopesText: "",
  grantType: "client_credentials",
  timeout: 30000,
  maxRetries: 3,
  retryDelay: 1000,
};

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return ["http:", "https:", "ws:", "wss:"].includes(u.protocol);
  } catch {
    return false;
  }
}

function toFormValues(cfg?: McpServerConfig): McpFormValues {
  if (!cfg) return { ...emptyFormValues };
  return {
    name: cfg.name,
    displayName: cfg.displayName ?? "",
    description: cfg.description ?? "",
    enabled: cfg.enabled,
    transportType: cfg.transport.type,
    url: cfg.transport.url ?? "",
    command: cfg.transport.command ?? "",
    args: (cfg.transport.args ?? []).map((a) => ({ value: a })),
    env: Object.entries(cfg.transport.env ?? {}).map(([key, value]) => ({
      key,
      value,
    })),
    authType: cfg.auth.type,
    header: cfg.auth.header ?? "",
    value: cfg.auth.value ?? "",
    token: cfg.auth.token ?? "",
    clientId: cfg.auth.clientId ?? "",
    clientSecret: cfg.auth.clientSecret ?? "",
    tokenUrl: cfg.auth.tokenUrl ?? "",
    scopesText: (cfg.auth.scopes ?? []).join(", "),
    grantType: cfg.auth.grantType ?? "client_credentials",
    timeout: cfg.timeout,
    maxRetries: cfg.maxRetries,
    retryDelay: cfg.retryDelay,
  };
}

function toServerConfig(v: McpFormValues): McpServerConfig {
  const isStdio = v.transportType === "stdio";
  const transport = isStdio
    ? {
        type: v.transportType as TransportType,
        command: v.command,
        args: v.args.map((a) => a.value).filter((a) => a.length > 0),
        env: v.env.reduce<Record<string, string>>((acc, row) => {
          const key = row.key.trim();
          if (key) acc[key] = row.value;
          return acc;
        }, {}),
      }
    : {
        type: v.transportType as TransportType,
        url: v.url,
      };

  const auth: McpServerConfig["auth"] = { type: v.authType };
  if (v.authType === "apiKey") {
    auth.header = v.header;
    auth.value = v.value;
  } else if (v.authType === "bearer") {
    auth.token = v.token;
  } else if (v.authType === "oauth2") {
    auth.clientId = v.clientId;
    auth.clientSecret = v.clientSecret;
    auth.tokenUrl = v.tokenUrl;
    auth.scopes = v.scopesText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    auth.grantType = v.grantType;
  }

  return {
    name: v.name,
    displayName: v.displayName || undefined,
    description: v.description || undefined,
    enabled: v.enabled,
    transport,
    auth,
    timeout: v.timeout,
    maxRetries: v.maxRetries,
    retryDelay: v.retryDelay,
  };
}

type TestState =
  | { status: "idle" }
  | { status: "testing"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export const McpIntegrationModal: React.FC<McpIntegrationModalProps> = ({
  initialConfig,
  existingNames,
  onSave,
  onCancel,
}) => {
  const {
    register,
    control,
    watch,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<McpFormValues>({
    defaultValues: toFormValues(initialConfig),
    mode: "onBlur",
  });

  const { fields: argFields, append: appendArg, remove: removeArg } =
    useFieldArray({ control, name: "args" });
  const { fields: envFields, append: appendEnv, remove: removeEnv } =
    useFieldArray({ control, name: "env" });

  const transportType = watch("transportType");
  const authType = watch("authType");
  const enabled = watch("enabled");

  const [test, setTest] = useState<TestState>({ status: "idle" });

  const isStdio = transportType === "stdio";

  const handleTest = async () => {
    const tt = watch("transportType");
    const url = watch("url");
    const command = watch("command");
    const timeoutMs = watch("timeout");

    if (tt === "stdio") {
      if (!command.trim()) {
        setTest({ status: "error", message: "Enter a command before testing." });
        return;
      }
      setTest({ status: "testing", message: "Simulating spawn..." });
      await new Promise((r) => setTimeout(r, 450));
      setTest({
        status: "success",
        message: `Simulated check: would spawn \`${command} --version\`. Actual process spawn is backend-only.`,
      });
      return;
    }

    if (!url.trim() || !isValidUrl(url)) {
      setTest({ status: "error", message: "Enter a valid URL before testing." });
      return;
    }

    if (tt === "websocket") {
      setTest({
        status: "success",
        message:
          "WebSocket URL is valid. Live handshake is performed by the backend at runtime — browsers cannot probe ws:// directly.",
      });
      return;
    }

    setTest({ status: "testing", message: `Probing ${url} ...` });
    const probeTimeout = Math.min(Number.isFinite(timeoutMs) ? timeoutMs : 8000, 8000);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), probeTimeout);
      await fetch(url, { mode: "no-cors", signal: controller.signal });
      clearTimeout(timer);
      setTest({
        status: "success",
        message: `Reachable — endpoint responded (${url}). Auth headers are applied at runtime.`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof DOMException && e.name === "AbortError") {
        setTest({ status: "error", message: `Request timed out after ${probeTimeout}ms.` });
      } else {
        setTest({ status: "error", message: `Connection failed: ${msg}` });
      }
    }
  };

  const onSubmit: SubmitHandler<McpFormValues> = (values) => {
    onSave(toServerConfig(values));
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <form className={styles.modal} onSubmit={handleSubmit(onSubmit)}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Plug size={18} className={styles.headerIcon} />
            <div>
              <h2 className={styles.title}>
                {initialConfig ? "Edit MCP Server" : "Add MCP Server"}
              </h2>
              <p className={styles.subtitle}>
                {initialConfig
                  ? `Editing: ${initialConfig.displayName || initialConfig.name}`
                  : "Configure a Model Context Protocol server"}
              </p>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onCancel}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          {/* Identity */}
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>Identity</h3>
              <p className={styles.sectionDesc}>
                Unique identifier and human-facing metadata for this server.
              </p>
            </div>

            <div className={styles.row}>
              <div className={styles.field}>
                <label className={`${styles.label} ${styles.labelRequired}`} htmlFor="mcp-name">
                  Name
                </label>
                <input
                  id="mcp-name"
                  className={`${styles.input} ${errors.name ? styles.inputError : ""}`}
                  placeholder="e.g. github-mcp"
                  {...register("name", {
                    required: "Name is required",
                    pattern: {
                      value: /^[a-z0-9-_]+$/,
                      message: "Lowercase letters, digits, '-' and '_' only",
                    },
                    validate: (v) => {
                      if (
                        v &&
                        existingNames?.includes(v) &&
                        v !== initialConfig?.name
                      ) {
                        return "A server with this name already exists";
                      }
                      return true;
                    },
                  })}
                />
                {errors.name && (
                  <span className={styles.error}>
                    <AlertCircle size={12} /> {errors.name.message}
                  </span>
                )}
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="mcp-display">
                  Display name (optional)
                </label>
                <input
                  id="mcp-display"
                  className={styles.input}
                  placeholder="GitHub MCP"
                  {...register("displayName")}
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="mcp-desc">
                Description (optional)
              </label>
              <textarea
                id="mcp-desc"
                className={styles.textarea}
                rows={2}
                placeholder="What this server exposes..."
                {...register("description")}
              />
            </div>

            <div className={styles.toggleRow}>
              <button
                type="button"
                className={`${styles.toggle} ${enabled ? styles.toggleOn : ""}`}
                onClick={() => setValue("enabled", !enabled, { shouldDirty: true })}
                aria-pressed={enabled}
                aria-label="Toggle enabled"
              >
                <span
                  className={`${styles.toggleKnob} ${enabled ? styles.toggleKnobOn : ""}`}
                />
              </button>
              <span className={styles.toggleLabel}>
                Enabled {enabled ? "(active)" : "(disabled)"}
              </span>
            </div>
          </section>

          {/* Transport */}
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>Transport</h3>
              <p className={styles.sectionDesc}>
                How the client connects to this server.
              </p>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="mcp-transport">
                Transport type
              </label>
              <select
                id="mcp-transport"
                className={styles.select}
                {...register("transportType")}
              >
                {TRANSPORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {!isStdio && (
              <div className={styles.field}>
                <label className={`${styles.label} ${styles.labelRequired}`} htmlFor="mcp-url">
                  URL
                </label>
                <input
                  id="mcp-url"
                  className={`${styles.input} ${errors.url ? styles.inputError : ""}`}
                  placeholder={
                    transportType === "websocket"
                      ? "wss://server.example.com/mcp"
                      : "https://server.example.com/mcp"
                  }
                  {...register("url", {
                    validate: (v, fv) => {
                      if (fv.transportType === "stdio") return true;
                      if (!v) return "URL is required";
                      if (!isValidUrl(v)) return "Enter a valid http(s) or ws(s) URL";
                      return true;
                    },
                  })}
                />
                {errors.url && (
                  <span className={styles.error}>
                    <AlertCircle size={12} /> {errors.url.message}
                  </span>
                )}
              </div>
            )}

            {isStdio && (
              <>
                <div className={styles.field}>
                  <label className={`${styles.label} ${styles.labelRequired}`} htmlFor="mcp-command">
                    Command
                  </label>
                  <input
                    id="mcp-command"
                    className={`${styles.input} ${errors.command ? styles.inputError : ""}`}
                    placeholder="e.g. npx"
                    {...register("command", {
                      validate: (v, fv) =>
                        fv.transportType === "stdio"
                          ? v
                            ? true
                            : "Command is required"
                          : true,
                    })}
                  />
                  {errors.command && (
                    <span className={styles.error}>
                      <AlertCircle size={12} /> {errors.command.message}
                    </span>
                  )}
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>Arguments</label>
                  <div className={styles.kvList}>
                    {argFields.length === 0 && (
                      <p className={styles.emptyNote}>No arguments.</p>
                    )}
                    {argFields.map((field, index) => (
                      <div key={field.id} className={styles.kvRow}>
                        <input
                          className={styles.input}
                          placeholder={`arg ${index + 1}`}
                          defaultValue={field.value}
                          {...register(`args.${index}.value`)}
                        />
                        <span />
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={() => removeArg(index)}
                          aria-label="Remove argument"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={styles.addBtn}
                    onClick={() => appendArg({ value: "" })}
                  >
                    <Plus size={12} /> Add argument
                  </button>
                </div>
              </>
            )}
          </section>

          {/* Authentication */}
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>Authentication</h3>
              <p className={styles.sectionDesc}>
                Credentials applied to every request. Secrets support{" "}
                <span className={styles.code}>${"{ENV_VAR}"}</span> interpolation.
              </p>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="mcp-auth">
                Auth type
              </label>
              <select
                id="mcp-auth"
                className={styles.select}
                {...register("authType")}
              >
                {AUTH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {authType === "apiKey" && (
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={`${styles.label} ${styles.labelRequired}`} htmlFor="mcp-header">
                    Header name
                  </label>
                  <input
                    id="mcp-header"
                    className={`${styles.input} ${errors.header ? styles.inputError : ""}`}
                    placeholder="X-API-Key"
                    {...register("header", {
                      validate: (v, fv) =>
                        fv.authType === "apiKey"
                          ? v
                            ? true
                            : "Header name is required"
                          : true,
                    })}
                  />
                  {errors.header && (
                    <span className={styles.error}>
                      <AlertCircle size={12} /> {errors.header.message}
                    </span>
                  )}
                </div>
                <div className={styles.field}>
                  <label className={`${styles.label} ${styles.labelRequired}`} htmlFor="mcp-value">
                    Value
                  </label>
                  <input
                    id="mcp-value"
                    type="password"
                    className={`${styles.input} ${errors.value ? styles.inputError : ""}`}
                    placeholder="${API_KEY}"
                    autoComplete="off"
                    {...register("value", {
                      validate: (v, fv) =>
                        fv.authType === "apiKey"
                          ? v
                            ? true
                            : "API key value is required"
                          : true,
                    })}
                  />
                  {errors.value && (
                    <span className={styles.error}>
                      <AlertCircle size={12} /> {errors.value.message}
                    </span>
                  )}
                </div>
              </div>
            )}

            {authType === "bearer" && (
              <div className={styles.field}>
                <label className={`${styles.label} ${styles.labelRequired}`} htmlFor="mcp-token">
                  Token
                </label>
                <input
                  id="mcp-token"
                  type="password"
                  className={`${styles.input} ${errors.token ? styles.inputError : ""}`}
                  placeholder="${BEARER_TOKEN}"
                  autoComplete="off"
                  {...register("token", {
                    validate: (v, fv) =>
                      fv.authType === "bearer"
                        ? v
                          ? true
                        : "Bearer token is required"
                        : true,
                  })}
                />
                {errors.token && (
                  <span className={styles.error}>
                    <AlertCircle size={12} /> {errors.token.message}
                  </span>
                )}
              </div>
            )}

            {authType === "oauth2" && (
              <>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={`${styles.label} ${styles.labelRequired}`} htmlFor="mcp-client-id">
                      Client ID
                    </label>
                    <input
                      id="mcp-client-id"
                      className={`${styles.input} ${errors.clientId ? styles.inputError : ""}`}
                      placeholder="client-id"
                      {...register("clientId", {
                        validate: (v, fv) =>
                          fv.authType === "oauth2"
                            ? v
                              ? true
                              : "Client ID is required"
                            : true,
                      })}
                    />
                    {errors.clientId && (
                      <span className={styles.error}>
                        <AlertCircle size={12} /> {errors.clientId.message}
                      </span>
                    )}
                  </div>
                  <div className={styles.field}>
                    <label className={`${styles.label} ${styles.labelRequired}`} htmlFor="mcp-client-secret">
                      Client secret
                    </label>
                    <input
                      id="mcp-client-secret"
                      type="password"
                      className={`${styles.input} ${errors.clientSecret ? styles.inputError : ""}`}
                      placeholder="${CLIENT_SECRET}"
                      autoComplete="off"
                      {...register("clientSecret", {
                        validate: (v, fv) =>
                          fv.authType === "oauth2"
                            ? v
                              ? true
                              : "Client secret is required"
                            : true,
                      })}
                    />
                    {errors.clientSecret && (
                      <span className={styles.error}>
                        <AlertCircle size={12} /> {errors.clientSecret.message}
                      </span>
                    )}
                  </div>
                </div>

                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={`${styles.label} ${styles.labelRequired}`} htmlFor="mcp-token-url">
                      Token URL
                    </label>
                    <input
                      id="mcp-token-url"
                      className={`${styles.input} ${errors.tokenUrl ? styles.inputError : ""}`}
                      placeholder="https://auth.example.com/oauth/token"
                      {...register("tokenUrl", {
                        validate: (v, fv) =>
                          fv.authType === "oauth2"
                            ? v
                              ? true
                              : "Token URL is required"
                            : true,
                      })}
                    />
                    {errors.tokenUrl && (
                      <span className={styles.error}>
                        <AlertCircle size={12} /> {errors.tokenUrl.message}
                      </span>
                    )}
                  </div>
                  <div className={styles.field}>
                    <label className={`${styles.label} ${styles.labelRequired}`} htmlFor="mcp-grant">
                      Grant type
                    </label>
                    <select
                      id="mcp-grant"
                      className={styles.select}
                      {...register("grantType", {
                        validate: (v, fv) =>
                          fv.authType === "oauth2"
                            ? v
                              ? true
                              : "Grant type is required"
                            : true,
                      })}
                    >
                      {GRANT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="mcp-scopes">
                    Scopes (comma-separated)
                  </label>
                  <input
                    id="mcp-scopes"
                    className={styles.input}
                    placeholder="read:repo, write:repo"
                    {...register("scopesText")}
                  />
                </div>
              </>
            )}

            {authType !== "none" && (
              <p className={styles.hint}>
                <Info size={13} className={styles.hintIcon} />
                <span>
                  Use <span className={styles.code}>${"{ENV_VAR}"}</span> to reference
                  environment variables — resolved at runtime, never stored or logged
                  in plaintext.
                </span>
              </p>
            )}
          </section>

          {/* Environment variables (stdio only) */}
          {isStdio && (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h3 className={styles.sectionTitle}>Environment variables</h3>
                <p className={styles.sectionDesc}>
                  Passed to the spawned stdio process.
                </p>
              </div>

              <div className={styles.kvList}>
                {envFields.length === 0 && (
                  <p className={styles.emptyNote}>No environment variables set.</p>
                )}
                {envFields.map((field, index) => (
                  <div key={field.id} className={styles.kvRow}>
                    <input
                      className={styles.input}
                      placeholder="KEY"
                      defaultValue={field.key}
                      {...register(`env.${index}.key`)}
                    />
                    <input
                      className={styles.input}
                      placeholder="value or ${ENV_VAR}"
                      defaultValue={field.value}
                      {...register(`env.${index}.value`)}
                    />
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => removeEnv(index)}
                      aria-label="Remove variable"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className={styles.addBtn}
                onClick={() => appendEnv({ key: "", value: "" })}
              >
                <Plus size={12} /> Add variable
              </button>
            </section>
          )}

          {/* Advanced */}
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>Advanced</h3>
              <p className={styles.sectionDesc}>
                Timeouts and retry behavior for the client connection.
              </p>
            </div>

            <div className={styles.rowThree}>
              <div className={styles.field}>
                <label className={`${styles.label} ${styles.labelRequired}`} htmlFor="mcp-timeout">
                  Timeout (ms)
                </label>
                <input
                  id="mcp-timeout"
                  type="number"
                  className={`${styles.input} ${errors.timeout ? styles.inputError : ""}`}
                  {...register("timeout", {
                    valueAsNumber: true,
                    validate: (v) =>
                      Number.isFinite(v) && v >= 0 || "Enter a positive number",
                  })}
                />
                {errors.timeout && (
                  <span className={styles.error}>
                    <AlertCircle size={12} /> {errors.timeout.message}
                  </span>
                )}
              </div>

              <div className={styles.field}>
                <label className={`${styles.label} ${styles.labelRequired}`} htmlFor="mcp-retries">
                  Max retries (0–10)
                </label>
                <input
                  id="mcp-retries"
                  type="number"
                  min={0}
                  max={10}
                  className={`${styles.input} ${errors.maxRetries ? styles.inputError : ""}`}
                  {...register("maxRetries", {
                    valueAsNumber: true,
                    validate: (v) =>
                      (Number.isFinite(v) && v >= 0 && v <= 10) ||
                      "Enter a number 0–10",
                  })}
                />
                {errors.maxRetries && (
                  <span className={styles.error}>
                    <AlertCircle size={12} /> {errors.maxRetries.message}
                  </span>
                )}
              </div>

              <div className={styles.field}>
                <label className={`${styles.label} ${styles.labelRequired}`} htmlFor="mcp-retry-delay">
                  Retry delay (ms)
                </label>
                <input
                  id="mcp-retry-delay"
                  type="number"
                  className={`${styles.input} ${errors.retryDelay ? styles.inputError : ""}`}
                  {...register("retryDelay", {
                    valueAsNumber: true,
                    validate: (v) =>
                      Number.isFinite(v) && v >= 0 || "Enter a positive number",
                  })}
                />
                {errors.retryDelay && (
                  <span className={styles.error}>
                    <AlertCircle size={12} /> {errors.retryDelay.message}
                  </span>
                )}
              </div>
            </div>
          </section>

          {test.status !== "idle" && (
            <div
              className={`${styles.testResult} ${
                test.status === "success"
                  ? styles.testSuccess
                  : test.status === "error"
                  ? styles.testError
                  : styles.testPending
              }`}
            >
              {test.status === "success" && <CheckCircle2 size={15} />}
              {test.status === "error" && <AlertCircle size={15} />}
              {test.status === "testing" && <Loader2 size={15} className={styles.spin} />}
              <span>{test.message}</span>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnTest}`}
              onClick={handleTest}
              disabled={test.status === "testing"}
            >
              {test.status === "testing" ? (
                <Loader2 size={14} className={styles.spin} />
              ) : (
                "Test connection"
              )}
            </button>
          </div>
          <div className={styles.footerRight}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`${styles.btn} ${styles.btnPrimary}`}
            >
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
