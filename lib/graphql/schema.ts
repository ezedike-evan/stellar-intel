import { createSchema } from 'graphql-yoga';
import { typeDefs } from './typeDefs';
import { resolvers } from './resolvers';

export const schema = createSchema({ typeDefs, resolvers });
