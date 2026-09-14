import SchemaBuilder from "@pothos/core";
import DataloaderPlugin from "@pothos/plugin-dataloader";
import PrismaPlugin from "@pothos/plugin-prisma";
import ScopeAuthPlugin from "@pothos/plugin-scope-auth";
import ZodPlugin from "@pothos/plugin-zod";
import type { Context } from "./context.js";
import { prisma } from "./db.js";
import type PrismaTypes from "./pothos-types.js";
import { getDatamodel } from "./pothos-types.js";

export interface AuthScopes {
  public: boolean;
}

export const builder = new SchemaBuilder<{
  Context: Context;
  PrismaTypes: PrismaTypes;
  AuthScopes: AuthScopes;
  DefaultFieldNullability: false;
  DefaultInputFieldRequiredness: true;
}>({
  plugins: [ScopeAuthPlugin, PrismaPlugin, ZodPlugin, DataloaderPlugin],
  defaultFieldNullability: false,
  defaultInputFieldRequiredness: true,
  prisma: {
    client: prisma,
    dmmf: getDatamodel(),
  },
  scopeAuth: {
    // No-op default: nothing is gated behind a scope yet (see docs/recipes "Add authentication")
    authScopes: () => ({
      public: true,
    }),
  },
});
