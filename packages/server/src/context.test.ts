import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext } from "./context.js";

test("createContext returns a fresh object identity on every call", () => {
  assert.notEqual(createContext(), createContext());
});

test("createContext defaults currentUserId to null", () => {
  assert.equal(createContext().currentUserId, null);
});
