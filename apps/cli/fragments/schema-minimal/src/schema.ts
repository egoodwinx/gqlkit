import { builder } from "./builder.js";

// Placeholder so Query has at least one field, since GraphQL requires it to be
// non-empty. Delete this once you add your first real query (see docs/recipes).
builder.queryField("_placeholder", (t) => t.boolean({ resolve: () => true }));

builder.queryType({});

export const schema = builder.toSchema();
