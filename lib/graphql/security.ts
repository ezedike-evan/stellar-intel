import {
  GraphQLError,
  NoSchemaIntrospectionCustomRule,
  type ASTVisitor,
  type ValidationContext,
} from 'graphql';
import type { Plugin } from 'graphql-yoga';

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
 * Yoga plugin installing the query-safety rules and, in production, disabling
 * schema introspection (a dev/staging convenience that should not let an
 * unauthenticated caller enumerate the schema).
 */
export function createGraphqlSecurityPlugin(): Plugin {
  const disableIntrospection = process.env.NODE_ENV === 'production';
  return {
    onValidate({ addValidationRule }) {
      addValidationRule(maxDepthRule(MAX_DEPTH));
      addValidationRule(maxFieldCountRule(MAX_FIELDS));
      if (disableIntrospection) addValidationRule(NoSchemaIntrospectionCustomRule);
    },
  };
}
