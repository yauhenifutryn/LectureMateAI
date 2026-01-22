import { describe, expect, it } from 'vitest';
import { isMobileUserAgent } from '../../utils/device';

describe('isMobileUserAgent', () => {
  it('detects iPhone user agent', () => {
    expect(
      isMobileUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
      )
    ).toBe(true);
  });

  it('detects Android user agent', () => {
    expect(
      isMobileUserAgent(
        'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120'
      )
    ).toBe(true);
  });

  it('ignores desktop user agent', () => {
    expect(
      isMobileUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15'
      )
    ).toBe(false);
  });
});
