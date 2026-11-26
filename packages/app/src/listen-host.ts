/**
 * Listen address policy.
 *
 * `/api/reverse` has no authentication, so the server binds to loopback unless
 * the operator explicitly asks for something else. `HOST=0.0.0.0` is allowed
 * (containers need it) but then `REVERSE_ROOTS` should be set as well; the
 * startup banner warns when it is not.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"]);

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (LOOPBACK_HOSTS.has(normalized)) return true;
  // The whole 127.0.0.0/8 block is loopback.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
}

export function resolveListenHost(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.HOST?.trim();
  return configured && configured.length > 0 ? configured : "127.0.0.1";
}
