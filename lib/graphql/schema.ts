import {
  GraphQLObjectType,
  buildASTSchema,
  parse,
  type GraphQLFieldResolver,
  type GraphQLSchema,
} from 'graphql';
import { typeDefs } from './typeDefs';
import { resolvers } from './resolvers';

/**
 * The executable schema, built with nothing but `graphql` itself.
 *
 * This deliberately avoids both graphql-yoga's `createSchema` and
 * `@graphql-tools/schema`'s `makeExecutableSchema`. Each of those is a second
 * consumer of `graphql`, and `graphql` refuses to work across two copies of
 * itself:
 *
 *   Error: Cannot use GraphQLSchema "..." from another module or realm.
 *   Ensure that there is only one instance of "graphql" in the node_modules
 *   directory.
 *
 * That is not a hypothetical. Swapping yoga for `makeExecutableSchema`
 * reproduced it immediately — the schema came from one copy and `validate()`
 * from another — and it is a strong candidate for what was killing the
 * deployed function, where a realm mismatch surfaces as a dead process rather
 * than a readable error.
 *
 * `buildASTSchema` gives a schema with default field resolvers; the loop below
 * attaches ours. The schema is small and flat (Query, Mutation), so this is the
 * whole of what the helper libraries were doing for us.
 */
function buildSchema(): GraphQLSchema {
  const built = buildASTSchema(parse(typeDefs), { assumeValidSDL: true });

  for (const [typeName, fieldResolvers] of Object.entries(resolvers)) {
    const type = built.getType(typeName);
    if (!(type instanceof GraphQLObjectType)) continue;

    const fields = type.getFields();
    for (const [fieldName, resolver] of Object.entries(fieldResolvers)) {
      const field = fields[fieldName];
      if (field) {
        field.resolve = resolver as GraphQLFieldResolver<unknown, unknown>;
      }
    }
  }

  return built;
}

export const schema = buildSchema();
