import assert from "node:assert/strict";
import test from "node:test";
import { createMailService } from "../src/services/mail-service.js";

function createStore(settings) {
  return {
    listSettings() {
      return Object.entries(settings).map(([key, value]) => ({
        category: "mail",
        key,
        value
      }));
    }
  };
}

const plainSecretBox = {
  decrypt(value) {
    return String(value || "");
  }
};

test("mail service reports incomplete SMTP auth before nodemailer login", async () => {
  const mail = createMailService({
    store: createStore({
      from: "RSS <rss@example.com>",
      host: "smtp.example.com",
      port: "587",
      username: "rss@example.com",
      password: ""
    }),
    secretBox: plainSecretBox
  });

  const status = mail.getConfigStatus();
  assert.equal(status.configured, false);
  assert.equal(status.usernameConfigured, true);
  assert.equal(status.passwordConfigured, false);
  assert.equal(status.authComplete, false);

  await assert.rejects(
    mail.sendMail({
      to: "reader@example.com",
      subject: "Digest",
      text: "Hello"
    }),
    {
      status: 400,
      code: "mail_auth_incomplete"
    }
  );
});
