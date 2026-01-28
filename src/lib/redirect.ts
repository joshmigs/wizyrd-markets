export function getSafeRedirect(path?: string) {
  if (!path) {
    return null;
  }

  if (!path.startsWith("/") || path.startsWith("//")) {
    return null;
  }

  return path;
}
