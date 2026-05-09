import { badRequest } from "../lib/errors.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function localDateParts(timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getBackupSettings(store, userId) {
  const settings = store.listUserSettingsByCategory(userId, "opml_backup").reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
  return {
    email: String(settings.email || "").trim(),
    sendTime: String(settings.send_time || "09:00").trim(),
    enabled: ["1", "true", "yes", "on"].includes(String(settings.enabled || "").trim().toLowerCase()),
    lastSentDate: settings.last_sent_date || null
  };
}

export function createOpmlBackupService({ store, feedService, mailService }) {
  let timer = null;
  let running = false;

  function getBackupConfig(userId) {
    return getBackupSettings(store, userId);
  }

  function updateBackupConfig(userId, payload = {}) {
    const email = String(payload.email ?? "").trim();
    if (email && !emailPattern.test(email)) {
      throw badRequest("邮箱格式无效", { code: "invalid_backup_email" });
    }
    const sendTime = String(payload.sendTime ?? payload.send_time ?? "09:00").trim();
    if (!/^\d{2}:\d{2}$/.test(sendTime)) {
      throw badRequest("发送时间格式应为 HH:mm", { code: "invalid_backup_send_time" });
    }
    const enabled = payload.enabled === undefined ? undefined : (payload.enabled ? "1" : "0");

    if (email !== undefined) store.setUserSetting(userId, "opml_backup", "email", email);
    if (sendTime !== undefined) store.setUserSetting(userId, "opml_backup", "send_time", sendTime);
    if (enabled !== undefined) store.setUserSetting(userId, "opml_backup", "enabled", enabled);

    return getBackupSettings(store, userId);
  }

  async function sendBackupNow(userId, options = {}) {
    const settings = getBackupSettings(store, userId);
    const email = options.email || settings.email;
    if (!email) {
      throw badRequest("未配置备份邮箱", { code: "backup_email_missing" });
    }
    const user = store.getUserById(userId);
    if (!user) {
      throw badRequest("用户不存在", { code: "user_not_found" });
    }
    const opmlContent = feedService.exportFeeds(userId, "opml");
    const feedCount = (opmlContent.match(/<outline /g) || []).length;
    const dateStr = new Date().toISOString().slice(0, 10);
    await mailService.sendMail({
      to: email,
      subject: `订阅源备份 - ${dateStr}（${feedCount} 个）`,
      text: `这是您的订阅源 OPML 备份，共 ${feedCount} 个订阅源。\n\n可在此平台或其他 RSS 阅读器导入恢复。`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h2 style="margin:0 0 12px">订阅源备份</h2>
        <p>共 <strong>${feedCount}</strong> 个订阅源，备份时间 ${dateStr}。</p>
        <p>可在此平台或其他 RSS 阅读器导入恢复。</p>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
        <details><summary style="cursor:pointer">查看 OPML 内容</summary>
        <pre style="background:#f5f5f5;padding:12px;overflow-x:auto;font-size:13px;white-space:pre-wrap;word-break:break-all">${escapeHtml(opmlContent)}</pre>
        </details>
      </div>`
    });
    const sentDate = localDateParts("Asia/Shanghai").date;
    store.setUserSetting(userId, "opml_backup", "last_sent_date", sentDate);
    return { sent: true, email, feedCount, date: sentDate };
  }

  async function processDueBackups() {
    if (running) return { skipped: true };
    running = true;
    try {
      const results = [];
      const users = store.listUsers();
      for (const user of users) {
        const settings = getBackupSettings(store, user.id);
        if (!settings.enabled || !settings.email) continue;
        const { date, time } = localDateParts("Asia/Shanghai");
        if (settings.lastSentDate === date || time < settings.sendTime) continue;
        try {
          const result = await sendBackupNow(user.id);
          results.push({ userId: user.id, ...result });
        } catch (error) {
          results.push({ userId: user.id, error: error.message });
          const sentDate = localDateParts("Asia/Shanghai").date;
          store.setUserSetting(user.id, "opml_backup", "last_sent_date", sentDate);
        }
      }
      return { processed: results.length, results };
    } finally {
      running = false;
    }
  }

  return {
    getBackupConfig,
    updateBackupConfig,
    sendBackupNow,
    processDueBackups,
    startSchedule() {
      if (timer) return;
      timer = setInterval(() => {
        processDueBackups().catch((error) => console.error("OPML backup schedule failed:", error.message));
      }, 60 * 1000);
      timer.unref?.();
    },
    stopSchedule() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    async waitForIdle() {
      while (running) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  };
}
