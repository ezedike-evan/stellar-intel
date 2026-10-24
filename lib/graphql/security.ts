import {
  GraphQLError,
  Kind,
  NoSchemaIntrospectionCustomRule,
  specifiedRules,
  type ASTVisitor,
  type SelectionSetNode,
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
 * number of field levels from the operation root. Fragment spreads and inline
 * fragments are resolved at the spread site and add no level of their own, so
 * moving selections into a named fragment cannot hide them from the limit.
 */
export function maxDepthRule(maxDepth: number) {
  return (context: ValidationContext): ASTVisitor => {
    // A fragment's depth is the same wherever it is spread, so compute it once.
    const fragmentDepths = new Map<string, number>();

    const selectionDepth = (selectionSet: SelectionSetNode, path: ReadonlySet<string>): number => {
      let deepest = 0;
      for (const selection of selectionSet.selections) {
        if (selection.kind === Kind.FIELD) {
          const inner = selection.selectionSet ? selectionDepth(selection.selectionSet, path) : 0;
          deepest = Math.max(deepest, 1 + inner);
        } else if (selection.kind === Kind.INLINE_FRAGMENT) {
          deepest = Math.max(deepest, selectionDepth(selection.selectionSet, path));
        } else {
          const name = selection.name.value;
          // A cycle is reported by NoFragmentCyclesRule; here it just must not loop.
          if (path.has(name)) continue;
          const known = fragmentDepths.get(name);
          if (known !== undefined) {
            deepest = Math.max(deepest, known);
            continue;
          }
          const fragment = context.getFragment(name);
          if (!fragment) continue;
          const depth = selectionDepth(fragment.selectionSet, new Set(path).add(name));
          // Under a cycle this is a lower bound, which is fine: such a query is
          // rejected by NoFragmentCyclesRule and only has to terminate here.
          fragmentDepths.set(name, depth);
          deepest = Math.max(deepest, depth);
        }
      }
      return deepest;
    };

    return {
      OperationDefinition(node) {
        if (selectionDepth(node.selectionSet, new Set()) > maxDepth) {
          context.reportError(
            new GraphQLError(`Query exceeds the maximum depth of ${maxDepth}.`, { nodes: [node] })
          );
        }
      },
    };
  };
}

/**
 * Reject operations selecting more than `maxFields` fields in total (aliases
 * included), bounding alias-amplification cost within the depth budget. A
 * fragment's fields are counted every time it is spread, because each spread
 * executes them again. The walk stops as soon as the cap is crossed, so a
 * query built to make the count itself expensive cannot slow validation.
 */
export function maxFieldCountRule(maxFields: number) {
  return (context: ValidationContext): ASTVisitor => {
    const walk = (
      selectionSet: SelectionSetNode,
      path: ReadonlySet<string>,
      counter: { count: number }
    ): void => {
      for (const selection of selectionSet.selections) {
        if (counter.count > maxFields) return;
        if (selection.kind === Kind.FIELD) {
          counter.count += 1;
          if (selection.selectionSet) walk(selection.selectionSet, path, counter);
        } else if (selection.kind === Kind.INLINE_FRAGMENT) {
          walk(selection.selectionSet, path, counter);
        } else {
          const name = selection.name.value;
          if (path.has(name)) continue;
          const fragment = context.getFragment(name);
          if (fragment) walk(fragment.selectionSet, new Set(path).add(name), counter);
        }
      }
    };

    return {
      OperationDefinition(node) {
        const counter = { count: 0 };
        walk(node.selectionSet, new Set(), counter);
        if (counter.count > maxFields) {
          context.reportError(
            new GraphQLError(`Query exceeds the maximum of ${maxFields} selected fields.`, {
              nodes: [node],
            })
          );
        }
      },
    };
  };
}

/**
 * The validation rules applied to every incoming operation: graphql-js's
 * standard `specifiedRules` (unknown fields and arguments, fragment cycles,
 * variable types and the rest), then depth and field-count bounds, plus
 * introspection disabled in production, where it is a dev/staging convenience
 * rather than something an unauthenticated caller should be able to enumerate
 * the schema with.
 *
 * `validate()` replaces its default rule set when given one, so the standard
 * rules have to be listed here explicitly.
 *
 * Returned as plain `graphql` validation rules and handed to `validate()` by
 * the route. This used to be a graphql-yoga plugin; yoga is no longer in the
 * serverless path (see app/api/graphql/route.ts), and these rules never needed
 * it — they are ordinary `ValidationRule`s.
 */
export function graphqlValidationRules(): Array<(context: ValidationContext) => ASTVisitor> {
  const rules: Array<(context: ValidationContext) => ASTVisitor> = [
    ...specifiedRules,
    maxDepthRule(MAX_DEPTH),
    maxFieldCountRule(MAX_FIELDS),
  ];
  if (process.env.NODE_ENV === 'production') {
    rules.push(NoSchemaIntrospectionCustomRule as (context: ValidationContext) => ASTVisitor);
  }
  return rules;
}
