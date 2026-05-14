let authStatePromise = null

function normalizeAuthResult(result) {
  return result?.authenticated ? result : null
}

export async function fetchAuthState(options = {}) {
  if (!options.force && authStatePromise) {
    return authStatePromise
  }

  authStatePromise = window.fetch("/api/auth/me", {
    credentials: "same-origin",
    headers: {
      Accept: "application/json"
    },
    ...(options.force ? { cache: "no-store" } : {})
  })
    .then(async (response) => {
      if (!response.ok) return null
      const result = await response.json()
      return normalizeAuthResult(result)
    })
    .catch(() => null)

  return authStatePromise
}

export function clearAuthStateCache() {
  authStatePromise = null
}
