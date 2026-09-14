# Add real-time subscriptions

**Problem:** you want clients to receive `Post`s as they're created, not just poll `searchPosts`.

No extra Pothos plugin needed — `builder.subscriptionField()` is core. Graphql Yoga serves subscriptions over SSE automatically once the schema has a `Subscription` type, with no server config. The only new piece is a pub/sub instance to bridge "a mutation happened" to "a subscriber is listening."

```bash
pnpm --filter @gqlkit/schema add @graphql-yoga/subscription
```

## Diff

New file, `packages/schema/src/pubsub.ts` — a typed pub/sub singleton, same "shared instance, not per-request" pattern as `db.ts`'s `prisma` export:

```typescript
import { createPubSub } from "@graphql-yoga/subscription";
import type { Post } from "../generated/prisma/client.js";

export type PubSubEvents = {
  postCreated: [Post];
};

export const pubsub = createPubSub<PubSubEvents>();
export type PubSub = typeof pubsub;
```

`packages/schema/src/context.ts` — add it to `Context`, same way `prisma` is already there:

```diff
 import type { PrismaClient } from "../generated/prisma/client.js";
+import type { PubSub } from "./pubsub.js";

 export interface Context {
   currentUserId: string | null;
   prisma: PrismaClient;
+  pubsub: PubSub;
 }
```

`packages/schema/src/index.ts` — export it, same as `prisma`:

```diff
 export { builder } from "./builder.js";
 export type { Context } from "./context.js";
 export { prisma } from "./db.js";
+export { pubsub } from "./pubsub.js";
 export { schema } from "./schema.js";
```

`packages/schema/src/types/post.ts` — export the object ref (see the gotcha below for why):

```diff
-builder.prismaObject("Post", {
+export const PostRef = builder.prismaObject("Post", {
```

New file, `packages/schema/src/resolvers/subscriptions.ts`:

```typescript
import { builder } from "../builder.js";
import { PostRef } from "../types/post.js";

builder.subscriptionType({});

builder.subscriptionField("postCreated", (t) =>
  t.field({
    type: PostRef,
    subscribe: (_root, _args, ctx) => ctx.pubsub.subscribe("postCreated"),
    resolve: (post) => post,
  }),
);
```

`packages/schema/src/schema.ts` — register the file (side-effect import, same as every other type/resolver file):

```diff
 import "./resolvers/queries.js";
 import "./resolvers/mutations.js";
+import "./resolvers/subscriptions.js";
```

`packages/schema/src/resolvers/mutations.ts` — publish after a successful create:

```diff
-    resolve: (query, _root, args, ctx) =>
-      ctx.prisma.post.create({
+    resolve: async (query, _root, args, ctx) => {
+      const post = await ctx.prisma.post.create({
         ...query,
         data: {
           title: args.input.title,
           content: args.input.content,
           author: { connect: { id: args.input.authorId } },
         },
-      }),
+      });
+      ctx.pubsub.publish("postCreated", post);
+      return post;
+    },
```

`packages/server/src/context.ts` — thread the same shared instance through, same as `prisma`:

```diff
-import { prisma } from "@gqlkit/schema";
+import { prisma, pubsub } from "@gqlkit/schema";
 ...
   return {
     currentUserId: null,
     prisma,
+    pubsub,
   };
```

## The gotcha: reference the object ref, not the type-name string

Every other field in this codebase writes `type: "Post"` (a string) — Pothos resolves it against the schema's registered type map, and it works fine for `t.prismaField`, `t.relation`, etc. **In a subscription field it doesn't**: `t.field({ type: "Post", subscribe: ..., resolve: ... })` fails to compile — TypeScript can't unify the string-based type lookup with the `subscribe`/`resolve` pair's generics for `Kind: 'Subscription'` specifically (confirmed: the same field compiles fine with a scalar `type: "Int"`, and fails only once `type` names an object type registered via `builder.prismaObject`). Exporting the `ObjectRef` that `builder.prismaObject("Post", ...)` returns and passing that ref directly as `type` sidesteps the inference entirely. Cheap enough to do by default if you know you'll want it, but only actually required where you hit this.

## Verify

```bash
pnpm build   # schema.graphql now has `type Subscription { postCreated: Post! }`
```

```bash
# open a subscription (SSE)
curl -N localhost:4000/graphql -H 'content-type: application/json' -H 'accept: text/event-stream' \
  -d '{"query":"subscription { postCreated { id title } }"}' &

# in another terminal, create a post
curl localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"mutation { createPost(input: {title:\"hi\",content:\"...\",authorId:\"...\"}) { id } }"}'
```

The first terminal prints an SSE frame the instant the mutation runs:

```
event: next
data: {"data":{"postCreated":{"id":"...","title":"hi"}}}
```

Verified with a temporary debug mutation that called `ctx.pubsub.publish` directly (no database in this environment) — confirmed the SSE frame arrives correctly shaped and immediately on publish; the real `createPost` path publishes the exact same way, just from real data instead of a hand-built object.

## Why this doesn't require touching anything else

- `packages/client`'s `genql` codegen picks up the new `Subscription` root type automatically on the next `pnpm build`, same as any other schema change — `client.subscription({ postCreated: { ... } })` becomes available with no manual step.
