import { builder } from "./builder.js";
import "./types/role.js";
import "./types/user.js";
import "./types/post.js";
import "./types/comment.js";
import "./resolvers/queries.js";
import "./resolvers/mutations.js";

builder.queryType({});
builder.mutationType({});

export const schema = builder.toSchema();
