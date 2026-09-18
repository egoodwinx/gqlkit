# Eject the client codegen for manual query control

**Problem:** Genql's compile-time safety doesn't actually hold under this repo's strict `tsconfig`. If you need a real guarantee — a renamed field breaks the build, not just a request — this is the swap: `graphql-code-generator` + hand-written `.graphql` documents + `graphql-request`.

The tradeoff is real and goes the other way too: you write queries as GraphQL text instead of TS objects, and each new query needs a `.graphql` file + a codegen run before you can use it. What you get back is a `SearchPostsQuery` type generated from the _exact text_ of `SearchPosts.graphql` — there's no generic selection type for excess-property checks to skip.

```bash
pnpm --filter @gqlkit/client add graphql-request @graphql-typed-document-node/core
pnpm --filter @gqlkit/client add -D @graphql-codegen/cli @graphql-codegen/typescript \
  @graphql-codegen/typescript-operations @graphql-codegen/typed-document-node
pnpm --filter @gqlkit/client remove @genql/cli tsup
```

## Diff

`packages/client/codegen.yml` (new) — replaces the `genql` CLI invocation:

```yaml
schema: ../schema/dist/schema.graphql
documents: "src/operations/**/*.graphql"
generates:
  src/generated/graphql.ts:
    plugins:
      - typescript
      - typescript-operations
      - typed-document-node
    config:
      useTypeImports: true
```

`packages/client/src/operations/search-posts.graphql` (new) — an actual query document, replacing the equivalent Genql selection from `apps/web`:

```graphql
query SearchPosts($query: String!) {
  searchPosts(query: $query) {
    id
    title
    author {
      name
    }
  }
}
```

`packages/client/src/client.ts` (new) — a thin `graphql-request` wrapper, replacing Genql's generated `createClient`:

```typescript
import { GraphQLClient } from "graphql-request";

export function createClient(url: string) {
  return new GraphQLClient(url);
}
```

`packages/client/src/index.ts`:

```diff
-export * from "./generated/index.js";
+export { createClient } from "./client.js";
+export * from "./generated/graphql.js";
```

`packages/client/package.json` — scripts and deps:

```diff
-    "codegen": "genql --schema ../schema/dist/schema.graphql --output src/generated",
-    "build": "tsup src/index.ts --format esm --out-dir dist --clean && tsc --emitDeclarationOnly",
+    "codegen": "graphql-codegen --config codegen.yml",
+    "build": "tsc --build",
     "typecheck": "tsc --noEmit",
-    "dev": "tsup src/index.ts --format esm --out-dir dist --watch"
+    "dev": "tsc --build --watch"
```

**Bonus: this drops the `tsup` bundling workaround entirely.** Phase 3 needed `tsup` because Genql's generated output uses extensionless relative imports that crash under Node's strict ESM resolution. `graphql-code-generator`'s output doesn't have that problem — it only imports from real packages (`@graphql-typed-document-node/core`), never relatively — so plain `tsc --build` works and runs correctly with plain `node`, confirmed by running the built output directly. One less moving part if you make this swap.

`apps/web/src/index.ts` — the call site:

```diff
-import { createClient } from "@gqlkit/client";
+import { createClient, SearchPostsDocument } from "@gqlkit/client";

-const client = createClient({
-  url: process.env["GRAPHQL_URL"] ?? "http://localhost:4000/graphql",
-});
+const client = createClient(process.env["GRAPHQL_URL"] ?? "http://localhost:4000/graphql");

-const result = await client.query({
-  searchPosts: {
-    __args: { query: "hello" },
-    id: true,
-    title: true,
-    author: {
-      name: true,
-    },
-  },
-});
+const result = await client.request(SearchPostsDocument, { query: "hello" });
```

## Verify

```bash
pnpm --filter @gqlkit/schema build
pnpm --filter @gqlkit/client codegen && pnpm --filter @gqlkit/client build
pnpm --filter @gqlkit/web build
node apps/web/dist/index.js
```

Ran the built `apps/web` against the real Phase 2 server: reaches `searchPosts`, fails only on the (unset in this environment) database — same shape of result as every other verification in this repo, confirming the request actually makes it over the wire and the server actually executes the resolver.

`graphql-request` resolves its own `graphql@16` (its declared peer range doesn't cover this repo's `graphql@17`, unlike Genql which had no `graphql` dependency at all) — checked this doesn't cause the `instanceof`-style realm mismatches that broke Vitest against `graphql-js` 17 in Phase 1: `graphql-request` only ever handles plain `DocumentNode` ASTs and JSON, never `GraphQLSchema`/`GraphQLObjectType` instances, so there's no class-identity check for two different `graphql` copies to disagree about. Confirmed by actually running a full request against the live server above rather than assuming it from the dependency tree.

## Why this doesn't require touching anything else

- `packages/schema` is completely untouched — this is purely a `packages/client` internals swap plus updating call sites.
- `packages/server` doesn't know or care what generated the request it received — it's still just a GraphQL query string over HTTP.
