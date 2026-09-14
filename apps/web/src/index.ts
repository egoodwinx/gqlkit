import { createClient } from "@gqlkit/client";

// This selection and the fields read off `result` are checked against the
// schema generated from prisma/schema.prisma. Rename or remove a field there,
// rebuild, and a stale reference here won't fail `tsc` (genql's selection
// type is generic, which TS excess-property checks don't cover) — but it
// will fail immediately as a GraphQL error the first time this runs. See
// docs/recipes "Eject the client codegen" for the urql + codegen path, which
// does fail at compile time, if you need that guarantee.
const client = createClient({
  url: process.env["GRAPHQL_URL"] ?? "http://localhost:4000/graphql",
});

const result = await client.query({
  searchPosts: {
    __args: { query: "hello" },
    id: true,
    title: true,
    author: {
      name: true,
    },
  },
});

for (const post of result.searchPosts) {
  console.log(`${post.title} by ${post.author.name ?? "unknown"}`);
}
