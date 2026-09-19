require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany();
  console.log('Users:', users);
  const repos = await prisma.repository.findMany();
  console.log('Repos:', repos);
}

main().catch(console.error).finally(() => prisma.$disconnect());
