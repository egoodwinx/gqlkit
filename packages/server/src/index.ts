import "dotenv/config";
import { createServer } from "node:http";
import { schema } from "@gqlkit/schema";
import { createYoga } from "graphql-yoga";
import { createContext } from "./context.js";

const yoga = createYoga({ schema, context: createContext });
const port = Number(process.env["PORT"] ?? 4000);

createServer(yoga).listen(port, () => {
  console.log(`GraphQL server ready at http://localhost:${port}${yoga.graphqlEndpoint}`);
});
