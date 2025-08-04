import { jest } from '@jest/globals';
import { RateLimiter, rateLimitPresets } from '../utils/rate-limiter.js';

describe('RateLimiter', () => {
  let rateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter({
      windowMs: 1000, // 1초 (테스트용)
      max: 3,
      message: 'Rate limit exceeded'
    });
  });

  afterEach(() => {
    if (rateLimiter) {
      rateLimiter.destroy();
    }
  });

  describe('Basic Functionality', () => {
    test('should allow requests within limit', () => {
      const clientId = 'test-client';
      
      const result1 = rateLimiter.checkLimit(clientId);
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(2);

      const result2 = rateLimiter.checkLimit(clientId);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(1);

      const result3 = rateLimiter.checkLimit(clientId);
      expect(result3.allowed).toBe(true);
      expect(result3.remaining).toBe(0);
    });

    test('should block requests exceeding limit', () => {
      const clientId = 'test-client';
      
      // 제한까지 요청
      for (let i = 0; i < 3; i++) {
        rateLimiter.checkLimit(clientId);
      }

      // 제한 초과 요청
      const result = rateLimiter.checkLimit(clientId);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    test('should handle multiple clients separately', () => {
      const result1 = rateLimiter.checkLimit('client1');
      const result2 = rateLimiter.checkLimit('client2');
      
      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result1.remaining).toBe(2);
      expect(result2.remaining).toBe(2);
    });
  });

  describe('Window Reset', () => {
    test('should reset after window expires', async () => {
      const clientId = 'test-client';
      
      // 제한까지 요청
      for (let i = 0; i < 3; i++) {
        rateLimiter.checkLimit(clientId);
      }

      // 제한 초과 확인
      let result = rateLimiter.checkLimit(clientId);
      expect(result.allowed).toBe(false);

      // 윈도우 시간 대기
      await new Promise(resolve => setTimeout(resolve, 1100));

      // 다시 요청 가능해야 함
      result = rateLimiter.checkLimit(clientId);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });
  });

  describe('Status and Stats', () => {
    test('should return correct status', () => {
      const clientId = 'test-client';
      
      rateLimiter.checkLimit(clientId);
      rateLimiter.checkLimit(clientId);

      const status = rateLimiter.getStatus(clientId);
      expect(status.requests).toBe(2);
      expect(status.remaining).toBe(1);
      expect(status.resetTime).toBeTruthy();
    });

    test('should return stats', () => {
      rateLimiter.checkLimit('client1');
      rateLimiter.checkLimit('client2');

      const stats = rateLimiter.getStats();
      expect(stats.totalClients).toBe(2);
      expect(stats.windowMs).toBe(1000);
      expect(stats.maxRequests).toBe(3);
      expect(stats.activeClients).toHaveLength(2);
    });
  });

  describe('Reset and Cleanup', () => {
    test('should reset specific client', () => {
      const clientId = 'test-client';
      
      rateLimiter.checkLimit(clientId);
      rateLimiter.reset(clientId);

      const status = rateLimiter.getStatus(clientId);
      expect(status.requests).toBe(0);
      expect(status.remaining).toBe(3);
    });

    test('should reset all clients', () => {
      rateLimiter.checkLimit('client1');
      rateLimiter.checkLimit('client2');
      
      rateLimiter.reset();

      const stats = rateLimiter.getStats();
      expect(stats.totalClients).toBe(0);
    });

    test('should cleanup expired clients', async () => {
      const clientId = 'test-client';
      
      rateLimiter.checkLimit(clientId);
      
      // 윈도우 시간보다 오래 대기
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      rateLimiter.cleanup();
      
      const stats = rateLimiter.getStats();
      expect(stats.totalClients).toBe(0);
    });
  });

  describe('Skip Options', () => {
    test('should skip successful requests when configured', () => {
      const limiter = new RateLimiter({
        windowMs: 1000,
        max: 2,
        skipSuccessfulRequests: true
      });

      const result1 = limiter.checkLimit('client', true); // success
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(2); // 변화 없음

      const result2 = limiter.checkLimit('client', false); // failure
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(1); // 카운트됨

      limiter.destroy();
    });

    test('should skip failed requests when configured', () => {
      const limiter = new RateLimiter({
        windowMs: 1000,
        max: 2,
        skipFailedRequests: true
      });

      const result1 = limiter.checkLimit('client', false); // failure
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(2); // 변화 없음

      const result2 = limiter.checkLimit('client', true); // success
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(1); // 카운트됨

      limiter.destroy();
    });
  });
});

describe('Rate Limit Presets', () => {
  test('should have correct preset configurations', () => {
    expect(rateLimitPresets.strict.max).toBe(10);
    expect(rateLimitPresets.standard.max).toBe(100);
    expect(rateLimitPresets.lenient.max).toBe(500);
    expect(rateLimitPresets.upload.max).toBe(5);
    
    expect(rateLimitPresets.upload.windowMs).toBe(300000); // 5분
  });
});