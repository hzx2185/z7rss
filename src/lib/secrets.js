import crypto from "node:crypto";

function deriveKey(secret) {
  return crypto.createHash("sha256").update(String(secret || "")).digest();
}

export function createSecretBox(secret, options = {}) {
  const primaryKey = deriveKey(secret);
  const fallbackKeys = (options.fallbackSecrets || [])
    .map((fallbackSecret) => String(fallbackSecret || "").trim())
    .filter((fallbackSecret) => fallbackSecret && fallbackSecret !== String(secret || ""))
    .map((fallbackSecret) => deriveKey(fallbackSecret));

  function decryptWithKey(input, key) {
    const [, ivB64, tagB64, dataB64] = input.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final()
    ]);
    return decrypted.toString("utf8");
  }

  return {
    isEncrypted(value) {
      return String(value || "").startsWith("enc:");
    },
    encrypt(value) {
      const plaintext = String(value || "");
      if (!plaintext) return "";
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", primaryKey, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `enc:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
    },
    decrypt(value) {
      const input = String(value || "");
      if (!input) return "";
      if (!input.startsWith("enc:")) return input;

      for (const key of [primaryKey, ...fallbackKeys]) {
        try {
          return decryptWithKey(input, key);
        } catch (_error) {
          // Try the next key. Returning an empty string preserves the existing
          // "unavailable secret" behavior for truly unreadable values.
        }
      }
      return "";
    },
    needsRotation(value) {
      const input = String(value || "");
      if (!input.startsWith("enc:")) return false;
      try {
        decryptWithKey(input, primaryKey);
        return false;
      } catch (_error) {
        return fallbackKeys.some((key) => {
          try {
            decryptWithKey(input, key);
            return true;
          } catch (_fallbackError) {
            return false;
          }
        });
      }
    }
  };
}
