/**
 * lib/api/api-reference-generator.ts
 *
 * Deterministic Markdown generator for the API Reference documentation (#1078).
 * Reads the OpenAPI specification (public/openapi.json) and formats it into a
 * structured Markdown document covering tags, paths, methods, parameters,
 * request bodies, and responses.
 */

export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  description?: string;
  required?: boolean;
  schema?: {
    type?: string;
    pattern?: string;
    example?: unknown;
    default?: unknown;
    enum?: unknown[];
    items?: { type?: string };
    [key: string]: unknown;
  };
  example?: unknown;
}

export interface OpenApiRequestBody {
  description?: string;
  required?: boolean;
  content?: Record<
    string,
    {
      schema?: Record<string, unknown>;
      example?: unknown;
      examples?: Record<string, { value?: unknown }>;
    }
  >;
}

export interface OpenApiResponse {
  description?: string;
  content?: Record<
    string,
    {
      schema?: Record<string, unknown>;
      example?: unknown;
    }
  >;
}

export interface OpenApiOperation {
  summary?: string;
  description?: string;
  tags?: string[];
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
}

export interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    schemas?: Record<string, unknown>;
  };
}

function resolveSchemaTypeName(schema?: Record<string, unknown>): string {
  if (!schema) return 'any';
  if (schema.$ref && typeof schema.$ref === 'string') {
    return schema.$ref.split('/').pop() || 'object';
  }
  if (schema.type === 'array' && schema.items) {
    return `${resolveSchemaTypeName(schema.items as Record<string, unknown>)}[]`;
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((e) => JSON.stringify(e)).join(' | ');
  }
  if (typeof schema.type === 'string') {
    return schema.type;
  }
  return 'object';
}

function formatSchemaProperties(
  schema: Record<string, unknown>,
  schemas: Record<string, unknown> = {}
): Array<{ name: string; type: string; required: boolean; description: string }> {
  let target = schema;
  if (schema.$ref && typeof schema.$ref === 'string') {
    const refName = schema.$ref.split('/').pop();
    if (refName && schemas[refName]) {
      target = schemas[refName] as Record<string, unknown>;
    }
  }

  const properties = (target.properties || {}) as Record<string, Record<string, unknown>>;
  const requiredList = Array.isArray(target.required) ? (target.required as string[]) : [];

  return Object.entries(properties).map(([name, prop]) => {
    let typeName = resolveSchemaTypeName(prop);
    if (prop.$ref && typeof prop.$ref === 'string') {
      typeName = prop.$ref.split('/').pop() || 'object';
    }
    const description = (prop.description as string) || '';
    return {
      name,
      type: typeName,
      required: requiredList.includes(name),
      description,
    };
  });
}

export function generateApiReferenceMarkdown(spec: OpenApiSpec): string {
  const schemas = spec.components?.schemas || {};
  const lines: string[] = [];

  lines.push('# API Reference');
  lines.push('');
  lines.push(`**Specification Version:** \`${spec.info.version}\`  `);
  lines.push(`**OpenAPI:** \`${spec.openapi}\``);
  lines.push('');

  if (spec.info.description) {
    lines.push(spec.info.description.trim());
    lines.push('');
  }

  if (spec.servers && spec.servers.length > 0) {
    lines.push('## Servers');
    lines.push('');
    for (const server of spec.servers) {
      lines.push(`- \`${server.url}\`${server.description ? ` — ${server.description}` : ''}`);
    }
    lines.push('');
  }

  // Group operations by tag
  const grouped: Record<string, Array<{ method: string; path: string; op: OpenApiOperation }>> = {};

  const sortedPaths = Object.keys(spec.paths).sort();
  const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

  for (const path of sortedPaths) {
    const pathItem = spec.paths[path] || {};
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op) continue;
      const tag = (op.tags && op.tags[0]) || 'General';
      if (!grouped[tag]) grouped[tag] = [];
      grouped[tag].push({ method: method.toUpperCase(), path, op });
    }
  }

  const sortedTags = Object.keys(grouped).sort();

  // Table of contents
  lines.push('## Table of Contents');
  lines.push('');
  for (const tag of sortedTags) {
    lines.push(`- **${tag}**`);
    for (const { method, path } of grouped[tag] ?? []) {
      const anchor = `${method.toLowerCase()}-${path
        .toLowerCase()
        .replace(/[^a-z0-9/_-]/g, '')
        .replace(/\//g, '')
        .replace(/_/g, '-')}`;
      lines.push(`  - [\`${method} ${path}\`](#${anchor})`);
    }
  }
  lines.push('');

  // Operations detailed documentation
  for (const tag of sortedTags) {
    lines.push(`## ${tag}`);
    lines.push('');

    for (const { method, path, op } of grouped[tag] ?? []) {
      lines.push(`### \`${method} ${path}\``);
      lines.push('');

      if (op.summary) {
        lines.push(`**Summary:** ${op.summary}  `);
      }
      if (op.operationId) {
        lines.push(`**Operation ID:** \`${op.operationId}\`  `);
      }
      if (op.summary || op.operationId) {
        lines.push('');
      }

      if (op.description) {
        lines.push(op.description.trim());
        lines.push('');
      }

      // Parameters
      if (op.parameters && op.parameters.length > 0) {
        lines.push('#### Parameters');
        lines.push('');
        lines.push('| Name | In | Type | Required | Description |');
        lines.push('| :--- | :--- | :--- | :--- | :--- |');
        for (const param of op.parameters) {
          const typeName = param.schema ? resolveSchemaTypeName(param.schema) : 'string';
          const req = param.required ? '**Yes**' : 'No';
          const desc = param.description ? param.description.replace(/\|/g, '\\|') : '-';
          lines.push(
            `| \`${param.name}\` | \`${param.in}\` | \`${typeName}\` | ${req} | ${desc} |`
          );
        }
        lines.push('');
      }

      // Request Body
      if (op.requestBody && op.requestBody.content) {
        lines.push('#### Request Body');
        lines.push('');
        if (op.requestBody.description) {
          lines.push(op.requestBody.description.trim());
          lines.push('');
        }

        for (const [contentType, mediaType] of Object.entries(op.requestBody.content)) {
          lines.push(`**Content-Type:** \`${contentType}\``);
          lines.push('');

          if (mediaType.schema) {
            const props = formatSchemaProperties(mediaType.schema, schemas);
            if (props.length > 0) {
              lines.push('| Field | Type | Required | Description |');
              lines.push('| :--- | :--- | :--- | :--- |');
              for (const prop of props) {
                const req = prop.required ? '**Yes**' : 'No';
                const desc = prop.description ? prop.description.replace(/\|/g, '\\|') : '-';
                lines.push(`| \`${prop.name}\` | \`${prop.type}\` | ${req} | ${desc} |`);
              }
              lines.push('');
            }
          }
        }
      }

      // Responses
      if (op.responses) {
        lines.push('#### Responses');
        lines.push('');
        lines.push('| Status | Description | Content-Type | Schema |');
        lines.push('| :--- | :--- | :--- | :--- |');
        for (const [code, resp] of Object.entries(op.responses)) {
          const desc = resp.description ? resp.description.replace(/\|/g, '\\|') : '-';
          if (resp.content && Object.keys(resp.content).length > 0) {
            for (const [cType, mType] of Object.entries(resp.content)) {
              const schemaName = mType.schema ? resolveSchemaTypeName(mType.schema) : '-';
              lines.push(`| \`${code}\` | ${desc} | \`${cType}\` | \`${schemaName}\` |`);
            }
          } else {
            lines.push(`| \`${code}\` | ${desc} | - | - |`);
          }
        }
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n');
}
