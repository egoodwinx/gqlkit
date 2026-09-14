import { z } from "zod";
import { builder } from "../builder.js";
import { createPostSchema } from "../validation/create-post.js";

const createPostArgsSchema = z.object({ input: createPostSchema });

const CreatePostInput = builder.inputType("CreatePostInput", {
  fields: (t) => ({
    title: t.string(),
    content: t.string(),
    authorId: t.string(),
  }),
});

builder.mutationField("createPost", (t) =>
  t.prismaField({
    type: "Post",
    args: {
      input: t.arg({ type: CreatePostInput }),
    },
    validate: {
      schema: createPostArgsSchema,
    },
    resolve: (query, _root, args, ctx) =>
      ctx.prisma.post.create({
        ...query,
        data: {
          title: args.input.title,
          content: args.input.content,
          author: { connect: { id: args.input.authorId } },
        },
      }),
  }),
);
