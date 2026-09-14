import type { PrismaClient } from "../generated/prisma/client.js";

// currentUserId is always null until a real session mechanism sets it (see docs/recipes "Add authentication")
export interface Context {
  currentUserId: string | null;
  prisma: PrismaClient;
}
