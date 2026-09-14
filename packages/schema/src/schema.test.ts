import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { printSchema } from "graphql";
import { schema } from "./schema.js";

test("schema SDL matches the committed snapshot", () => {
  const snapshotPath = fileURLToPath(new URL("../schema.snapshot.graphql", import.meta.url));
  const expected = readFileSync(snapshotPath, "utf8");
  assert.equal(`${printSchema(schema)}\n`, expected);
});
