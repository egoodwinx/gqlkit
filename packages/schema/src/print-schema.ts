import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { printSchema } from "graphql";
import { schema } from "./schema.js";

const outFile = fileURLToPath(new URL("./schema.graphql", import.meta.url));
writeFileSync(outFile, `${printSchema(schema)}\n`);
