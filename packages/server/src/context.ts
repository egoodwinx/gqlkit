import type { Context } from "@gqlkit/schema";
import { prisma } from "@gqlkit/schema";

// Pothos's dataloader plugin (and t.loadable fields) key their per-request
// caches off this context object's identity, via a WeakMap. Returning a new
// object on every call is what gives each request its own DataLoader
// instances — reuse a shared object here and requests start seeing each
// other's cached results.
export function createContext(): Context {
  return {
    currentUserId: null,
    prisma,
  };
}
