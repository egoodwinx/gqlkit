# Add authentication

**Problem:** `Mutation.createPost` (and anything else you build) should only run for a logged-in user. Phase 1 wires `ScopeAuthPlugin` but leaves it a no-op — `authScopes` always returns `{ public: true }`, and nothing checks anything.

This repo already has the seam for this: `Context.currentUserId` exists from Phase 1 but is hard-coded to `null` by the server. This recipe fills it in.

## Diff

`packages/schema/src/builder.ts` — add a `loggedIn` scope, computed from context:

```diff
 export interface AuthScopes {
   public: boolean;
+  loggedIn: boolean;
 }
 ...
   scopeAuth: {
-    // No-op default: nothing is gated behind a scope yet (see docs/recipes "Add authentication")
-    authScopes: () => ({
+    authScopes: (ctx) => ({
       public: true,
+      loggedIn: ctx.currentUserId !== null,
     }),
   },
```

`packages/schema/src/resolvers/mutations.ts` — gate `createPost` behind it:

```diff
   t.prismaField({
     type: "Post",
+    authScopes: {
+      loggedIn: true,
+    },
     args: {
```

`packages/server/src/context.ts` — populate `currentUserId` from the request instead of hard-coding `null`:

```diff
-export function createContext(): Context {
+export function createContext({ request }: YogaInitialContext): Context {
+  // Stand-in for real session/JWT verification — swap this line for
+  // whatever your auth provider gives you (a verified session cookie, a
+  // decoded JWT's `sub` claim, etc).
+  const currentUserId = request.headers.get("x-user-id");
+
   return {
-    currentUserId: null,
+    currentUserId,
     prisma,
   };
 }
```

(also add `import type { YogaInitialContext } from "graphql-yoga";` at the top)

That header read is deliberately fake — it's there so this recipe is actually testable end to end without pulling in a specific auth provider. Real usage is the same three files: verify a session/JWT somewhere in `createContext`, set `currentUserId` from it, and everything downstream — `authScopes`, every `authScopes: { loggedIn: true }` field — already works.

`packages/server/src/context.test.ts` — Phase 2's test calls `createContext()` with no arguments, which stops compiling once `createContext` requires a `YogaInitialContext`. Give it one (cast, since a real `YogaInitialContext` carries more than this test needs):

```diff
+import type { YogaInitialContext } from "graphql-yoga";
 import { createContext } from "./context.js";

+function fakeInitialContext(headers: Record<string, string> = {}): YogaInitialContext {
+  return { request: new Request("http://localhost", { headers }) } as YogaInitialContext;
+}
+
 test("createContext returns a fresh object identity on every call", () => {
-  assert.notEqual(createContext(), createContext());
+  assert.notEqual(createContext(fakeInitialContext()), createContext(fakeInitialContext()));
 });

 test("createContext defaults currentUserId to null", () => {
-  assert.equal(createContext().currentUserId, null);
+  assert.equal(createContext(fakeInitialContext()).currentUserId, null);
 });
```

## Verify

```bash
# no auth → rejected before the resolver runs
curl -s localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"mutation { createPost(input: {title:\"x\",content:\"y\",authorId:\"z\"}) { id } }"}'
# {"errors":[{"message":"Not authorized to resolve Mutation.createPost", ...}],"data":null}

# "authenticated" → passes the scope check, gets as far as the (unset) database
curl -s localhost:4000/graphql -H 'content-type: application/json' -H 'x-user-id: u1' \
  -d '{"query":"mutation { createPost(input: {title:\"x\",content:\"y\",authorId:\"z\"}) { id } }"}'
# {"errors":[{"message":"Unexpected error.", "extensions":{"code":"INTERNAL_SERVER_ERROR"}}], ...}
```

The second request's error is the database being unreachable in this environment, not an auth failure — the scope check passed and the resolver actually ran, which is the thing to confirm. Unrelated fields (`{ __typename }`, `searchPosts`) are untouched — they don't declare `authScopes`, so `public: true` (still always granted) is all that applies to them.

## Why this doesn't require touching anything else

- No SDL change — `authScopes` is a Pothos-level authorization check, not part of the GraphQL type signature. `createPost`'s arguments and return type are identical before and after, so `packages/schema/schema.snapshot.graphql` doesn't need updating and `packages/client`'s generated types don't change.
- `packages/client` and `apps/web` are unaffected — from their side, an unauthorized call just comes back as a GraphQL error, same shape as any other.
