import { describe, expect, it } from 'vitest';
import { buildSchema, parse, validate, NoSchemaIntrospectionCustomRule } from 'graphql';
import { typeDefs } from '@/lib/graphql/typeDefs';
import { maxDepthRule, maxFieldCountRule } from '@/lib/graphql/security';

// Build the schema from the SDL with the same `graphql` instance `validate`
// comes from — the yoga-built schema in lib/graphql/schema.ts is created with
// yoga's bundled graphql and cannot be validated across module realms.
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
  it('blocks __schema introspection when the rule is active', () => {
    const doc = parse(`{ __schema { types { name } } }`);
    const errors = validate(schema, doc, [NoSchemaIntrospectionCustomRule]);
    expect(errors.length).toBeGreaterThan(0);
  });
});
