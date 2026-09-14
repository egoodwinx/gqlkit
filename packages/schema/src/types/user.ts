import { builder } from "../builder.js";
import { RoleType } from "./role.js";

builder.prismaObject("User", {
  fields: (t) => ({
    id: t.exposeID("id"),
    email: t.exposeString("email"),
    name: t.exposeString("name", { nullable: true }),
    role: t.expose("role", { type: RoleType }),
    posts: t.relation("posts"),
    // Demonstrates the dataloader plugin for a non-relation, computed field:
    // batches one groupBy query for however many users are requested, instead of one count query per user.
    postCount: t.loadable({
      type: "Int",
      load: async (authorIds: string[], ctx) => {
        const counts = await ctx.prisma.post.groupBy({
          by: ["authorId"],
          where: { authorId: { in: authorIds } },
          _count: true,
        });
        const countByAuthorId = new Map(counts.map((c) => [c.authorId, c._count]));
        return authorIds.map((id) => countByAuthorId.get(id) ?? 0);
      },
      resolve: (user) => user.id,
    }),
  }),
});
