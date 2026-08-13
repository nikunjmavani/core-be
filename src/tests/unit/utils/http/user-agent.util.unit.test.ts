import { describe, expect, it } from 'vitest';
import { parseUserAgent } from '@/shared/utils/http/user-agent.util.js';

/**
 * Correctness here is almost entirely a matter of matcher ORDER, because every Chromium UA also
 * claims Safari and every iPhone UA also claims Mac OS X. The parser walks two ordered arrays and
 * returns the first hit, so reordering either array silently mislabels the device/browser shown
 * against every session in the sessions list — with no error and no failing assertion elsewhere.
 */
describe('user-agent.util', () => {
  describe('browser detection (order-sensitive)', () => {
    it('reports Edge, not Chrome, for a Chromium Edge UA', () => {
      // Edge claims Chrome AND Safari; it must win over both.
      const userAgent =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';

      expect(parseUserAgent(userAgent).browser).toBe('Edge');
    });

    it('reports Opera, not Chrome, for an Opera UA', () => {
      const userAgent =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 OPR/105.0.0.0';

      expect(parseUserAgent(userAgent).browser).toBe('Opera');
    });

    it('reports Chrome, not Safari, for a desktop Chrome UA', () => {
      const userAgent =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

      expect(parseUserAgent(userAgent).browser).toBe('Chrome');
    });

    it('reports Safari for a genuine Safari UA', () => {
      const userAgent =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15';

      expect(parseUserAgent(userAgent).browser).toBe('Safari');
    });

    it('reports Firefox for a desktop Firefox UA', () => {
      const userAgent = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';

      expect(parseUserAgent(userAgent).browser).toBe('Firefox');
    });

    it.each([
      [
        'iOS Chrome (CriOS)',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
        'Chrome',
      ],
      [
        'iOS Firefox (FxiOS)',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15',
        'Firefox',
      ],
      [
        'iOS Edge (EdgiOS)',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/120.0.0.0 Mobile/15E148 Safari/605.1.15',
        'Edge',
      ],
    ])('resolves %s to %s despite the trailing Safari token', (_label, userAgent, expected) => {
      expect(parseUserAgent(userAgent).browser).toBe(expected);
    });
  });

  describe('device detection (order-sensitive)', () => {
    it('reports iPhone, not Mac, even though the UA contains "like Mac OS X"', () => {
      const userAgent =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1';

      expect(parseUserAgent(userAgent).device).toBe('iPhone');
    });

    it('reports iPad, not Mac, for an iPad UA', () => {
      const userAgent =
        'Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1';

      expect(parseUserAgent(userAgent).device).toBe('iPad');
    });

    it('reports Chromebook, not Linux, for a CrOS UA', () => {
      const userAgent =
        'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

      expect(parseUserAgent(userAgent).device).toBe('Chromebook');
    });

    it.each([
      [
        'Android',
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      ],
    ])('reports %s, not Linux, for an Android UA', (expected, userAgent) => {
      expect(parseUserAgent(userAgent).device).toBe(expected);
    });

    it('reports Windows for a Windows UA', () => {
      const userAgent =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

      expect(parseUserAgent(userAgent).device).toBe('Windows');
    });

    it('reports Mac for a desktop macOS UA', () => {
      const userAgent =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15';

      expect(parseUserAgent(userAgent).device).toBe('Mac');
    });

    it('reports Linux for a plain X11 Linux UA', () => {
      const userAgent = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';

      expect(parseUserAgent(userAgent).device).toBe('Linux');
    });
  });

  describe('matching is case-insensitive', () => {
    it('matches regardless of the casing the client sent', () => {
      expect(parseUserAgent('MOZILLA/5.0 (IPHONE; CPU IPHONE OS 17_1) SAFARI/604.1')).toEqual({
        device: 'iPhone',
        browser: 'Safari',
      });
    });
  });

  describe('absent and unrecognised input', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['an empty string', ''],
    ])('returns both fields null for %s', (_label, userAgent) => {
      expect(parseUserAgent(userAgent)).toEqual({ device: null, browser: null });
    });

    it.each([
      ['curl', 'curl/8.4.0'],
      ['a generic bot', 'SomeCrawler/1.0 (+https://example.com/bot)'],
      ['junk', 'not-a-user-agent'],
    ])('returns null rather than a wrong guess for %s', (_label, userAgent) => {
      expect(parseUserAgent(userAgent)).toEqual({ device: null, browser: null });
    });

    it('resolves one field independently of the other', () => {
      // A recognisable platform with an unrecognisable browser must still report the platform.
      expect(
        parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) UnknownBrowser/1.0'),
      ).toEqual({ device: 'Windows', browser: null });
    });
  });
});
