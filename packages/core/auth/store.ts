import { create } from "zustand";
import type { User, StorageAdapter } from "../types";
import { identify as identifyAnalytics, resetAnalytics } from "../analytics";
import type { ApiClient } from "../api/client";
import { setCurrentWorkspace } from "../platform/workspace-storage";

export interface AuthStoreOptions {
  api: ApiClient;
  storage: StorageAdapter;
  onLogin?: () => void;
  onLogout?: () => void;
  /**
   * Cleanup for a session the server ended, as opposed to one the user did.
   * Defaults to `onLogout` — a shell only needs its own handler when some of
   * its logout teardown is too destructive for an expiry it did not ask for.
   */
  onSessionExpired?: () => void;
  /** When true, rely on HttpOnly cookies instead of localStorage for auth tokens. */
  cookieAuth?: boolean;
}

export type AuthStatus =
  | "authenticating"
  | "authenticated"
  | "unauthenticated"
  | "recovering";

export interface AuthState {
  user: User | null;
  isLoading: boolean;
  status: AuthStatus;
  retryGeneration: number;
  /**
   * The last transition to `unauthenticated` was the server rejecting our
   * credential, not the user asking to leave. Purely presentational — the
   * login page uses it to say why the session ended. Cleared by any
   * successful login and by an explicit logout.
   */
  expired: boolean;

  retryAuthentication: () => void;
  /** 返回 true 表示直登模式（MULTICA_AUTH_MODE=passwordless/password）下
   * 后端已直接签发凭据、登录完成；false 表示常规流程，需进入输码页。
   * password 模式第二参携带固定密码。 */
  sendCode: (email: string, password?: string) => Promise<boolean>;
  verifyCode: (email: string, code: string) => Promise<User>;
  loginWithGoogle: (code: string, redirectUri: string) => Promise<User>;
  loginWithToken: (token: string) => Promise<User>;
  logout: () => void;
  sessionExpired: () => void;
  setUser: (user: User) => void;
  refreshMe: () => Promise<void>;
}

export function createAuthStore(options: AuthStoreOptions) {
  const { api, storage, onLogin, onLogout, onSessionExpired, cookieAuth } =
    options;

  return create<AuthState>((set, get) => ({
    user: null,
    isLoading: true,
    status: "authenticating",
    retryGeneration: 0,
    expired: false,

    retryAuthentication: () => {
      set((state) => ({
        isLoading: true,
        status: "authenticating",
        retryGeneration: state.retryGeneration + 1,
      }));
    },

    sendCode: async (email: string, password?: string) => {
      // 直登：后端在 send-code 响应中直接返回 token+user，
      // 落点（cookie/token 持久化、状态迁移）与 verifyCode 完全一致。
      const res = await api.sendCode(email, password);
      if (!res) return false;
      if (!cookieAuth) {
        // Token mode: persist for Electron / legacy.
        storage.setItem("multica_token", res.token);
        api.setToken(res.token);
      }
      onLogin?.();
      identifyAnalytics(res.user.id, {
        email: res.user.email,
        name: res.user.name,
      });
      set({ user: res.user, isLoading: false, status: "authenticated", expired: false });
      return true;
    },

    verifyCode: async (email: string, code: string) => {
      const { token, user } = await api.verifyCode(email, code);
      if (!cookieAuth) {
        // Token mode: persist for Electron / legacy.
        storage.setItem("multica_token", token);
        api.setToken(token);
      }
      onLogin?.();
      identifyAnalytics(user.id, { email: user.email, name: user.name });
      set({ user, isLoading: false, status: "authenticated", expired: false });
      return user;
    },

    loginWithGoogle: async (code: string, redirectUri: string) => {
      const { token, user } = await api.googleLogin(code, redirectUri);
      if (!cookieAuth) {
        storage.setItem("multica_token", token);
        api.setToken(token);
      }
      onLogin?.();
      identifyAnalytics(user.id, { email: user.email, name: user.name });
      set({ user, isLoading: false, status: "authenticated", expired: false });
      return user;
    },

    loginWithToken: async (token: string) => {
      storage.setItem("multica_token", token);
      api.setToken(token);
      const user = await api.getMe();
      onLogin?.();
      identifyAnalytics(user.id, { email: user.email, name: user.name });
      set({ user, isLoading: false, status: "authenticated", expired: false });
      return user;
    },

    logout: () => {
      if (cookieAuth) {
        // Clear server-side HttpOnly cookie.
        api.logout().catch(() => {});
      }
      storage.removeItem("multica_token");
      api.setToken(null);
      setCurrentWorkspace(null, null);
      resetAnalytics();
      onLogout?.();
      set({
        user: null,
        isLoading: false,
        status: "unauthenticated",
        expired: false,
      });
    },

    /**
     * The server rejected our credential (401). Tears the session down to
     * exactly the state a cold boot with a dead token lands in, so the shell
     * unmounts and the app shows the login page instead of staying up while
     * every request fails with an auth error the user cannot act on
     * (MUL-7028).
     *
     * No server round-trip: the credential is already dead, and `/auth/logout`
     * would be one more request to answer a 401 with. Idempotent, because a
     * session dies once but a screen full of in-flight requests all learn
     * about it separately.
     */
    sessionExpired: () => {
      // "Expired" is a claim about the user's own history, so only make it
      // when this client really did present a credential the server then
      // rejected: a live session, or a stored token left by an earlier one.
      // A first visit to /login 401s on the identity probe too, and telling
      // that person their session expired would be a lie. Read before the
      // teardown below removes the evidence.
      const hadCredential =
        get().status === "authenticated" ||
        storage.getItem("multica_token") !== null;

      // Dropping the rejected credential happens before the idempotence
      // guard, and unconditionally. A login attempt that 401s never leaves
      // `unauthenticated` — Desktop's deep link writes the token, calls
      // getMe, and gets rejected — so a guard placed first would return with
      // that invalid token still sitting in storage, to be replayed at the
      // next launch. Nothing below this point is safe to repeat; this is.
      storage.removeItem("multica_token");
      api.setToken(null);

      // Past here we are ending a session, which happens once no matter how
      // many in-flight requests learn the credential is dead — and does not
      // happen at all when there was no session to end.
      if (get().status === "unauthenticated") return;

      // Cookie mode leaves the workspace singleton alone: there the URL owns
      // workspace identity and the login route overwrites it on the next
      // entry. Mirrors AuthInitializer's boot-time rejection.
      if (!cookieAuth) setCurrentWorkspace(null, null);
      resetAnalytics();
      (onSessionExpired ?? onLogout)?.();
      set({
        user: null,
        isLoading: false,
        status: "unauthenticated",
        expired: hadCredential,
      });
    },

    setUser: (user: User) => {
      set({ user, isLoading: false, status: "authenticated", expired: false });
    },

    refreshMe: async () => {
      const user = await api.getMe();
      set({ user, isLoading: false, status: "authenticated", expired: false });
    },
  }));
}
