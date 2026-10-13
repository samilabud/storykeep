import bcrypt from "bcryptjs";

// Cost 10 means 2^10 hashing rounds. Slow on purpose, so stolen hashes are
// expensive to guess.
const COST = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
