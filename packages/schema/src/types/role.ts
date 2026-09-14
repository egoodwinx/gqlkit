import { builder } from "../builder.js";
import { Role } from "../../generated/prisma/client.js";

export const RoleType = builder.enumType(Role, { name: "Role" });
