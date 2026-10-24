import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSchema, parse, validate } from 'graphql';
import { typeDefs } from '@/lib/graphql/typeDefs';
import {
  graphqlValidationRules,
  maxDepthRule,
  maxFieldCountRule,
  maxRootFieldsRule,
} from '@/lib/graphql/security';

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

describe('graphql standard validation rules', () => {
  const errorsFor = (query: string) => validate(schema, parse(query), graphqlValidationRules());

  it.each([
    ['an unknown root field', '{ bogusField }'],
    ['an unknown nested field', '{ anchors { nope } }'],
    ['an unknown argument', '{ anchors(bogus: 1) { id } }'],
    [
      'a fragment cycle',
      'fragment A on Anchor { ...B } fragment B on Anchor { ...A } { anchors { ...A } }',
    ],
  ])('rejects %s', (_label, query) => {
    expect(errorsFor(query).length).toBeGreaterThan(0);
  });

  it('accepts a valid query', () => {
    expect(errorsFor('{ anchors { id name } }')).toHaveLength(0);
  });
});

describe('graphql limits follow fragment spreads', () => {
  const rules = (...r: ReturnType<typeof maxFieldCountRule>[]) => r;

  it('counts a fragment spread 600 times against the field cap', () => {
    const spreads = Array.from({ length: 600 }, (_, i) => `a${i}: anchors { ...F }`).join(' ');
    const doc = parse(`fragment F on Anchor { id } { ${spreads} }`);
    const errors = validate(schema, doc, rules(maxFieldCountRule(500)));
    expect(errors.some((e) => /maximum of 500 selected fields/.test(e.message))).toBe(true);
  });

  it('measures depth through fragments', () => {
    // Three levels of fields, the lower two hidden behind named fragments.
    const doc = parse(`
      query { rates(corridor: "usdc-ngn") { ...A } }
      fragment A on RateComparison { rates { ...B } }
      fragment B on AnchorRate { anchorId }
    `);
    const errors = validate(schema, doc, [maxDepthRule(2)]);
    expect(errors.some((e) => /maximum depth of 2/.test(e.message))).toBe(true);
    expect(validate(schema, doc, [maxDepthRule(3)])).toHaveLength(0);
  });

  it('treats inline fragments as the same level', () => {
    const doc = parse(`{ anchors { ... on Anchor { id } } }`);
    expect(validate(schema, doc, [maxDepthRule(2)])).toHaveLength(0);
    expect(validate(schema, doc, [maxDepthRule(1)]).length).toBeGreaterThan(0);
  });

  it('lets a normal fragment query through the real rules', () => {
    const doc = parse(`fragment F on Anchor { id name } { anchors { ...F } }`);
    expect(validate(schema, doc, graphqlValidationRules())).toHaveLength(0);
  });

  it('terminates on a cyclic fragment', () => {
    const doc = parse(
      'fragment A on Anchor { ...B } fragment B on Anchor { ...A } { anchors { ...A } }'
    );
    const started = Date.now();
    validate(schema, doc, [maxDepthRule(10), maxFieldCountRule(500)]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('does not blow up on a fragment fan-out that doubles at every level', () => {
    const levels = 30;
    const defs = Array.from(
      { length: levels },
      (_, i) => `fragment F${i} on Anchor { ...F${i + 1} ...F${i + 1} }`
    ).join(' ');
    const doc = parse(`${defs} fragment F${levels} on Anchor { id } { anchors { ...F0 } }`);
    const started = Date.now();
    validate(schema, doc, [maxDepthRule(10), maxFieldCountRule(500)]);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('graphql root-field cap', () => {
  const aliases = (n: number) => Array.from({ length: n }, (_, i) => `a${i}: anchors { id }`);
  const errorsFor = (query: string) => validate(schema, parse(query), [maxRootFieldsRule(10)]);

  it('accepts 10 aliased root fields', () => {
    expect(errorsFor(`{ ${aliases(10).join(' ')} }`)).toHaveLength(0);
  });

  it('rejects 11 aliased root fields', () => {
    const errors = errorsFor(`{ ${aliases(11).join(' ')} }`);
    expect(errors[0]?.message).toBe('Operation selects more than 10 root fields.');
  });

  it('rejects 11 root fields hidden in a top-level fragment spread', () => {
    const errors = errorsFor(`fragment R on Query { ${aliases(11).join(' ')} } { ...R }`);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('is part of the rules applied to every operation', () => {
    const doc = parse(`{ ${aliases(11).join(' ')} }`);
    expect(validate(schema, doc, graphqlValidationRules()).length).toBeGreaterThan(0);
  });

  it('does not count nested fields as root fields', () => {
    expect(
      errorsFor('{ anchors { id name homeDomain corridors assetCode seps degraded } }')
    ).toHaveLength(0);
  });
});
