# Outgrow generated CRUD for one type

**A framing note first:** this starter doesn't auto-generate CRUD resolvers — there's no plugin scanning your Prisma models and emitting `Query.posts`/`Query.users` for you. Every query and mutation is hand-written from day one (`searchPosts`, `createPost`). That's a deliberate choice, not an oversight: it means there's no separate "eject" step for this recipe, because you never adopted a generator to eject from in the first place.

What this recipe actually shows: if you _do_ add the formulaic, boilerplate version of a per-type query — because most of your types start out needing exactly "list everything," and writing that by hand for each model is common — outgrowing one of them later is a one-field change, not a structural one.

## Step 1 — add the boilerplate

`packages/schema/src/resolvers/queries.ts`:

```typescript
builder.queryField("posts", (t) =>
  t.prismaField({
    type: ["Post"],
    resolve: (query, _root, _args, ctx) => ctx.prisma.post.findMany({ ...query }),
  }),
);

builder.queryField("users", (t) =>
  t.prismaField({
    type: ["User"],
    resolve: (query, _root, _args, ctx) => ctx.prisma.user.findMany({ ...query }),
  }),
);
```

Both are the same three lines: no filtering, no args, just "every row." This is what a CRUD generator would produce, and it's genuinely fine to start here for a type you haven't built real requirements for yet.

## Step 2 — outgrow one of them

Drafts started leaking into a public "all posts" listing. `posts` needs a rule; `users` doesn't.

```diff
 builder.queryField("posts", (t) =>
   t.prismaField({
     type: ["Post"],
-    resolve: (query, _root, _args, ctx) => ctx.prisma.post.findMany({ ...query }),
+    resolve: (query, _root, _args, ctx) =>
+      ctx.prisma.post.findMany({ ...query, where: { published: true } }),
   }),
 );
```

`users` is untouched, still the three-liner from Step 1.

## Verify

```bash
pnpm --filter @gqlkit/schema build
```

The SDL is byte-identical before and after Step 2 — `posts: [Post!]!` was already the signature, and it still is. Confirmed by diffing `dist/schema.graphql`'s `Query` block across both versions. The change is entirely inside the resolver body; nothing about the field's shape moved.

## Why this doesn't require touching anything else

- **No SDL change** → `packages/client`'s generated types don't change, `apps/web` doesn't need updating, the schema snapshot test doesn't need updating.
- **`users` stays exactly as generated** — nothing about "outgrowing" `posts` forces a decision about every other field. Every `t.prismaField` in this codebase is independent; there's no shared CRUD layer to fork out of.
- Compare this to Recipe 1 (custom resolver field), which changes `Post`'s shape and _does_ need a snapshot/client update — the difference is whether the field's arguments/return type change, not whether the resolver body does.
