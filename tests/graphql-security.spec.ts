import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSchema, parse, validate } from 'graphql';
import { typeDefs } from '@/lib/graphql/typeDefs';
import { graphqlValidationRules, maxDepthRule, maxFieldCountRule } from '@/lib/graphql/security';

// The schema is built with `buildSchema(typeDefs)` so that `validate` uses the
// same graphql instance.
const schema = buildSchema(typeDefs);

describe('graphql depth limit', () => {
  it('accepts a query within the depth budget', () => {
    const doc = parse(`{ anchors { id name corridors } }`);
    expect(validate(schema, doc, [maxDepthRule(10)])).toHaveLength(0);
  });

  it('rejects a query nested past the limit', () => {
    // rates -> rates -> ... a real 3-level query, rejected at depth 2.
    const doc = parse(`{ rates(corridor: "usdc-ngn") { rates { anchorId } } }`);
    const errors = validate(schema, doc, [maxDepthRule(2)]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toMatch(/maximum depth/);
  });
});

describe('graphql field-count limit', () => {
  it('rejects a query selecting more fields than allowed', () => {
    const doc = parse(`{ anchors { id name homeDomain corridors assetCode } }`);
    const errors = validate(schema, doc, [maxFieldCountRule(3)]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toMatch(/maximum of 3 selected fields/);
  });
});

describe('graphql introspection rule', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('blocks __schema introspection in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const doc = parse(`{ __schema { types { name } } }`);
    const errors = validate(schema, doc, graphqlValidationRules());
    expect(errors.length).toBeGreaterThan(0);
  });

  it('allows __schema introspection in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const doc = parse(`{ __schema { types { name } } }`);
    const errors = validate(schema, doc, graphqlValidationRules());
    expect(errors).toHaveLength(0);
  });
});
