import { builder } from "../builder.js";

builder.prismaObject("Post", {
  fields: (t) => ({
    id: t.exposeID("id"),
    title: t.exposeString("title"),
    content: t.exposeString("content"),
    published: t.exposeBoolean("published"),
    author: t.relation("author"),
    comments: t.relation("comments"),
    createdAt: t.field({
      type: "String",
      resolve: (post) => post.createdAt.toISOString(),
    }),
  }),
});
