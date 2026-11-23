/** Hybrid logical clock. Stamps are `<ms>-<counter>-<node>`, zero-padded so string order is time order. */
export interface Clock {
  now(): string;
  observe(stamp: string): void;
}

const pad = (n: number, width: number) => n.toString(36).padStart(width, "0");

export function hlc(node: string, wall: () => number = Date.now): Clock {
  let ms = 0;
  let counter = 0;
  return {
    now() {
      const t = wall();
      if (t > ms) [ms, counter] = [t, 0];
      else counter++;
      return `${pad(ms, 9)}-${pad(counter, 4)}-${node}`;
    },
    observe(stamp) {
      const [m, c] = stamp.split("-");
      const remote = parseInt(m ?? "0", 36);
      const remoteCounter = parseInt(c ?? "0", 36);
      if (remote > ms) [ms, counter] = [remote, remoteCounter];
      else if (remote === ms) counter = Math.max(counter, remoteCounter);
    },
  };
}
