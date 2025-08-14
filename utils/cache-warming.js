import { log } from './logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 사용 패턴 분석기
 */
export class UsagePatternAnalyzer {
  constructor(options = {}) {
    this.patterns = {
      temporal: new Map(),      // 시간대별 사용 패턴
      sequence: new Map(),      // 연속 사용 패턴
      frequency: new Map(),     // 사용 빈도 패턴
      user: new Map(),          // 사용자별 패턴
      context: new Map()        // 컨텍스트별 패턴
    };
    
    this.analysisWindow = options.analysisWindow || 86400000; // 24시간
    this.maxPatterns = options.maxPatterns || 1000;
    this.decayFactor = options.decayFactor || 0.95; // 일일 감쇠율
    
    this.lastCleanup = Date.now();
    this.cleanupInterval = options.cleanupInterval || 3600000; // 1시간
    
    log.info('Usage pattern analyzer initialized', {
      analysisWindow: this.analysisWindow,
      maxPatterns: this.maxPatterns,
      decayFactor: this.decayFactor
    });
  }

  /**
   * 사용 이벤트 기록
   */
  recordUsage(key, context = {}) {
    const timestamp = Date.now();
    const hour = new Date(timestamp).getHours();
    const dayOfWeek = new Date(timestamp).getDay();
    
    // 시간대별 패턴 기록
    this.recordTemporalPattern(key, hour, dayOfWeek, timestamp);
    
    // 빈도 패턴 기록
    this.recordFrequencyPattern(key, timestamp);
    
    // 사용자 패턴 기록
    if (context.userId) {
      this.recordUserPattern(context.userId, key, timestamp);
    }
    
    // 컨텍스트 패턴 기록
    if (context.operation || context.category) {
      this.recordContextPattern(key, context, timestamp);
    }
    
    // 연속 사용 패턴은 별도로 관리
    this.updateSequencePatterns(key, timestamp);
    
    // 주기적 정리
    if (timestamp - this.lastCleanup > this.cleanupInterval) {
      this.cleanupOldPatterns();
    }
  }

  /**
   * 시간대별 패턴 기록
   */
  recordTemporalPattern(key, hour, dayOfWeek, timestamp) {
    const temporalKey = `${key}:${hour}:${dayOfWeek}`;
    const existing = this.patterns.temporal.get(temporalKey) || {
      count: 0,
      lastSeen: 0,
      hourlyDistribution: new Array(24).fill(0),
      weeklyDistribution: new Array(7).fill(0)
    };
    
    existing.count++;
    existing.lastSeen = timestamp;
    existing.hourlyDistribution[hour]++;
    existing.weeklyDistribution[dayOfWeek]++;
    
    this.patterns.temporal.set(temporalKey, existing);
  }

  /**
   * 빈도 패턴 기록
   */
  recordFrequencyPattern(key, timestamp) {
    const existing = this.patterns.frequency.get(key) || {
      count: 0,
      firstSeen: timestamp,
      lastSeen: 0,
      intervals: [],
      avgInterval: 0
    };
    
    if (existing.lastSeen > 0) {
      const interval = timestamp - existing.lastSeen;
      existing.intervals.push(interval);
      
      // 최근 10개 간격만 유지
      if (existing.intervals.length > 10) {
        existing.intervals.shift();
      }
      
      // 평균 간격 계산
      existing.avgInterval = existing.intervals.reduce((a, b) => a + b, 0) / existing.intervals.length;
    }
    
    existing.count++;
    existing.lastSeen = timestamp;
    
    this.patterns.frequency.set(key, existing);
  }

  /**
   * 사용자별 패턴 기록
   */
  recordUserPattern(userId, key, timestamp) {
    const userKey = `${userId}:${key}`;
    const existing = this.patterns.user.get(userKey) || {
      count: 0,
      firstSeen: timestamp,
      lastSeen: 0,
      sessions: []
    };
    
    existing.count++;
    existing.lastSeen = timestamp;
    
    // 세션 구분 (30분 이상 간격이면 새 세션)
    const lastSession = existing.sessions[existing.sessions.length - 1];
    if (!lastSession || timestamp - lastSession.end > 1800000) {
      existing.sessions.push({
        start: timestamp,
        end: timestamp,
        count: 1
      });
    } else {
      lastSession.end = timestamp;
      lastSession.count++;
    }
    
    // 최근 10개 세션만 유지
    if (existing.sessions.length > 10) {
      existing.sessions.shift();
    }
    
    this.patterns.user.set(userKey, existing);
  }

  /**
   * 컨텍스트별 패턴 기록
   */
  recordContextPattern(key, context, timestamp) {
    const contextKey = `${key}:${context.operation || 'unknown'}:${context.category || 'default'}`;
    const existing = this.patterns.context.get(contextKey) || {
      count: 0,
      contexts: new Map(),
      lastSeen: 0
    };
    
    existing.count++;
    existing.lastSeen = timestamp;
    
    // 컨텍스트 값들 기록
    Object.entries(context).forEach(([ctxKey, ctxValue]) => {
      if (typeof ctxValue === 'string' || typeof ctxValue === 'number') {
        const ctxPattern = existing.contexts.get(ctxKey) || new Map();
        ctxPattern.set(ctxValue, (ctxPattern.get(ctxValue) || 0) + 1);
        existing.contexts.set(ctxKey, ctxPattern);
      }
    });
    
    this.patterns.context.set(contextKey, existing);
  }

  /**
   * 연속 사용 패턴 업데이트
   */
  updateSequencePatterns(key, timestamp) {
    const recentWindow = 3600000; // 1시간
    const cutoff = timestamp - recentWindow;
    
    // 최근 1시간 내 접근된 키들 찾기
    const recentKeys = Array.from(this.patterns.frequency.entries())
      .filter(([_, pattern]) => pattern.lastSeen >= cutoff)
      .map(([k, _]) => k)
      .filter(k => k !== key);
    
    // 연속 패턴 기록
    recentKeys.forEach(recentKey => {
      const sequenceKey = `${recentKey}->${key}`;
      const existing = this.patterns.sequence.get(sequenceKey) || {
        count: 0,
        strength: 0,
        lastSeen: 0
      };
      
      existing.count++;
      existing.strength = Math.min(existing.count / 100, 1); // 0-1 정규화
      existing.lastSeen = timestamp;
      
      this.patterns.sequence.set(sequenceKey, existing);
    });
  }

  /**
   * 예측 생성
   */
  generatePredictions(context = {}) {
    const now = Date.now();
    const hour = new Date(now).getHours();
    const dayOfWeek = new Date(now).getDay();
    const predictions = [];
    
    // 시간대 기반 예측
    const temporalPredictions = this.getTemporalPredictions(hour, dayOfWeek);
    predictions.push(...temporalPredictions);
    
    // 빈도 기반 예측
    const frequencyPredictions = this.getFrequencyPredictions(now);
    predictions.push(...frequencyPredictions);
    
    // 사용자 기반 예측
    if (context.userId) {
      const userPredictions = this.getUserPredictions(context.userId, now);
      predictions.push(...userPredictions);
    }
    
    // 연속 패턴 기반 예측
    if (context.lastAccessedKey) {
      const sequencePredictions = this.getSequencePredictions(context.lastAccessedKey);
      predictions.push(...sequencePredictions);
    }
    
    // 중복 제거 및 점수순 정렬
    const uniquePredictions = this.consolidatePredictions(predictions);
    
    return uniquePredictions.slice(0, 20); // 상위 20개
  }

  /**
   * 시간대 기반 예측
   */
  getTemporalPredictions(hour, dayOfWeek) {
    const predictions = [];
    
    for (const [temporalKey, pattern] of this.patterns.temporal.entries()) {
      const [key, patternHour, patternDay] = temporalKey.split(':');
      
      if (parseInt(patternHour) === hour && parseInt(patternDay) === dayOfWeek) {
        const score = pattern.count / Math.max(...pattern.hourlyDistribution);
        predictions.push({
          key,
          score: score * 0.8, // 시간대 예측 가중치
          reason: 'temporal',
          confidence: Math.min(pattern.count / 10, 1)
        });
      }
    }
    
    return predictions;
  }

  /**
   * 빈도 기반 예측
   */
  getFrequencyPredictions(now) {
    const predictions = [];
    
    for (const [key, pattern] of this.patterns.frequency.entries()) {
      if (pattern.avgInterval > 0) {
        const timeSinceLastUse = now - pattern.lastSeen;
        const expectedNextUse = pattern.avgInterval;
        
        // 다음 사용 시점에 가까울수록 높은 점수
        const proximity = Math.max(0, 1 - Math.abs(timeSinceLastUse - expectedNextUse) / expectedNextUse);
        
        if (proximity > 0.3) { // 30% 이상 근접한 경우만
          predictions.push({
            key,
            score: proximity * 0.7, // 빈도 예측 가중치
            reason: 'frequency',
            confidence: Math.min(pattern.intervals.length / 5, 1)
          });
        }
      }
    }
    
    return predictions;
  }

  /**
   * 사용자 기반 예측
   */
  getUserPredictions(userId, now) {
    const predictions = [];
    
    for (const [userKey, pattern] of this.patterns.user.entries()) {
      const [patternUserId, key] = userKey.split(':', 2);
      
      if (patternUserId === userId) {
        const recentSession = pattern.sessions[pattern.sessions.length - 1];
        if (recentSession && now - recentSession.end < 3600000) { // 1시간 이내
          const sessionActivity = recentSession.count / Math.max(...pattern.sessions.map(s => s.count));
          predictions.push({
            key,
            score: sessionActivity * 0.6, // 사용자 예측 가중치
            reason: 'user',
            confidence: Math.min(pattern.sessions.length / 3, 1)
          });
        }
      }
    }
    
    return predictions;
  }

  /**
   * 연속 패턴 기반 예측
   */
  getSequencePredictions(lastKey) {
    const predictions = [];
    
    for (const [sequenceKey, pattern] of this.patterns.sequence.entries()) {
      if (sequenceKey.startsWith(lastKey + '->')) {
        const nextKey = sequenceKey.split('->')[1];
        predictions.push({
          key: nextKey,
          score: pattern.strength * 0.9, // 연속 예측 가중치
          reason: 'sequence',
          confidence: pattern.strength
        });
      }
    }
    
    return predictions;
  }

  /**
   * 예측 결과 통합
   */
  consolidatePredictions(predictions) {
    const consolidated = new Map();
    
    predictions.forEach(pred => {
      const existing = consolidated.get(pred.key);
      if (existing) {
        // 가중 평균으로 점수 결합
        const totalConfidence = existing.confidence + pred.confidence;
        existing.score = (existing.score * existing.confidence + pred.score * pred.confidence) / totalConfidence;
        existing.confidence = Math.min(totalConfidence, 1);
        existing.reasons.push(pred.reason);
      } else {
        consolidated.set(pred.key, {
          ...pred,
          reasons: [pred.reason]
        });
      }
    });
    
    return Array.from(consolidated.values())
      .sort((a, b) => b.score - a.score);
  }

  /**
   * 오래된 패턴 정리
   */
  cleanupOldPatterns() {
    const now = Date.now();
    const cutoff = now - this.analysisWindow;
    
    // 각 패턴 타입별로 정리
    Object.values(this.patterns).forEach(patternMap => {
      for (const [key, pattern] of patternMap.entries()) {
        if (pattern.lastSeen < cutoff) {
          patternMap.delete(key);
        } else {
          // 감쇠 적용
          if (pattern.count) {
            pattern.count = Math.floor(pattern.count * this.decayFactor);
          }
        }
      }
    });
    
    this.lastCleanup = now;
    
    log.debug('Pattern cleanup completed', {
      temporal: this.patterns.temporal.size,
      sequence: this.patterns.sequence.size,
      frequency: this.patterns.frequency.size,
      user: this.patterns.user.size,
      context: this.patterns.context.size
    });
  }

  /**
   * 패턴 통계
   */
  getPatternStats() {
    return {
      temporal: this.patterns.temporal.size,
      sequence: this.patterns.sequence.size,
      frequency: this.patterns.frequency.size,
      user: this.patterns.user.size,
      context: this.patterns.context.size,
      lastCleanup: new Date(this.lastCleanup).toISOString(),
      analysisWindow: this.analysisWindow
    };
  }
}

/**
 * 지능형 캐시 워밍 시스템
 */
export class IntelligentCacheWarming {
  constructor(cache, options = {}) {
    this.cache = cache;
    this.analyzer = new UsagePatternAnalyzer(options);
    this.dataLoader = options.dataLoader; // 데이터 로딩 함수
    
    this.warmingEnabled = options.warmingEnabled !== false;
    this.warmingInterval = options.warmingInterval || 300000; // 5분
    this.maxWarmItems = options.maxWarmItems || 50;
    this.minConfidence = options.minConfidence || 0.3;
    
    this.stats = {
      warmingAttempts: 0,
      successfulWarms: 0,
      cacheHitsFromWarming: 0,
      lastWarmingTime: 0
    };
    
    if (this.warmingEnabled) {
      this.startWarming();
    }
    
    log.info('Intelligent cache warming initialized', {
      enabled: this.warmingEnabled,
      interval: this.warmingInterval,
      maxItems: this.maxWarmItems,
      minConfidence: this.minConfidence
    });
  }

  /**
   * 사용 이벤트 기록 (캐시 접근 시 호출)
   */
  recordAccess(key, context = {}) {
    this.analyzer.recordUsage(key, {
      ...context,
      timestamp: Date.now()
    });
    
    // 워밍으로 인한 캐시 히트인지 확인
    if (context.fromWarming) {
      this.stats.cacheHitsFromWarming++;
    }
  }

  /**
   * 예측적 캐시 워밍 수행
   */
  async performWarming(context = {}) {
    if (!this.warmingEnabled || !this.dataLoader) {
      return { warmed: 0, skipped: 0, errors: 0 };
    }
    
    const startTime = Date.now();
    const predictions = this.analyzer.generatePredictions(context);
    
    // 신뢰도 필터링
    const highConfidencePredictions = predictions
      .filter(pred => pred.confidence >= this.minConfidence)
      .slice(0, this.maxWarmItems);
    
    const results = {
      warmed: 0,
      skipped: 0,
      errors: 0,
      predictions: predictions.length,
      processed: highConfidencePredictions.length
    };
    
    this.stats.warmingAttempts++;
    
    // 병렬로 데이터 로딩 및 캐시 워밍
    const warmingPromises = highConfidencePredictions.map(async (prediction) => {
      try {
        // 이미 캐시에 있는지 확인
        if (this.cache.has && this.cache.has(prediction.key)) {
          results.skipped++;
          return;
        }
        
        // 데이터 로딩
        const data = await this.dataLoader(prediction.key);
        if (data !== undefined) {
          // 캐시에 저장
          await this.cache.set(prediction.key, data);
          results.warmed++;
          
          log.debug('Cache warmed', {
            key: prediction.key,
            score: prediction.score.toFixed(3),
            confidence: prediction.confidence.toFixed(3),
            reasons: prediction.reasons
          });
        } else {
          results.skipped++;
        }
      } catch (error) {
        results.errors++;
        log.warn('Cache warming error', {
          key: prediction.key,
          error: error.message
        });
      }
    });
    
    await Promise.all(warmingPromises);
    
    const duration = Date.now() - startTime;
    this.stats.lastWarmingTime = startTime;
    
    if (results.warmed > 0) {
      this.stats.successfulWarms++;
      log.info('Cache warming completed', {
        ...results,
        duration: `${duration}ms`,
        efficiency: results.warmed / results.processed
      });
    }
    
    return results;
  }

  /**
   * 주기적 워밍 시작
   */
  startWarming() {
    this.warmingTimer = setInterval(async () => {
      try {
        await this.performWarming();
      } catch (error) {
        log.error('Scheduled warming failed', { error: error.message });
      }
    }, this.warmingInterval);
    
    log.info('Scheduled cache warming started', {
      interval: this.warmingInterval
    });
  }

  /**
   * 컨텍스트 기반 즉시 워밍
   */
  async warmForContext(context) {
    return await this.performWarming(context);
  }

  /**
   * 워밍 통계
   */
  getWarmingStats() {
    const patternStats = this.analyzer.getPatternStats();
    const successRate = this.stats.warmingAttempts > 0 ? 
      (this.stats.successfulWarms / this.stats.warmingAttempts * 100).toFixed(2) + '%' : '0%';
    
    return {
      warming: {
        enabled: this.warmingEnabled,
        attempts: this.stats.warmingAttempts,
        successful: this.stats.successfulWarms,
        successRate,
        cacheHitsFromWarming: this.stats.cacheHitsFromWarming,
        lastWarming: this.stats.lastWarmingTime > 0 ? 
          new Date(this.stats.lastWarmingTime).toISOString() : null
      },
      patterns: patternStats,
      config: {
        interval: this.warmingInterval,
        maxItems: this.maxWarmItems,
        minConfidence: this.minConfidence
      }
    };
  }

  /**
   * 워밍 설정 변경
   */
  updateConfig(options) {
    if (options.warmingEnabled !== undefined) {
      this.warmingEnabled = options.warmingEnabled;
      if (this.warmingEnabled && !this.warmingTimer) {
        this.startWarming();
      } else if (!this.warmingEnabled && this.warmingTimer) {
        clearInterval(this.warmingTimer);
        this.warmingTimer = null;
      }
    }
    
    if (options.warmingInterval !== undefined) {
      this.warmingInterval = options.warmingInterval;
      if (this.warmingTimer) {
        clearInterval(this.warmingTimer);
        this.startWarming();
      }
    }
    
    if (options.maxWarmItems !== undefined) {
      this.maxWarmItems = options.maxWarmItems;
    }
    
    if (options.minConfidence !== undefined) {
      this.minConfidence = options.minConfidence;
    }
    
    log.info('Cache warming config updated', options);
  }

  /**
   * 리소스 정리
   */
  destroy() {
    if (this.warmingTimer) {
      clearInterval(this.warmingTimer);
      this.warmingTimer = null;
    }
    
    log.info('Intelligent cache warming destroyed');
  }
}

export default IntelligentCacheWarming;
