import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@talk/shared";

type RandomBytes = (length: number) => Uint8Array;

function secureRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function generateRoomCode(randomBytes: RandomBytes = secureRandomBytes): string {
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  if (bytes.length !== ROOM_CODE_LENGTH) throw new Error("Random source returned an invalid byte count");
  return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte & 31]).join("");
}

export function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("UNIQUE constraint failed") || message.includes("SQLITE_CONSTRAINT");
}

export async function reserveUniqueCode<T>(
  insert: (code: string) => Promise<T>,
  codeFactory: () => string = generateRoomCode,
  maxAttempts = 12,
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await insert(codeFactory());
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
  }
  throw new Error("ROOM_CODE_GENERATION_EXHAUSTED");
}
