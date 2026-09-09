import {
  GraphQLError,
  NoSchemaIntrospectionCustomRule,
  type ASTVisitor,
  type ValidationContext,
} from 'graphql';

// Query-safety bounds for the additive GraphQL surface. The schema is shallow
// (deepest real query is rates -> rates -> AnchorRate fields, ~3), so these are
// generous headroom that only ever trip on pathological queries — deep nesting
// or alias amplification aimed at forcing unbounded server work.
const MAX_DEPTH = 10;
const MAX_FIELDS = 500;

/**
 * Reject queries whose selection-set nesting exceeds `maxDepth`. Depth is the
 * number of SelectionSet ancestors above a field.
 */
export function maxDepthRule(maxDepth: number) {
  return (context: ValidationContext): ASTVisitor => ({
    Field(node, _key, _parent, _path, ancestors) {
      let depth = 0;
      for (const ancestor of ancestors) {
        // `ancestor` is an ASTNode or a readonly ASTNode[]; only the former has a
        // `kind`. Arrays read `undefined` here, so they never match.
        if ((ancestor as { kind?: string }).kind === 'SelectionSet') depth += 1;
      }
      if (depth > maxDepth) {
        context.reportError(
          new GraphQLError(`Query exceeds the maximum depth of ${maxDepth}.`, { nodes: [node] })
        );
      }
    },
  });
}

/**
 * Reject queries selecting more than `maxFields` fields in total (aliases
 * included), bounding alias-amplification cost within the depth budget.
 */
export function maxFieldCountRule(maxFields: number) {
  return (context: ValidationContext): ASTVisitor => {
    let count = 0;
    return {
      Field() {
        count += 1;
        if (count === maxFields + 1) {
          context.reportError(
            new GraphQLError(`Query exceeds the maximum of ${maxFields} selected fields.`)
          );
        }
      },
    };
  };
}

/**
 * The validation rules applied to every incoming operation: depth and
 * field-count bounds always, plus introspection disabled in production, where
 * it is a dev/staging convenience rather than something an unauthenticated
 * caller should be able to enumerate the schema with.
 *
 * Returned as plain `graphql` validation rules and handed to `validate()` by
 * the route. This used to be a graphql-yoga plugin; yoga is no longer in the
 * serverless path (see app/api/graphql/route.ts), and these rules never needed
 * it — they are ordinary `ValidationRule`s.
 */
export function graphqlValidationRules(): Array<(context: ValidationContext) => ASTVisitor> {
  const rules: Array<(context: ValidationContext) => ASTVisitor> = [
    maxDepthRule(MAX_DEPTH),
    maxFieldCountRule(MAX_FIELDS),
  ];
  if (process.env.NODE_ENV === 'production') {
    rules.push(NoSchemaIntrospectionCustomRule as (context: ValidationContext) => ASTVisitor);
  }
  return rules;
}
