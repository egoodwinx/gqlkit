import { builder } from "../builder.js";

builder.prismaObject("Comment", {
  fields: (t) => ({
    id: t.exposeID("id"),
    content: t.exposeString("content"),
    post: t.relation("post"),
    author: t.relation("author"),
    createdAt: t.field({
      type: "String",
      resolve: (comment) => comment.createdAt.toISOString(),
    }),
  }),
});
