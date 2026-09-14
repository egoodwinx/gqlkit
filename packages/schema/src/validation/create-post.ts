import { z } from "zod";

// Shared with client forms so the same rules apply on both sides of the wire.
export const createPostSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  authorId: z.string().min(1),
});
