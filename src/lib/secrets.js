import crypto from "node:crypto";

function deriveKey(secret) {
  return crypto.createHash("sha256").update(String(secret || "")).digest();
}

export function createSecretBox(secret) {
  const key = deriveKey(secret);

  return {
    isEncrypted(value) {
      return String(value || "").startsWith("enc:");
    },
    encrypt(value) {
      const plaintext = String(value || "");
      if (!plaintext) return "";
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `enc:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
    },
    decrypt(value) {
      const input = String(value || "");
      if (!input) return "";
      if (!input.startsWith("enc:")) return input;
      try {
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
      } catch (_error) {
        return "";
      }
    }
  };
}
