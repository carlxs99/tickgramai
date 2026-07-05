// Tiny pub/sub that lets the app signal the splash screen when it's fully loaded.
let ready = false;
const listeners = new Set<() => void>();

export function markAppReady() {
  if (ready) return;
  ready = true;
  listeners.forEach((l) => l());
  listeners.clear();
}

export function onAppReady(cb: () => void): () => void {
  if (ready) {
    cb();
    return () => {};
  }
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function isAppReady() {
  return ready;
}
