import { builder } from "../builder.js";

// A hand-written query, not generated CRUD.
builder.queryField("searchPosts", (t) =>
  t.prismaField({
    type: ["Post"],
    args: {
      query: t.arg.string(),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.prisma.post.findMany({
        ...query,
        where: {
          published: true,
          title: { contains: args.query, mode: "insensitive" },
        },
        orderBy: { createdAt: "desc" },
      }),
  }),
);
