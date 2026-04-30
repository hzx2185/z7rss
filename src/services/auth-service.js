import { createToken, hashPassword, verifyPassword } from "../lib/security.js";
import { badRequest, conflict, forbidden, unauthorized } from "../lib/errors.js";

function normalizeUserAgent(value) {
  return String(value || "").trim().slice(0, 255);
}

export function createAuthService({ store, config }) {
  function sanitizeUser(user) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      isAdmin: Boolean(user.is_admin),
      status: user.status
    };
  }

  function sanitizeSession(session, currentToken = null) {
    return {
      id: session.id,
      createdAt: session.created_at,
      expiresAt: session.expires_at,
      lastSeenAt: session.last_seen_at,
      ipAddress: session.ip_address || "",
      userAgent: session.user_agent || "",
      isCurrent: currentToken ? session.token === currentToken : false
    };
  }

  function createSessionForUser(userId, context = {}) {
    const token = createToken();
    const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000).toISOString();
    return store.createSession(token, userId, expiresAt, {
      ipAddress: context.requestIp || null,
      userAgent: normalizeUserAgent(context.userAgent),
      lastSeenAt: new Date().toISOString()
    });
  }

  function ensureAdminFallback(user) {
    if (!user) return user;
    if (user.is_admin) return user;
    if (store.countAdmins() > 0) return user;

    const firstUser = store.getFirstUser();
    const shouldBeAdmin =
      (firstUser && firstUser.id === user.id) || config.adminEmails.includes(String(user.email || "").toLowerCase());

    if (!shouldBeAdmin) return user;
    return store.setUserAdmin(user.id, true);
  }

  return {
    register({ email, password, displayName }, context = {}) {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const normalizedName = String(displayName || "").trim();

      if (!normalizedEmail || !password || password.length < 8 || !normalizedName) {
        throw badRequest("Email、昵称和至少 8 位密码必填");
      }

      if (store.getUserByEmail(normalizedEmail)) {
        throw conflict("该邮箱已注册", { code: "email_taken" });
      }

      const shouldBeAdmin =
        store.countUsers() === 0 || config.adminEmails.includes(normalizedEmail);

      const user = ensureAdminFallback(store.createUser({
        email: normalizedEmail,
        passwordHash: hashPassword(password),
        displayName: normalizedName,
        isAdmin: shouldBeAdmin ? 1 : 0,
        status: "active"
      }));

      const freePlan = store.getPlanByCode("free");
      store.setUserSubscription({
        userId: user.id,
        planId: freePlan.id,
        status: "active",
        provider: "system",
        providerCustomerId: null,
        providerSubscriptionId: null,
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: null
      });

      return {
        user: sanitizeUser(user),
        session: createSessionForUser(user.id, context)
      };
    },
    login({ email, password }, context = {}) {
      const user = ensureAdminFallback(store.getUserByEmail(String(email || "").trim().toLowerCase()));
      if (!user || !verifyPassword(password, user.password_hash)) {
        throw unauthorized("邮箱或密码错误", { code: "invalid_credentials" });
      }
      if (user.status !== "active") {
        throw forbidden("账号已被禁用", { code: "account_disabled" });
      }

      return {
        user: sanitizeUser(user),
        session: createSessionForUser(user.id, context)
      };
    },
    logout(token) {
      if (token) {
        store.deleteSession(token);
      }
    },
    listSessions(userId, currentToken = null) {
      return store.listUserSessions(userId).map((session) => sanitizeSession(session, currentToken));
    },
    revokeOtherSessions(userId, currentToken) {
      const beforeCount = store.listUserSessions(userId).length;
      store.deleteOtherUserSessions(userId, currentToken);
      const sessions = this.listSessions(userId, currentToken);
      return {
        revokedCount: Math.max(0, beforeCount - sessions.length),
        sessions
      };
    },
    changePassword({ userId, currentPassword, newPassword, currentToken, revokeOtherSessions = true }) {
      const user = store.getUserById(userId);
      if (!user) {
        throw unauthorized("请先登录", { code: "auth_required" });
      }
      if (!verifyPassword(currentPassword, user.password_hash)) {
        throw forbidden("当前密码错误", { code: "invalid_current_password" });
      }
      if (currentPassword === newPassword) {
        throw badRequest("新密码不能与当前密码相同", { code: "password_unchanged" });
      }

      store.setUserPassword(userId, hashPassword(newPassword));

      let security = {
        revokedCount: 0,
        sessions: this.listSessions(userId, currentToken)
      };
      if (revokeOtherSessions) {
        security = this.revokeOtherSessions(userId, currentToken);
      }

      return {
        user: sanitizeUser(store.getUserById(userId)),
        ...security
      };
    },
    getUserFromToken(token, options = {}) {
      if (!token) return null;
      let session = store.getSession(token);
      if (!session) return null;

      const user = ensureAdminFallback(store.getUserById(session.user_id));
      if (!user || user.status !== "active") {
        store.deleteUserSessions(session.user_id);
        return null;
      }

      if (options.touch) {
        session = store.updateSessionActivity(token, {
          lastSeenAt: new Date().toISOString(),
          ipAddress: options.requestIp || null,
          userAgent: normalizeUserAgent(options.userAgent)
        }) || session;
      }

      return {
        user: sanitizeUser(user),
        session: {
          ...session,
          email: user.email,
          display_name: user.display_name,
          is_admin: user.is_admin,
          status: user.status
        }
      };
    }
  };
}
