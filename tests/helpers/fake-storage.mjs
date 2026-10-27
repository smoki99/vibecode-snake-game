/** A localStorage double with the failure modes the real one has. */
export function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
  };
}

export const throwingStorage = () => ({
  getItem() {
    throw new Error('SecurityError: storage disabled');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
});

export const missingStorage = null;
