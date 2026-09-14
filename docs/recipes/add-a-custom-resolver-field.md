# Add a custom resolver field

**Problem:** you want a field on an existing type that isn't a raw column — computed from other fields, not something Prisma stores directly.

## Diff

`packages/schema/src/types/post.ts` — add an `excerpt` field to `Post`, derived from `content`:

```diff
     title: t.exposeString("title"),
     content: t.exposeString("content"),
     published: t.exposeBoolean("published"),
+    excerpt: t.field({
+      type: "String",
+      resolve: (post) => (post.content.length > 140 ? `${post.content.slice(0, 140)}…` : post.content),
+    }),
     author: t.relation("author"),
     comments: t.relation("comments"),
```

`t.exposeString`/`t.exposeBoolean`/etc. read a column straight off the Prisma row. `t.field` is the general form — you supply `type` and a `resolve` function that computes the value from whatever fields already got selected onto `post` (Pothos's Prisma plugin includes every scalar column by default, so `post.content` is already there with no extra query). This is the exact pattern `Post.createdAt` already uses a few lines down, and the one `searchPosts` uses at the query level — there's no separate "custom resolver" API to learn.

## Then

```bash
pnpm --filter @gqlkit/schema build   # regenerates dist/schema.graphql with the new field
pnpm --filter @gqlkit/schema test    # fails: SDL snapshot is now stale
cp packages/schema/dist/schema.graphql packages/schema/schema.snapshot.graphql
pnpm --filter @gqlkit/schema test    # passes
```

That snapshot failure is intentional — it's the "fails CI if someone breaks the schema shape unintentionally" test from Phase 1 doing its job. Update it whenever a schema change is deliberate.

## Why this doesn't require touching anything else

- **`packages/server`**: doesn't know or care that `Post` grew a field — it just re-exports whatever schema `packages/schema` builds.
- **`packages/client`**: `pnpm build` re-runs `genql` codegen against the new SDL, so `excerpt` shows up as a selectable field in `apps/web` (or any other consumer) automatically. No manual client type to update.

Verified: added the field above, ran `pnpm build`, confirmed `excerpt` appears in the server's live introspection (`{ __type(name: "Post") { fields { name } } }`) and in the regenerated client types.
