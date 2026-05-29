import { PrismaClient } from "@prisma/client";

let prisma;

if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient();
} else {
  // eslint-disable-next-line no-undef
  if (!global.prismaGlobal) {
    // eslint-disable-next-line no-undef
    global.prismaGlobal = new PrismaClient();
  }
  // eslint-disable-next-line no-undef
  prisma = global.prismaGlobal;
}

export default prisma;
