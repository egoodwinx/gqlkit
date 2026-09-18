# gqlkit

A code-first GraphQL stack, wired end-to-end and ready to scaffold.

```
npx create-gqlkit-app my-app
```

This creates a GraphQL server backed by Postgres, with a typed client with full end-to-end type inference from your Prisma schema to your frontend.

## Why this stack

- **Code-first, not SDL-first.** Your GraphQL types are defined in TypeScript ([Pothos](https://pothos-graphql.dev/)), directly off your Prisma models. No hand-written `.graphql` type files to keep in sync.
- **Standard primitives, no framework lock-in.** Prisma, Pothos, GraphQL Yoga, and Zod. The schema `builder`/`schema` object this stack produces is a plain, portable GraphQL schema — swap Yoga for Apollo Server, split it with federation, or eject the client codegen, without rewriting your resolvers. See [docs/recipes](docs/recipes) for verified diffs of each of these.
- **One validation layer.** Zod input schemas are shared between server-side validation and (optionally) client forms.
- **Copy, don't depend.** `create-gqlkit-app` copies these packages as plain files into your new repo — your app has no runtime dependency on a `@gqlkit/*` package. It's a starting point, not a framework you're locked into.

## Monorepo layout

This repo is both the stack itself and the scaffolder that ships it. If you're working in this repo directly (rather than a project scaffolded by `create-gqlkit-app`), here's what's in it:

| Path                                 | What it is                                                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/schema`](packages/schema) | Prisma schema + Pothos builder. Produces a typed `schema` export and a `schema.graphql` SDL build artifact.                                                       |
| [`packages/server`](packages/server) | Thin GraphQL Yoga server — imports the built schema, wires up Prisma + DataLoader as request context.                                                             |
| [`packages/client`](packages/client) | Typed client generated from the SDL via [Genql](https://genql.vercel.app/) — call your API with plain object literals, get inferred types back.                   |
| [`apps/web`](apps/web)               | Minimal example consumer of `packages/client`.                                                                                                                    |
| [`apps/cli`](apps/cli)               | The `create-gqlkit-app` scaffolder — copies the packages above into a new project and bootstraps it.                                                              |
| [`docs/recipes`](docs/recipes)       | Named, verified recipes for the changes you'll actually reach for: adding a resolver, adding auth, subscriptions, federation, ejecting codegen, swapping servers. |

## Working in this repo

Requires **pnpm** (the workspace uses the `workspace:*` protocol, which npm/yarn don't support) and a local Postgres.

```bash
pnpm install

# packages/schema and packages/server need a DATABASE_URL
cp packages/schema/.env.example packages/schema/.env
cp packages/server/.env.example packages/server/.env
# edit both to point at your local Postgres

pnpm --filter @gqlkit/schema exec prisma migrate dev --name init

pnpm build     # builds every package in dependency order (schema -> server/client -> web)
pnpm dev       # starts packages/server with hot reload
pnpm test      # schema snapshot test + CLI smoke test
pnpm typecheck
pnpm lint
```

Once `pnpm dev` is running, GraphiQL is available at `http://localhost:4000/graphql`.

## Scaffolding a new project

```bash
npx create-gqlkit-app my-app          # interactive prompts
npx create-gqlkit-app my-app -y       # accept defaults, no prompts
npx create-gqlkit-app my-app --no-web
```

This copies `packages/schema`, `packages/server`, and (unless `--no-web` is passed) `apps/web`/`packages/client` into `my-app`, installs dependencies, seeds `.env` from `.env.example`, and attempts an initial `prisma migrate dev` (a no-op until you point it at a real database). pnpm is the only supported package manager for the scaffolded project (it uses the `workspace:*` protocol), so `--pm` only accepts `pnpm` today.

## Learn more

- [docs/recipes](docs/recipes) — how to extend the stack for common needs
