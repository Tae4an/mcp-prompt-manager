import { log } from "./logger.js";

/**
 * Rate limiter for API endpoint protection
 * Uses in-memory storage with sliding window algorithm
 */
export class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60000; // 1분 기본값
    this.max = options.max || 100; // 요청 제한 개수
    this.message = options.message || "Too many requests, please try again later";
    this.skipSuccessfulRequests = options.skipSuccessfulRequests || false;
    this.skipFailedRequests = options.skipFailedRequests || false;
    
    // 메모리 저장소 (클라이언트 IP별 요청 추적)
    this.clients = new Map();
    
    // 정기적으로 오래된 기록 정리 (메모리 누수 방지)
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.windowMs);
  }

  /**
   * 요청 제한 확인 및 업데이트
   */
  checkLimit(clientId, success = true) {
    const now = Date.now();
    
    // 스킵 조건 확인
    if ((success && this.skipSuccessfulRequests) || 
        (!success && this.skipFailedRequests)) {
      return { allowed: true, remaining: this.max };
    }

    let clientData = this.clients.get(clientId);
    
    if (!clientData) {
      clientData = {
        requests: [],
        firstRequest: now
      };
      this.clients.set(clientId, clientData);
    }

    // 윈도우 범위 내의 요청만 유지
    const windowStart = now - this.windowMs;
    clientData.requests = clientData.requests.filter(time => time > windowStart);

    // 제한 확인
    if (clientData.requests.length >= this.max) {
      const resetTime = clientData.requests[0] + this.windowMs;
      
      log.warn('Rate limit exceeded', {
        clientId,
        requests: clientData.requests.length,
        max: this.max,
        resetTime: new Date(resetTime).toISOString()
      });

      return {
        allowed: false,
        remaining: 0,
        resetTime,
        retryAfter: Math.ceil((resetTime - now) / 1000)
      };
    }

    // 요청 기록 추가
    clientData.requests.push(now);
    
    return {
      allowed: true,
      remaining: this.max - clientData.requests.length,
      resetTime: clientData.requests[0] + this.windowMs
    };
  }

  /**
   * 특정 클라이언트의 제한 상태 조회
   */
  getStatus(clientId) {
    const clientData = this.clients.get(clientId);
    if (!clientData) {
      return {
        requests: 0,
        remaining: this.max,
        resetTime: null
      };
    }

    const now = Date.now();
    const windowStart = now - this.windowMs;
    const validRequests = clientData.requests.filter(time => time > windowStart);

    return {
      requests: validRequests.length,
      remaining: this.max - validRequests.length,
      resetTime: validRequests.length > 0 ? validRequests[0] + this.windowMs : null
    };
  }

  /**
   * 특정 클라이언트의 제한 초기화
   */
  reset(clientId) {
    if (clientId) {
      this.clients.delete(clientId);
      log.info('Rate limit reset for client', { clientId });
    } else {
      this.clients.clear();
      log.info('Rate limit reset for all clients');
    }
  }

  /**
   * 오래된 클라이언트 데이터 정리
   */
  cleanup() {
    const now = Date.now();
    const expiredClients = [];

    for (const [clientId, clientData] of this.clients.entries()) {
      const windowStart = now - this.windowMs;
      clientData.requests = clientData.requests.filter(time => time > windowStart);
      
      // 윈도우 시간보다 오래된 클라이언트 데이터 제거
      if (clientData.requests.length === 0 && 
          clientData.firstRequest < windowStart) {
        expiredClients.push(clientId);
      }
    }

    expiredClients.forEach(clientId => {
      this.clients.delete(clientId);
    });

    if (expiredClients.length > 0) {
      log.debug('Cleaned up expired rate limit data', {
        expiredClientsCount: expiredClients.length,
        totalClients: this.clients.size
      });
    }
  }

  /**
   * 현재 통계 조회
   */
  getStats() {
    return {
      totalClients: this.clients.size,
      windowMs: this.windowMs,
      maxRequests: this.max,
      activeClients: Array.from(this.clients.entries()).map(([clientId, data]) => ({
        clientId,
        requests: data.requests.length,
        firstRequest: new Date(data.firstRequest).toISOString()
      }))
    };
  }

  /**
   * Rate limiter 정리 (메모리 누수 방지)
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clients.clear();
    log.info('Rate limiter destroyed');
  }
}

/**
 * 미들웨어 팩터리 함수
 */
export function createRateLimitMiddleware(options = {}) {
  const limiter = new RateLimiter(options);
  
  return (req, res, next) => {
    // 클라이언트 식별 (IP 주소 기반)
    const clientId = req.ip || 
                    req.connection?.remoteAddress || 
                    req.socket?.remoteAddress ||
                    'unknown';

    const result = limiter.checkLimit(clientId);

    // 응답 헤더 설정
    res.set({
      'X-RateLimit-Limit': limiter.max,
      'X-RateLimit-Remaining': result.remaining,
      'X-RateLimit-Reset': result.resetTime ? Math.ceil(result.resetTime / 1000) : ''
    });

    if (!result.allowed) {
      res.set({
        'Retry-After': result.retryAfter
      });
      
      return res.status(429).json({
        error: limiter.message,
        retryAfter: result.retryAfter
      });
    }

    next();
  };
}

/**
 * 사전 정의된 제한 설정들
 */
export const rateLimitPresets = {
  // 엄격한 제한 (개발/테스트 환경)
  strict: {
    windowMs: 60000,    // 1분
    max: 10,            // 10 요청
    message: "요청이 너무 많습니다. 1분 후 다시 시도해주세요."
  },
  
  // 일반적인 제한 (프로덕션 환경)
  standard: {
    windowMs: 60000,    // 1분  
    max: 100,           // 100 요청
    message: "요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요."
  },
  
  // 관대한 제한 (내부 API)
  lenient: {
    windowMs: 60000,    // 1분
    max: 500,           // 500 요청
    message: "서버 부하가 높습니다. 잠시 후 다시 시도해주세요."
  },
  
  // 파일 업로드용 제한
  upload: {
    windowMs: 300000,   // 5분
    max: 5,             // 5 요청
    message: "파일 업로드 요청이 너무 많습니다. 5분 후 다시 시도해주세요."
  }
};

export default RateLimiter;