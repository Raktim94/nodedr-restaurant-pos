// Sets the App Store / Play reviewer passwords from /tmp/reviewer-credentials.txt (copied in by reset.sh).
const fs = require("fs");
const bcrypt = require("bcrypt");
const { PrismaClient } = require("@prisma/client");
(async () => {
  const p = new PrismaClient();
  for (const line of fs.readFileSync("/tmp/reviewer-credentials.txt", "utf8").split("\n")) {
    if (!line.includes(" / ")) continue;
    const [a, b] = line.split(":").slice(1).join(":").split(" / ").map((s) => s.trim());
    const where = a.includes("@") ? { email: a } : { phone: a };
    const r = await p.user.updateMany({ where, data: { passwordHash: await bcrypt.hash(b, 12), isActive: true } });
    console.log("reviewer password set:", a.includes("@") ? "manager" : "rider", r.count);
  }
  await p.$disconnect();
})();
