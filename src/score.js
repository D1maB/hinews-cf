const POSITIVE_KEYWORDS = [
  'cpu',
  'gpu',
  'graphics card',
  'processor',
  'motherboard',
  'ram',
  'ddr5',
  'ssd',
  'nvme',
  'benchmark',
  'driver',
  'overclock',
  'cooler',
  'psu',
  'pc',
  'gaming',
  'ray tracing',
  'dlss',
  'fsr',
  'thermal',
  'fps',
  'nvidia',
  'amd',
  'intel',
  'geforce',
  'radeon',
  'ryzen',
  'review',
  'performance',
  'latency',
];

const NEGATIVE_KEYWORDS = [
  'smartphone',
  'phone',
  'iphone',
  'android',
  'console',
  'playstation',
  'xbox',
  'nintendo',
  'tablet',
  'wearable',
];

/**
 * Scores a headline for PC-user relevance on a 0-100 scale.
 *
 * @param {string} title
 * @returns {number}
 */
export function scoreTitle(title) {
  const normalized = String(title ?? '').toLowerCase();
  let score = 50;

  for (const keyword of POSITIVE_KEYWORDS) {
    if (normalized.includes(keyword)) {
      score += 10;
    }
  }

  for (const keyword of NEGATIVE_KEYWORDS) {
    if (normalized.includes(keyword)) {
      score -= 20;
    }
  }

  return Math.max(0, Math.min(100, score));
}