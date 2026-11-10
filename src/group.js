/**
 * Compares scheduled times, oldest first; undated items go last.
 *
 * @param {{ scheduled_at: string | null }} left
 * @param {{ scheduled_at: string | null }} right
 * @returns {number}
 */
export function compareByScheduled(left, right) {
  if (left.scheduled_at === right.scheduled_at) {
    return 0;
  }

  if (!left.scheduled_at) {
    return 1;
  }

  if (!right.scheduled_at) {
    return -1;
  }

  return left.scheduled_at.localeCompare(right.scheduled_at);
}

/**
 * Flattens stored rows into a single list sorted by scheduled time, oldest first.
 *
 * @param {Array<Record<string, unknown>>} items
 * @returns {Array<Record<string, unknown>>}
 */
export function sortByScheduled(items) {
  return [...items].sort(compareByScheduled);
}
