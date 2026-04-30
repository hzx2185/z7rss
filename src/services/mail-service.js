import nodemailer from "nodemailer";
import { badRequest, serviceUnavailable } from "../lib/errors.js";

function rowsToSettings(store, secretBox) {
  return store.listSettings().reduce((acc, row) => {
    if (!acc[row.category]) acc[row.category] = {};
    acc[row.category][row.key] = row.key === "password" ? secretBox.decrypt(row.value) : row.value;
    return acc;
  }, {});
}

export function createMailService({ store, secretBox }) {
  function hasPartialAuth(config) {
    return Boolean(config.username) !== Boolean(config.password);
  }

  function assertConfigReady(config) {
    if (!config.from || !config.host || !config.port) {
      throw badRequest("邮件服务未配置，请先在后台填写 SMTP 信息", { code: "mail_unconfigured" });
    }
    if (hasPartialAuth(config)) {
      throw badRequest("SMTP 账号和密码需要同时填写；请在后台重新保存 SMTP 用户和密码", {
        code: "mail_auth_incomplete"
      });
    }
  }

  function getConfig() {
    const mail = rowsToSettings(store, secretBox).mail || {};
    return {
      from: String(mail.from || "").trim(),
      host: String(mail.host || "").trim(),
      port: Number(mail.port || 587),
      username: String(mail.username || "").trim(),
      password: String(mail.password || "").trim()
    };
  }

  function createTransport() {
    const config = getConfig();
    assertConfigReady(config);
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.username || config.password
        ? {
            user: config.username,
            pass: config.password
          }
        : undefined
    });
  }

  return {
    getConfigStatus() {
      const config = getConfig();
      const authComplete = !hasPartialAuth(config);
      return {
        configured: Boolean(config.from && config.host && config.port && authComplete),
        from: config.from,
        host: config.host,
        port: config.port,
        usernameConfigured: Boolean(config.username),
        passwordConfigured: Boolean(config.password),
        authComplete
      };
    },
    async sendMail({ to, subject, text, html }) {
      const recipients = Array.isArray(to) ? to : [to];
      const normalizedRecipients = recipients.map((entry) => String(entry || "").trim()).filter(Boolean);
      if (!normalizedRecipients.length) {
        throw badRequest("收件邮箱不能为空", { code: "mail_recipient_required" });
      }
      const config = getConfig();
      const transport = createTransport();
      try {
        return await transport.sendMail({
          from: config.from,
          to: normalizedRecipients.join(", "),
          subject,
          text,
          html
        });
      } catch (error) {
        throw serviceUnavailable(`邮件发送失败: ${error.message}`, { code: "mail_send_failed" });
      }
    }
  };
}
