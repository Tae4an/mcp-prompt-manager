import { log } from './logger.js';
import { templateEngine } from './template-engine.js';
import { inputSanitizer } from './input-sanitizer.js';

/**
 * 프롬프트 템플릿 라이브러리
 * 자주 사용되는 프롬프트 템플릿들을 제공하고 관리하는 시스템
 */
export class TemplateLibrary {
  constructor() {
    // 기본 템플릿 카테고리와 템플릿들
    this.templates = {
      // 코딩 관련 템플릿
      coding: {
        name: "코딩 & 개발",
        description: "프로그래밍 및 소프트웨어 개발 관련 템플릿",
        templates: {
          "code-review": {
            name: "코드 리뷰",
            description: "코드를 검토하고 개선점을 제안하는 템플릿",
            template: `다음 {{#if language}}{{language}} {{/if}}코드를 리뷰해주세요:

{{#if context}}
**컨텍스트**: {{context}}
{{/if}}

\`\`\`{{#if language}}{{language}}{{/if}}
{{code}}
\`\`\`

{{#if focus}}
**특히 다음 사항에 집중해서 검토해주세요:**
{{#each focus}}
- {{this}}
{{/each}}
{{/if}}

다음 관점에서 리뷰해주세요:
- 코드 품질 및 가독성
- 성능 최적화 가능성
- 보안 취약점
- 버그 가능성
- 개선 제안사항`,
            variables: ["code", "language", "context", "focus"],
            category: "coding",
            tags: ["review", "quality", "improvement"]
          },
          
          "debug-help": {
            name: "디버깅 도움",
            description: "버그나 오류를 해결하는데 도움을 받는 템플릿",
            template: `다음 {{#if language}}{{language}} {{/if}}코드에서 문제가 발생했습니다. 도와주세요:

**문제 설명:**
{{problem}}

{{#if error_message}}
**에러 메시지:**
\`\`\`
{{error_message}}
\`\`\`
{{/if}}

**코드:**
\`\`\`{{#if language}}{{language}}{{/if}}
{{code}}
\`\`\`

{{#if expected_behavior}}
**기대한 동작:**
{{expected_behavior}}
{{/if}}

{{#if actual_behavior}}
**실제 동작:**
{{actual_behavior}}
{{/if}}

{{#if tried_solutions}}
**시도해본 해결방법:**
{{#each tried_solutions}}
- {{this}}
{{/each}}
{{/if}}

문제를 분석하고 해결방법을 제시해주세요.`,
            variables: ["problem", "code", "language", "error_message", "expected_behavior", "actual_behavior", "tried_solutions"],
            category: "coding",
            tags: ["debug", "troubleshooting", "error"]
          },

          "api-documentation": {
            name: "API 문서화",
            description: "API 엔드포인트를 문서화하는 템플릿",
            template: `# {{api_name}} API 문서

## 개요
{{#if description}}{{description}}{{/if}}

## 엔드포인트: {{method}} {{endpoint}}

{{#if auth_required}}
### 인증
이 API는 인증이 필요합니다: {{auth_type}}
{{/if}}

### 요청 파라미터
{{#if parameters}}
{{#each parameters}}
- **{{name}}** ({{type}}) {{#if required}}*필수*{{else}}*선택*{{/if}}: {{description}}
{{/each}}
{{else}}
파라미터 없음
{{/if}}

### 응답 예시
\`\`\`json
{{response_example}}
\`\`\`

{{#if error_codes}}
### 에러 코드
{{#each error_codes}}
- **{{code}}**: {{description}}
{{/each}}
{{/if}}

{{#if usage_example}}
### 사용 예시
\`\`\`{{example_language}}
{{usage_example}}
\`\`\`
{{/if}}`,
            variables: ["api_name", "method", "endpoint", "description", "auth_required", "auth_type", "parameters", "response_example", "error_codes", "usage_example", "example_language"],
            category: "coding",
            tags: ["api", "documentation", "specification"]
          }
        }
      },

      // 번역 관련 템플릿
      translation: {
        name: "번역 & 언어",
        description: "다양한 언어 번역 및 언어 관련 작업 템플릿",
        templates: {
          "translate-text": {
            name: "텍스트 번역",
            description: "텍스트를 다른 언어로 번역하는 템플릿",
            template: `다음 {{source_lang}}을 {{target_lang}}로 번역해주세요:

{{#if context}}
**맥락**: {{context}}
{{/if}}

{{#if tone}}
**번역 톤**: {{tone}} (예: 정중한, 친근한, 전문적인)
{{/if}}

**원문:**
{{text}}

{{#if preserve_format}}
**주의사항**: 원본의 서식과 구조를 유지해주세요.
{{/if}}

{{#if technical_terms}}
**전문용어 참고:**
{{#each technical_terms}}
- {{original}} → {{translation}}
{{/each}}
{{/if}}`,
            variables: ["text", "source_lang", "target_lang", "context", "tone", "preserve_format", "technical_terms"],
            category: "translation",
            tags: ["translate", "language", "localization"]
          },

          "grammar-check": {
            name: "문법 검사",
            description: "텍스트의 문법과 맞춤법을 검사하는 템플릿",
            template: `다음 {{#if language}}{{language}} {{/if}}텍스트의 문법과 맞춤법을 검사하고 수정해주세요:

**원문:**
{{text}}

{{#if writing_style}}
**글쓰기 스타일**: {{writing_style}}
{{/if}}

{{#if target_audience}}
**대상 독자**: {{target_audience}}
{{/if}}

다음 사항을 확인해주세요:
- 맞춤법 오류
- 문법 오류  
- 문장 구조 개선
- 어휘 선택 최적화
- 전체적인 읽기 흐름

수정된 텍스트와 함께 주요 수정사항을 설명해주세요.`,
            variables: ["text", "language", "writing_style", "target_audience"],
            category: "translation",
            tags: ["grammar", "proofread", "correction"]
          }
        }
      },

      // 문서 작성 관련 템플릿
      writing: {
        name: "문서 작성",
        description: "다양한 종류의 문서 작성을 위한 템플릿",
        templates: {
          "summarize-document": {
            name: "문서 요약",
            description: "긴 문서나 텍스트를 요약하는 템플릿",
            template: `다음 문서를 {{#if length}}{{length}} {{#if length_unit}}{{length_unit}}{{else}}문장{{/if}}으로{{else}}간결하게{{/if}} 요약해주세요:

{{#if document_type}}
**문서 유형**: {{document_type}}
{{/if}}

{{#if focus_areas}}
**요약 시 중점사항:**
{{#each focus_areas}}
- {{this}}
{{/each}}
{{/if}}

**원본 문서:**
{{document}}

{{#if include_key_points}}
요약과 함께 핵심 포인트를 불릿 포인트로 정리해주세요.
{{/if}}

{{#if target_audience}}
**대상 독자**: {{target_audience}}에 맞게 요약해주세요.
{{/if}}`,
            variables: ["document", "length", "length_unit", "document_type", "focus_areas", "include_key_points", "target_audience"],
            category: "writing",
            tags: ["summary", "analysis", "document"]
          },

          "meeting-minutes": {
            name: "회의록 작성",
            description: "회의 내용을 정리한 회의록을 작성하는 템플릿",
            template: `# {{meeting_title}} 회의록

**일시**: {{date}} {{time}}
**장소**: {{#if location}}{{location}}{{else}}온라인{{/if}}
**참석자**: {{attendees}}
{{#if absent}}**불참자**: {{absent}}{{/if}}

## 안건 및 논의사항

{{#each agenda_items}}
### {{@index}}.{{title}}
**논의 내용:**
{{discussion}}

{{#if decisions}}
**결정사항:**
{{#each decisions}}
- {{this}}
{{/each}}
{{/if}}

{{#if action_items}}
**액션 아이템:**
{{#each action_items}}
- {{task}} (담당자: {{assignee}}, 기한: {{due_date}})
{{/each}}
{{/if}}

{{/each}}

## 다음 회의
{{#if next_meeting}}
**일정**: {{next_meeting.date}} {{next_meeting.time}}
**안건**: {{next_meeting.agenda}}
{{/if}}

---
*작성자: {{recorder}}*
*작성일: {{today}}*`,
            variables: ["meeting_title", "date", "time", "location", "attendees", "absent", "agenda_items", "next_meeting", "recorder", "today"],
            category: "writing",
            tags: ["meeting", "minutes", "documentation"]
          }
        }
      },

      // 분석 관련 템플릿
      analysis: {
        name: "분석 & 리서치",
        description: "데이터 분석, 리서치 및 평가를 위한 템플릿",
        templates: {
          "swot-analysis": {
            name: "SWOT 분석",
            description: "강점, 약점, 기회, 위협 요소를 분석하는 템플릿",
            template: `# {{subject}} SWOT 분석

{{#if description}}
## 분석 대상 개요
{{description}}
{{/if}}

## SWOT 분석 결과

### 강점 (Strengths)
{{#if strengths}}
{{#each strengths}}
- {{this}}
{{/each}}
{{else}}
*분석 대상의 내부적 강점을 나열해주세요*
{{/if}}

### 약점 (Weaknesses)  
{{#if weaknesses}}
{{#each weaknesses}}
- {{this}}
{{/each}}
{{else}}
*분석 대상의 내부적 약점을 나열해주세요*
{{/if}}

### 기회 (Opportunities)
{{#if opportunities}}
{{#each opportunities}}
- {{this}}
{{/each}}
{{else}}
*외부 환경에서 오는 기회 요소들을 나열해주세요*
{{/if}}

### 위협 (Threats)
{{#if threats}}
{{#each threats}}
- {{this}}
{{/each}}
{{else}}
*외부 환경에서 오는 위협 요소들을 나열해주세요*
{{/if}}

## 전략적 시사점
{{#if implications}}
{{implications}}
{{else}}
*SWOT 분석 결과를 바탕으로 전략적 권장사항을 제시해주세요*
{{/if}}`,
            variables: ["subject", "description", "strengths", "weaknesses", "opportunities", "threats", "implications"],
            category: "analysis",
            tags: ["swot", "strategy", "analysis"]
          },

          "competitive-analysis": {
            name: "경쟁사 분석",
            description: "경쟁사를 분석하고 비교하는 템플릿",
            template: `# {{company_name}} 경쟁사 분석

## 분석 개요
**분석 대상**: {{competitors}}
**분석 기준일**: {{analysis_date}}
**분석 목적**: {{#if purpose}}{{purpose}}{{else}}시장 포지셔닝 및 경쟁 우위 확인{{/if}}

## 경쟁사 비교 분석

{{#each competitors}}
### {{name}}

**기본 정보:**
- 설립: {{founded}}
- 규모: {{size}}
- 주요 시장: {{market}}

**제품/서비스:**
{{#each products}}
- {{name}}: {{description}}
{{/each}}

**강점:**
{{#each strengths}}
- {{this}}
{{/each}}

**약점:**
{{#each weaknesses}}
- {{this}}
{{/each}}

**시장 점유율**: {{market_share}}
**예상 매출**: {{revenue}}

---
{{/each}}

## 벤치마킹 포인트
{{#if benchmarks}}
{{#each benchmarks}}
- **{{category}}**: {{description}}
{{/each}}
{{/if}}

## 시사점 및 권장사항
{{#if recommendations}}
{{recommendations}}
{{else}}
*경쟁사 분석 결과를 바탕으로 전략적 권장사항을 작성해주세요*
{{/if}}`,
            variables: ["company_name", "competitors", "analysis_date", "purpose", "benchmarks", "recommendations"],
            category: "analysis",
            tags: ["competition", "market", "benchmark"]
          }
        }
      },

      // 교육 관련 템플릿
      education: {
        name: "교육 & 학습",
        description: "학습, 교육 콘텐츠 제작을 위한 템플릿",
        templates: {
          "lesson-plan": {
            name: "수업 계획서",
            description: "체계적인 수업 계획을 세우는 템플릿",
            template: `# {{subject}} 수업 계획서

## 수업 정보
- **과목**: {{subject}}
- **대상**: {{target_audience}}
- **수업 시간**: {{duration}}
- **수업 일시**: {{date}}

## 학습 목표
{{#each learning_objectives}}
- {{this}}
{{/each}}

## 사전 준비사항
{{#if prerequisites}}
**학습자 사전 지식:**
{{#each prerequisites}}
- {{this}}
{{/each}}
{{/if}}

{{#if materials}}
**준비물:**
{{#each materials}}
- {{this}}
{{/each}}
{{/if}}

## 수업 진행 계획

{{#each activities}}
### {{@index}}. {{title}} ({{duration}}분)

**활동 내용:**
{{description}}

{{#if materials_needed}}
**필요 자료:** {{materials_needed}}
{{/if}}

{{#if interaction_type}}
**수업 방식:** {{interaction_type}}
{{/if}}

---
{{/each}}

## 평가 방법
{{#if assessment}}
{{assessment}}
{{else}}
*학습 목표 달성도를 확인할 평가 방법을 기술해주세요*
{{/if}}

## 과제 및 후속 활동
{{#if homework}}
{{homework}}
{{/if}}

{{#if next_lesson}}
**다음 수업 예고:** {{next_lesson}}
{{/if}}`,
            variables: ["subject", "target_audience", "duration", "date", "learning_objectives", "prerequisites", "materials", "activities", "assessment", "homework", "next_lesson"],
            category: "education",
            tags: ["lesson", "teaching", "curriculum"]
          },

          "quiz-generator": {
            name: "퀴즈 생성기",
            description: "학습 내용에 대한 퀴즈를 생성하는 템플릿",
            template: `# {{topic}} 퀴즈

{{#if instructions}}
## 퀴즈 안내
{{instructions}}
{{/if}}

**주제**: {{topic}}
**난이도**: {{#if difficulty}}{{difficulty}}{{else}}중급{{/if}}
**문제 수**: {{#if question_count}}{{question_count}}개{{else}}10개{{/if}}
**제한 시간**: {{#if time_limit}}{{time_limit}}{{else}}제한 없음{{/if}}

---

{{#each questions}}
## 문제 {{@index}}

{{#if type === "multiple_choice"}}
**{{question}}**

{{#each options}}
{{@index}}. {{this}}
{{/each}}

{{#if show_answers}}
*정답: {{correct_answer}}*
{{#if explanation}}
*해설: {{explanation}}*
{{/if}}
{{/if}}

{{else if type === "true_false"}}
**{{question}}** (O/X)

{{#if show_answers}}
*정답: {{#if correct_answer}}O{{else}}X{{/if}}*
{{#if explanation}}
*해설: {{explanation}}*
{{/if}}
{{/if}}

{{else if type === "short_answer"}}
**{{question}}**

{{#if show_answers}}
*답안 예시: {{sample_answer}}*
{{#if explanation}}
*해설: {{explanation}}*
{{/if}}
{{/if}}

{{else}}
**{{question}}**

{{#if show_answers}}
*답안: {{answer}}*
{{#if explanation}}
*해설: {{explanation}}*
{{/if}}
{{/if}}
{{/if}}

---
{{/each}}

{{#if show_answers}}
## 채점 기준
- 객관식: 문제당 {{points_per_multiple_choice}}점
- 주관식: 문제당 {{points_per_subjective}}점
- 총점: {{total_points}}점
{{/if}}`,
            variables: ["topic", "difficulty", "question_count", "time_limit", "instructions", "questions", "show_answers", "points_per_multiple_choice", "points_per_subjective", "total_points"],
            category: "education",
            tags: ["quiz", "assessment", "learning"]
          }
        }
      }
    };

    // 템플릿 검색을 위한 인덱스
    this.searchIndex = this.buildSearchIndex();
  }

  /**
   * 검색 인덱스 구축
   */
  buildSearchIndex() {
    const index = [];
    
    for (const [categoryId, category] of Object.entries(this.templates)) {
      for (const [templateId, template] of Object.entries(category.templates)) {
        index.push({
          id: `${categoryId}.${templateId}`,
          categoryId,
          categoryName: category.name,
          templateId,
          name: template.name,
          description: template.description,
          template: template.template,
          variables: template.variables || [],
          tags: template.tags || [],
          searchText: `${template.name} ${template.description} ${template.tags?.join(' ') || ''}`.toLowerCase()
        });
      }
    }
    
    return index;
  }

  /**
   * 모든 카테고리 목록 조회
   */
  getCategories() {
    return Object.entries(this.templates).map(([id, category]) => ({
      id,
      name: category.name,
      description: category.description,
      templateCount: Object.keys(category.templates).length
    }));
  }

  /**
   * 특정 카테고리의 템플릿 목록 조회
   */
  getTemplatesByCategory(categoryId) {
    const category = this.templates[categoryId];
    if (!category) {
      throw new Error(`카테고리를 찾을 수 없습니다: ${categoryId}`);
    }

    return Object.entries(category.templates).map(([id, template]) => ({
      id: `${categoryId}.${id}`,
      categoryId,
      templateId: id,
      name: template.name,
      description: template.description,
      variables: template.variables || [],
      tags: template.tags || []
    }));
  }

  /**
   * 특정 템플릿 상세 정보 조회
   */
  getTemplate(templateId) {
    const [categoryId, templateName] = templateId.split('.');
    const category = this.templates[categoryId];
    
    if (!category || !category.templates[templateName]) {
      throw new Error(`템플릿을 찾을 수 없습니다: ${templateId}`);
    }

    const template = category.templates[templateName];
    return {
      id: templateId,
      categoryId,
      categoryName: category.name,
      templateId: templateName,
      name: template.name,
      description: template.description,
      template: template.template,
      variables: template.variables || [],
      tags: template.tags || [],
      category: category.name
    };
  }

  /**
   * 템플릿 검색
   */
  searchTemplates(query, options = {}) {
    const {
      category = null,
      tags = [],
      limit = 10,
      threshold = 0.3
    } = options;

    let results = this.searchIndex;

    // 카테고리 필터링
    if (category) {
      results = results.filter(item => item.categoryId === category);
    }

    // 태그 필터링
    if (tags.length > 0) {
      results = results.filter(item => 
        tags.some(tag => item.tags.includes(tag.toLowerCase()))
      );
    }

    // 텍스트 검색
    if (query && query.trim()) {
      const searchQuery = query.toLowerCase();
      results = results.filter(item => {
        return item.searchText.includes(searchQuery) ||
               item.name.toLowerCase().includes(searchQuery) ||
               item.description.toLowerCase().includes(searchQuery);
      }).map(item => {
        // 간단한 점수 계산
        let score = 0;
        if (item.name.toLowerCase().includes(searchQuery)) score += 2;
        if (item.description.toLowerCase().includes(searchQuery)) score += 1;
        if (item.searchText.includes(searchQuery)) score += 0.5;
        
        return { ...item, score };
      }).sort((a, b) => b.score - a.score);
    }

    return results.slice(0, limit);
  }

  /**
   * 템플릿 렌더링
   */
  renderTemplate(templateId, variables = {}, options = {}) {
    const template = this.getTemplate(templateId);
    
    // 변수 정제
    const sanitizedVariables = inputSanitizer.sanitizeObject(variables, {
      maxDepth: 5,
      maxKeys: 50,
      maxStringLength: 10000
    });

    try {
      const result = templateEngine.render(template.template, sanitizedVariables, {
        maxIterations: 100,
        sanitizeOutput: true,
        ...options
      });

      log.info('Template rendered successfully', {
        templateId,
        variableCount: Object.keys(variables).length,
        outputLength: result.length
      });

      return {
        templateId,
        templateName: template.name,
        renderedContent: result,
        usedVariables: Object.keys(sanitizedVariables),
        requiredVariables: template.variables,
        missingVariables: template.variables.filter(v => 
          !Object.keys(sanitizedVariables).includes(v)
        )
      };
    } catch (error) {
      log.error('Template rendering failed', {
        templateId,
        error: error.message,
        variables: Object.keys(variables)
      });
      throw new Error(`템플릿 렌더링 실패: ${error.message}`);
    }
  }

  /**
   * 템플릿 유효성 검사
   */
  validateTemplate(templateId) {
    const template = this.getTemplate(templateId);
    return templateEngine.validate(template.template);
  }

  /**
   * 인기 템플릿 조회 (태그 기반)
   */
  getPopularTemplates(limit = 5) {
    // 태그 수가 많은 템플릿을 인기 템플릿으로 간주
    return this.searchIndex
      .sort((a, b) => b.tags.length - a.tags.length)
      .slice(0, limit);
  }

  /**
   * 관련 템플릿 추천
   */
  getRelatedTemplates(templateId, limit = 3) {
    const template = this.getTemplate(templateId);
    const templateTags = template.tags;

    return this.searchIndex
      .filter(item => item.id !== templateId)
      .map(item => {
        // 공통 태그 수 계산
        const commonTags = item.tags.filter(tag => templateTags.includes(tag));
        return {
          ...item,
          relevanceScore: commonTags.length
        };
      })
      .filter(item => item.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  /**
   * 템플릿 통계 정보
   */
  getStatistics() {
    const categories = this.getCategories();
    const totalTemplates = this.searchIndex.length;
    const allTags = [...new Set(this.searchIndex.flatMap(item => item.tags))];
    
    const categoryStats = categories.map(cat => ({
      ...cat,
      percentage: ((cat.templateCount / totalTemplates) * 100).toFixed(1)
    }));

    return {
      totalTemplates,
      totalCategories: categories.length,
      totalTags: allTags.length,
      categories: categoryStats,
      mostCommonTags: this.getMostCommonTags(5)
    };
  }

  /**
   * 가장 많이 사용되는 태그 조회
   */
  getMostCommonTags(limit = 10) {
    const tagCounts = {};
    
    this.searchIndex.forEach(item => {
      item.tags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });

    return Object.entries(tagCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([tag, count]) => ({ tag, count }));
  }
}

/**
 * 싱글톤 인스턴스
 */
export const templateLibrary = new TemplateLibrary();

export default TemplateLibrary;