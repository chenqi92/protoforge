// PKCE (Proof Key for Code Exchange) utilities for OAuth 2.0
// RFC 7636: https://tools.ietf.org/html/rfc7636

const VERIFIER_LENGTH = 64;
const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** Generate a cryptographically random code_verifier (43-128 unreserved chars). */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(VERIFIER_LENGTH);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => CHARSET[byte % CHARSET.length]).join("");
}

/** Compute code_challenge = base64url(SHA-256(verifier)) per RFC 7636 §4.2. */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
