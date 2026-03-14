import { createApi } from '@convex-dev/better-auth';
import { getOptions } from './options';
import schema from './schema';

export const { create, findOne, findMany, updateOne, updateMany, deleteOne, deleteMany } =
  createApi(schema, getOptions);
