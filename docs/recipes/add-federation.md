# Add federation / split into multiple services

**Problem:** one service owns too much. You want a separate team/deploy/service to own `User` (say, for an identity/profile service), while this service keeps `Post`/`Comment` and just _references_ `User` by id.

This uses Apollo Federation v2. The schema object this starter produces is a plain `GraphQLSchema` — federation is an opt-in transformation on top of it, not a different way of building the schema.

```bash
pnpm --filter @gqlkit/schema add @pothos/plugin-federation @pothos/plugin-directives "@apollo/subgraph@2.14.4"
```

**Pin `@apollo/subgraph` to `2.14.4`, don't take latest.** `@apollo/subgraph@2.15.0` removed/renamed an internal export (`EntityType`) that `@pothos/plugin-federation@4.5.1` (current latest, as of writing) still imports by name — installing latest breaks at runtime with `SyntaxError: The requested module '@apollo/subgraph/dist/types.js' does not provide an export named 'EntityType'`. This is an upstream incompatibility between the two packages' latest releases, not a configuration mistake. Worth rechecking when either package next releases.

## Diff

`packages/schema/src/builder.ts` — register the two plugins (directives is a dependency of federation):

```diff
 import DataloaderPlugin from "@pothos/plugin-dataloader";
+import DirectivePlugin from "@pothos/plugin-directives";
+import FederationPlugin from "@pothos/plugin-federation";
 import PrismaPlugin from "@pothos/plugin-prisma";
 ...
-  plugins: [ScopeAuthPlugin, PrismaPlugin, ZodPlugin, DataloaderPlugin],
+  plugins: [ScopeAuthPlugin, PrismaPlugin, ZodPlugin, DataloaderPlugin, DirectivePlugin, FederationPlugin],
```

`packages/schema/src/types/user.ts` — export the object ref (same reason as the subscriptions recipe: cross-cutting Pothos APIs want the ref, not the string name) and mark `User` as an entity:

```diff
-builder.prismaObject("User", {
+export const UserRef = builder.prismaObject("User", {
   fields: (t) => ({
     ...
   }),
 });
+
+builder.asEntity(UserRef, {
+  key: builder.selection<{ id: string }>("id"),
+  resolveReference: (reference, ctx) =>
+    ctx.prisma.user.findUniqueOrThrow({ where: { id: reference.id } }),
+});
```

`packages/schema/src/schema.ts` — build a subgraph schema instead of a plain one:

```diff
-export const schema = builder.toSchema();
+export const schema = builder.toSubGraphSchema({});
```

That's the whole diff. `Post`, `Comment`, `searchPosts`, `createPost` — untouched. This service now speaks federation for the one type (`User`) another service might want to extend, and nothing else changed shape.

## The `pnpm dev` gotcha

`pnpm --filter @gqlkit/server dev` (the `tsx watch`-based dev server) fails after this change:

```
Error: Schema must contain uniquely named types but contains multiple types named "undefined".
    at SchemaBuilder.toSubGraphSchema (.../@pothos/plugin-federation/src/schema-builder.ts:159:26)
```

The **built** server (`pnpm build && pnpm --filter @gqlkit/server start`, i.e. real `tsc` output run with plain `node`) does not have this problem — confirmed booting cleanly and serving correctly. This looks like an interaction between `@pothos/plugin-federation` and tsx's esbuild-based transform, not a real schema bug — the identical source compiles and runs fine through `tsc`. If you adopt federation, verify against the built output rather than `tsx watch` until this is root-caused.

## Verify

Confirms the schema is a valid federation subgraph:

```bash
pnpm build
curl localhost:4000/graphql -d '{"query":"{ _service { sdl } }"}' -H 'content-type: application/json'
```

Returns the real subgraph SDL, including the parts this repo's own `dist/schema.graphql` doesn't show (that file is printed with plain `graphql`'s `printSchema`, which doesn't render Apollo's `@link`/`@key` directive applications — if you want a federation-aware SDL file, print it with `@apollo/subgraph`'s `printSubgraphSchema` instead):

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.6", import: ["@key"])

type User
  @key(fields: "id")
{
  id: ID!
  email: String!
  ...
}
```

**Full split, actually composed and queried.** Stood up a second, completely independent subgraph (`@apollo/server` + `@apollo/subgraph`'s `buildSubgraphSchema`, own `package.json`, no relation to this repo) extending `User` with a `bio` field it owns:

```graphql
extend schema @link(url: "https://specs.apollo.dev/federation/v2.6", import: ["@key"])
type User @key(fields: "id") {
  id: ID!
  bio: String
}
```

Composed both with `@apollo/gateway`'s `ApolloGateway` + `IntrospectAndCompose`, then queried the gateway for a `User`'s `id` _and_ `bio` in one request. Response:

```json
{ "data": { "_debugUser": { "id": "u1", "bio": "Loves GraphQL." } } }
```

`id` came back from this repo's service; `bio` was fetched transparently by the gateway from the second, unrelated service — proving the entity split actually composes and resolves across service boundaries, not just that the SDL looks right in isolation.

## Why this doesn't require touching anything else

- `Post`, `Comment`, and every existing query/mutation are byte-identical before and after — federation is additive to `User` only.
- `packages/client`'s `genql` codegen is unaffected for anyone querying this service directly (`_service`/`_entities` are extra fields, not replacements). A gateway-fronted client would point at the gateway's URL instead — same generated client, different endpoint.