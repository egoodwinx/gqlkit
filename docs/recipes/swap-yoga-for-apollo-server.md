# Swap Yoga for Apollo Server

**Problem:** The `schema` this starter builds is a plain `graphql-js` `GraphQLSchema` — nothing about `packages/schema` knows or cares which HTTP server eventually serves it.

```bash
pnpm --filter @gqlkit/server add @apollo/server
pnpm --filter @gqlkit/server remove graphql-yoga
```

pnpm's default build-script allowlist blocks `@apollo/protobufjs` (a transitive dependency of `@apollo/server`) from running its postinstall script, failing the install with `ERR_PNPM_IGNORED_BUILDS`. Approve it, either interactively (`pnpm approve-builds`) or inline on the same `add` command: `pnpm --filter @gqlkit/server add --allow-build=@apollo/protobufjs @apollo/server`.

## Diff

`packages/server/src/index.ts` — the entire change:

```diff
 import "dotenv/config";
-import { createServer } from "node:http";
+import { ApolloServer } from "@apollo/server";
+import { startStandaloneServer } from "@apollo/server/standalone";
 import { schema } from "@gqlkit/schema";
-import { createYoga } from "graphql-yoga";
 import { createContext } from "./context.js";

-const yoga = createYoga({ schema, context: createContext });
+const server = new ApolloServer({ schema });
 const port = Number(process.env["PORT"] ?? 4000);

-createServer(yoga).listen(port, () => {
-  console.log(`GraphQL server ready at http://localhost:${port}${yoga.graphqlEndpoint}`);
+const { url } = await startStandaloneServer(server, {
+  listen: { port },
+  context: async () => createContext(),
 });
+
+console.log(`GraphQL server ready at ${url}`);
```

`packages/server/src/context.ts` — **zero changes.** `createContext()` already took no framework-specific arguments (Phase 2 built it that way on purpose), so it drops straight into Apollo's `context` option unchanged.

`packages/server/package.json` — swap the one dependency, everything else (including `graphql`) stays.

## The thing worth checking, and why it's fine

`@apollo/server@5.5.1` declares a peer dependency on `graphql: ^16.11.0` — this repo runs `graphql@17.0.2` everywhere. That mismatch pattern has bitten this project before (the federation recipe hit a real breaking incompatibility from a similar situation with `@apollo/subgraph`), so it was worth checking rather than assuming it'd be fine here too.

It's fine here: `pnpm why graphql` after installing shows `@apollo/server` dedupes onto the repo's existing `graphql@17.0.2` — pnpm found the single installed copy satisfies enough of what's needed in practice and didn't install a second one. Confirmed by actually running a query through the swapped server rather than trusting the dependency tree alone: introspection works, and `searchPosts` reaches the real resolver and fails only on the (unset in this environment) database — no `GraphQLObjectType`-realm errors, which is exactly the failure mode a genuine graphql-version split would produce.

## Two behavioral differences worth knowing about, not blockers

- **Error verbosity.** Yoga masks internal errors by default (`"Unexpected error."`, no stack trace). Apollo Server's standalone setup returned the full Prisma error message and stack trace in this test. Fine for local dev, but check Apollo's error-masking options before this hits production.
- **`pnpm dev` (tsx) still works.** Unlike the federation recipe, this swap has no issue running under `tsx watch` — confirmed booting and serving correctly. (The federation recipe's tsx problem was specific to `@pothos/plugin-federation`'s `toSubGraphSchema`, not a general tsx incompatibility.)

## Verify

```bash
pnpm build
pnpm --filter @gqlkit/server start
curl localhost:4000 -X POST -H 'content-type: application/json' -d '{"query":"{ __typename }"}'
# {"data":{"__typename":"Query"}}
```

## Why this doesn't require touching anything else

- `packages/schema` — untouched. The schema object doesn't know what serves it.
- `packages/client` — untouched. It talks to whatever URL you give it; genql's generated client doesn't care whether Yoga or Apollo Server produced the response, only that it's valid GraphQL-over-HTTP.
- `docs/recipes/add-authentication.md` and `add-real-time-subscriptions.md`'s server-side pieces (`createContext`, `pubsub`) are equally portable for the same reason: neither one imports anything from `graphql-yoga`.
