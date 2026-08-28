'use client';
import { useState, useEffect } from 'react';
import { Play, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

interface OpenApiSpec {
  paths: Record<string, Record<string, EndpointSpec>>;
  components: {
    schemas: Record<string, unknown>;
  };
}

interface EndpointSpec {
  summary?: string;
  description?: string;
  tags?: string[];
  requestBody?: {
    required?: boolean;
    content: Record<string, { schema: Record<string, unknown> }>;
  };
  parameters?: Array<{
    name: string;
    in: string;
    description?: string;
    required?: boolean;
    schema: Record<string, unknown>;
  }>;
  responses: Record<string, { description: string; content?: Record<string, unknown> }>;
}

// ─── Where "Try it" sends the request (#871) ──────────────────────────────────
//
// This used to be a single const pointing at production, and every Send button
// on the docs page fired a live request at it — including
// POST /api/intent/offramp, which prepares a real off-ramp. #871 asks for the
// opposite: a console against a sandboxed environment, not production.
//
// So the target is a choice, it defaults to the safe one, and picking
// production is a deliberate act that carries a warning on write methods.

const PRODUCTION_ORIGIN = 'https://stellar-intel.vercel.app';

interface PlaygroundEnvironment {
  id: 'sandbox' | 'production';
  label: string;
  /** Empty string means "this page's own origin" — a preview or localhost. */
  origin: string;
  description: string;
}

const ENVIRONMENTS: readonly PlaygroundEnvironment[] = [
  {
    id: 'sandbox',
    label: 'This deployment',
    origin: '',
    description:
      'Same-origin: whichever deployment is serving this page. On a preview or localhost that is a sandbox; nothing here reaches production data.',
  },
  {
    id: 'production',
    label: 'Production',
    origin: PRODUCTION_ORIGIN,
    description: 'Live production API. Write requests have real effects.',
  },
] as const;

/** Methods that change state, and therefore warrant a warning on production. */
const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete']);

function getDefaultBody(schema: Record<string, unknown>): Record<string, string> {
  if (schema.properties) {
    const props = schema.properties as Record<string, { type?: string; example?: string }>;
    const result: Record<string, string> = {};
    for (const [key] of Object.entries(props)) {
      if (key === 'type') result[key] = 'offramp';
      else if (key === 'sourceAsset') result[key] = 'USDC';
      else if (key === 'destinationAsset') result[key] = 'NGN';
      else if (key === 'amount') result[key] = '100';
      else if (key === 'sender') result[key] = 'GABC…';
      else if (key === 'recipient') result[key] = 'GBDEST…';
      else if (key === 'anchorId') result[key] = 'cowrie';
      else if (key === 'corridorId') result[key] = 'usdc-ngn';
      else if (key === 'publicKey') result[key] = 'GABC…';
      else if (key === 'intentHash') result[key] = 'abc123…';
      else if (key === 'signature') result[key] = 'base64-signature…';
      else if (key === 'reason') result[key] = 'Sample dispute reason';
      else if (key === 'corridor') result[key] = 'usdc-ngn';
      else if (key === 'amount') result[key] = '100';
      else if (key === 'action') result[key] = 'accept';
      else result[key] = `sample-${key}`;
    }
    return result;
  }
  return {};
}

function defaultPathParam(name: string): string {
  if (name === 'corridor') return 'usdc-ngn';
  if (name === 'anchor' || name === 'anchorId' || name === 'id') return 'cowrie';
  return '';
}

function EndpointCard({
  method,
  path,
  spec,
  environment,
}: {
  method: string;
  path: string;
  spec: EndpointSpec;
  environment: PlaygroundEnvironment;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showTryIt, setShowTryIt] = useState(false);
  const [body, setBody] = useState('');
  const [response, setResponse] = useState<{ status: number; data: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Path params were collected with window.prompt(), which is blocked inside a
  // cross-origin iframe and effectively unusable on mobile. They are inputs now.
  const pathParamNames = (path.match(/\{(\w+)\}/g) ?? []).map((p) => p.slice(1, -1));
  const [pathParams, setPathParams] = useState<Record<string, string>>(() =>
    Object.fromEntries(pathParamNames.map((name) => [name, defaultPathParam(name)]))
  );

  // #805 shipped API-Version negotiation and idempotency keys. The console
  // exercised neither, so it could not demonstrate the contract the spec's own
  // description advertises.
  const [apiVersion, setApiVersion] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');

  const methodColors: Record<string, string> = {
    get: 'bg-control-border',
    post: 'bg-control-border',
    put: 'bg-control-border',
    delete: 'bg-status-down',
    patch: 'bg-control-border',
  };

  const hasBody = method === 'post' || method === 'put' || method === 'patch';

  useEffect(() => {
    if (showTryIt && spec.requestBody) {
      const schema = spec.requestBody.content['application/json']?.schema as Record<
        string,
        unknown
      >;
      if (schema) {
        setBody(JSON.stringify(getDefaultBody(schema), null, 2));
      }
    }
  }, [showTryIt, spec.requestBody]);

  const handleTryIt = async () => {
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      let parsedBody: unknown;
      if (hasBody && body) {
        parsedBody = JSON.parse(body);
      }

      let resolvedPath = path;
      for (const name of pathParamNames) {
        const value = pathParams[name]?.trim();
        if (!value) {
          setError(`Fill in the "${name}" path parameter before sending.`);
          return;
        }
        resolvedPath = resolvedPath.replace(`{${name}}`, encodeURIComponent(value));
      }

      const url = `${environment.origin}${resolvedPath}`;
      const headers: Record<string, string> = {};
      if (hasBody) headers['content-type'] = 'application/json';
      if (apiVersion.trim()) headers['API-Version'] = apiVersion.trim();
      if (idempotencyKey.trim()) headers['Idempotency-Key'] = idempotencyKey.trim();

      const init: RequestInit = { method: method.toUpperCase(), headers };
      if (hasBody) {
        init.body = JSON.stringify(parsedBody);
      }
      const res = await fetch(url, init);

      const text = await res.text();
      let formatted: string;
      try {
        formatted = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        formatted = text;
      }

      setResponse({ status: res.status, data: formatted });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-bg-subtle transition-colors"
      >
        <span
          className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold text-white ${methodColors[method] || 'bg-bg-sunken'}`}
        >
          {method.toUpperCase()}
        </span>
        <span className="font-mono text-sm text-primary-text">{path}</span>
        <span className="ml-auto text-xs text-secondary-text">{spec.summary}</span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-secondary-text" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-secondary-text" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          {spec.description && <p className="text-sm text-secondary-text">{spec.description}</p>}

          {spec.parameters && spec.parameters.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase text-secondary-text">
                Parameters
              </h4>
              <div className="space-y-1">
                {spec.parameters.map((param) => (
                  <div key={param.name} className="flex gap-2 text-xs">
                    <span className="font-mono text-accent">{param.name}</span>
                    <span className="text-secondary-text">
                      {String((param.schema as { type?: string }).type ?? 'string')}
                    </span>
                    {param.required && <span className="text-status-down">required</span>}
                    {param.description && (
                      <span className="text-secondary-text">— {param.description}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowTryIt(!showTryIt)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background hover:bg-accent/90 transition-colors"
              >
                <Play className="h-3 w-3" />
                {showTryIt ? 'Hide' : 'Try it'}
              </button>
              <span className="text-xs text-secondary-text">
                Requests go to{' '}
                <code className="text-accent">{environment.origin || 'this origin'}</code>
              </span>
            </div>

            {showTryIt && (
              <div className="mt-4 space-y-3">
                {environment.id === 'production' && WRITE_METHODS.has(method) && (
                  <div
                    role="alert"
                    className="rounded-lg border border-status-unknown/40 bg-bg-sunken p-3 text-xs text-status-unknown"
                  >
                    <strong>This is a live {method.toUpperCase()} against production.</strong> It is
                    not a dry run — the effects are real. Switch the environment above to send it
                    against this deployment instead.
                  </div>
                )}

                {pathParamNames.length > 0 && (
                  <div className="space-y-2">
                    {pathParamNames.map((name) => (
                      <div key={name}>
                        <label
                          htmlFor={`${method}-${path}-${name}`}
                          className="mb-1 block text-xs font-medium text-secondary-text"
                        >
                          Path parameter: <code>{name}</code>
                        </label>
                        <input
                          id={`${method}-${path}-${name}`}
                          value={pathParams[name] ?? ''}
                          onChange={(e) =>
                            setPathParams((prev) => ({ ...prev, [name]: e.target.value }))
                          }
                          className="w-full rounded-lg border border-control-border bg-background px-3 py-1.5 font-mono text-xs text-primary-text"
                          placeholder={name}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`${method}-${path}-api-version`}
                      className="mb-1 block text-xs font-medium text-secondary-text"
                    >
                      <code>API-Version</code> <span className="font-normal">(optional)</span>
                    </label>
                    <input
                      id={`${method}-${path}-api-version`}
                      value={apiVersion}
                      onChange={(e) => setApiVersion(e.target.value)}
                      className="w-full rounded-lg border border-control-border bg-background px-3 py-1.5 font-mono text-xs text-primary-text"
                      placeholder="unset — server picks latest"
                    />
                  </div>
                  {hasBody && (
                    <div>
                      <label
                        htmlFor={`${method}-${path}-idempotency`}
                        className="mb-1 block text-xs font-medium text-secondary-text"
                      >
                        <code>Idempotency-Key</code> <span className="font-normal">(optional)</span>
                      </label>
                      <input
                        id={`${method}-${path}-idempotency`}
                        value={idempotencyKey}
                        onChange={(e) => setIdempotencyKey(e.target.value)}
                        className="w-full rounded-lg border border-control-border bg-background px-3 py-1.5 font-mono text-xs text-primary-text"
                        placeholder="resend the same key to dedupe"
                      />
                    </div>
                  )}
                </div>

                {hasBody && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-secondary-text">
                      Request Body
                    </label>
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs text-primary-text"
                      rows={8}
                    />
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleTryIt}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-background hover:bg-accent/90 disabled:opacity-50 transition-colors"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {loading ? 'Sending…' : 'Send Request'}
                </button>

                {error && (
                  <div className="rounded-lg border border-status-down/40 bg-bg-sunken p-3 text-sm text-status-down /50">
                    {error}
                  </div>
                )}

                {response && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-medium text-secondary-text">Response:</span>
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${
                          response.status < 400
                            ? 'bg-accent-subtle text-status-up  '
                            : 'bg-bg-sunken text-status-down  '
                        }`}
                      >
                        {response.status}
                      </span>
                    </div>
                    <pre className="overflow-x-auto rounded-lg border border-border bg-background p-3 text-xs text-primary-text">
                      <code>{response.data}</code>
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase text-secondary-text">Responses</h4>
            <div className="space-y-1">
              {Object.entries(spec.responses).map(([code, resp]) => (
                <div key={code} className="flex gap-2 text-xs">
                  <span className="font-mono text-accent">{code}</span>
                  <span className="text-secondary-text">{resp.description}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ApiPlayground() {
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Defaults to same-origin, so opening this page on a preview deployment
  // exercises that preview rather than production (#871).
  const [environmentId, setEnvironmentId] = useState<PlaygroundEnvironment['id']>('sandbox');
  const environment = ENVIRONMENTS.find((e) => e.id === environmentId) ?? ENVIRONMENTS[0]!;

  useEffect(() => {
    fetch('/openapi.json')
      .then((r) => r.json())
      .then(setSpec)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (error || !spec) {
    return (
      <div className="rounded-xl border border-status-down/40 bg-bg-sunken p-6 text-status-down /50">
        Failed to load API spec: {error}
      </div>
    );
  }

  // Group endpoints by tag
  const grouped: Record<string, Array<{ method: string; path: string; spec: EndpointSpec }>> = {};
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, endpoint] of Object.entries(methods)) {
      const tag = (endpoint.tags && endpoint.tags[0]) || 'Other';
      if (!grouped[tag]) grouped[tag] = [];
      grouped[tag].push({ method, path, spec: endpoint });
    }
  }

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-border bg-bg-subtle p-4">
        <label
          htmlFor="playground-environment"
          className="mb-1 block text-xs font-semibold uppercase text-secondary-text"
        >
          Environment
        </label>
        <select
          id="playground-environment"
          value={environmentId}
          onChange={(e) => setEnvironmentId(e.target.value as PlaygroundEnvironment['id'])}
          className="w-full rounded-lg border border-control-border bg-background px-3 py-2 text-sm text-primary-text sm:w-auto"
        >
          {ENVIRONMENTS.map((env) => (
            <option key={env.id} value={env.id}>
              {env.label}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-secondary-text">{environment.description}</p>
      </div>

      {Object.entries(grouped).map(([tag, endpoints]) => (
        <section key={tag}>
          <h2 className="mb-4 text-xl font-semibold text-primary-text">{tag}</h2>
          <div className="space-y-2">
            {endpoints.map(({ method, path, spec: endpoint }) => (
              <EndpointCard
                key={`${method}-${path}`}
                method={method}
                path={path}
                spec={endpoint}
                environment={environment}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
