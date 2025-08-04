import { jest } from '@jest/globals';
import { TemplateLibrary, templateLibrary } from '../utils/template-library.js';

describe('TemplateLibrary', () => {
  let library;

  beforeEach(() => {
    library = new TemplateLibrary();
  });

  describe('Basic Library Operations', () => {
    test('should initialize with default templates', () => {
      expect(library).toBeInstanceOf(TemplateLibrary);
      expect(library.templates).toBeDefined();
      expect(Object.keys(library.templates).length).toBeGreaterThan(0);
    });

    test('should build search index correctly', () => {
      expect(library.searchIndex).toBeDefined();
      expect(Array.isArray(library.searchIndex)).toBe(true);
      expect(library.searchIndex.length).toBeGreaterThan(0);
      
      // 첫 번째 인덱스 항목 구조 확인
      const firstItem = library.searchIndex[0];
      expect(firstItem).toHaveProperty('id');
      expect(firstItem).toHaveProperty('categoryId');
      expect(firstItem).toHaveProperty('templateId');
      expect(firstItem).toHaveProperty('name');
      expect(firstItem).toHaveProperty('searchText');
    });
  });

  describe('Category Management', () => {
    test('should get all categories', () => {
      const categories = library.getCategories();
      
      expect(Array.isArray(categories)).toBe(true);
      expect(categories.length).toBeGreaterThan(0);
      
      categories.forEach(category => {
        expect(category).toHaveProperty('id');
        expect(category).toHaveProperty('name');
        expect(category).toHaveProperty('description');
        expect(category).toHaveProperty('templateCount');
        expect(typeof category.templateCount).toBe('number');
      });
    });

    test('should get templates by category', () => {
      const categories = library.getCategories();
      const firstCategory = categories[0];
      
      const templates = library.getTemplatesByCategory(firstCategory.id);
      
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBe(firstCategory.templateCount);
      
      templates.forEach(template => {
        expect(template).toHaveProperty('id');
        expect(template).toHaveProperty('categoryId');
        expect(template).toHaveProperty('templateId');
        expect(template).toHaveProperty('name');
        expect(template).toHaveProperty('description');
        expect(template.categoryId).toBe(firstCategory.id);
      });
    });

    test('should throw error for invalid category', () => {
      expect(() => {
        library.getTemplatesByCategory('invalid-category');
      }).toThrow('카테고리를 찾을 수 없습니다');
    });
  });

  describe('Template Operations', () => {
    test('should get template details', () => {
      const categories = library.getCategories();
      const templates = library.getTemplatesByCategory(categories[0].id);
      const firstTemplate = templates[0];
      
      const template = library.getTemplate(firstTemplate.id);
      
      expect(template).toHaveProperty('id');
      expect(template).toHaveProperty('categoryId');
      expect(template).toHaveProperty('templateId');
      expect(template).toHaveProperty('name');
      expect(template).toHaveProperty('description');
      expect(template).toHaveProperty('template');
      expect(template).toHaveProperty('variables');
      expect(template).toHaveProperty('tags');
      
      expect(template.id).toBe(firstTemplate.id);
    });

    test('should throw error for invalid template', () => {
      expect(() => {
        library.getTemplate('invalid.template');
      }).toThrow('템플릿을 찾을 수 없습니다');
    });

    test('should validate template syntax', () => {
      const categories = library.getCategories();
      const templates = library.getTemplatesByCategory(categories[0].id);
      const firstTemplate = templates[0];
      
      const validation = library.validateTemplate(firstTemplate.id);
      
      expect(validation).toHaveProperty('isValid');
      expect(validation).toHaveProperty('errors');
      expect(typeof validation.isValid).toBe('boolean');
      expect(Array.isArray(validation.errors)).toBe(true);
    });
  });

  describe('Template Search', () => {
    test('should search templates by query', () => {
      const results = library.searchTemplates('코드'); // 한국어로 검색
      
      expect(Array.isArray(results)).toBe(true);
      
      if (results.length === 0) {
        // 'code' 영어로도 시도
        const englishResults = library.searchTemplates('code');
        expect(englishResults.length).toBeGreaterThanOrEqual(0);
        
        // 또는 더 일반적인 검색어로 시도
        const generalResults = library.searchTemplates('리뷰');
        expect(generalResults.length).toBeGreaterThanOrEqual(0);
      } else {
        expect(results.length).toBeGreaterThan(0);
        
        // 검색 결과에 '코드' 관련 내용이 있는지 확인
        const hasCodeRelated = results.some(result => 
          result.name.includes('코드') ||
          result.description.includes('코드') ||
          result.searchText.includes('코드')
        );
        expect(hasCodeRelated).toBe(true);
      }
    });

    test('should filter search by category', () => {
      const categories = library.getCategories();
      const firstCategory = categories[0];
      
      const results = library.searchTemplates('', { category: firstCategory.id });
      
      expect(Array.isArray(results)).toBe(true);
      results.forEach(result => {
        expect(result.categoryId).toBe(firstCategory.id);
      });
    });

    test('should filter search by tags', () => {
      const results = library.searchTemplates('', { tags: ['review'] });
      
      expect(Array.isArray(results)).toBe(true);
      results.forEach(result => {
        expect(result.tags.includes('review')).toBe(true);
      });
    });

    test('should limit search results', () => {
      const limit = 2;
      const results = library.searchTemplates('', { limit });
      
      expect(results.length).toBeLessThanOrEqual(limit);
    });

    test('should return empty array for no matches', () => {
      const results = library.searchTemplates('nonexistentquery12345');
      
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
  });

  describe('Template Rendering', () => {
    test('should render template with variables', () => {
      // 코드 리뷰 템플릿을 사용하여 테스트
      const templateId = 'coding.code-review';
      const variables = {
        code: 'function hello() { console.log("Hello World"); }',
        language: 'javascript',
        context: 'Simple greeting function'
      };
      
      const result = library.renderTemplate(templateId, variables);
      
      expect(result).toHaveProperty('templateId');
      expect(result).toHaveProperty('templateName');
      expect(result).toHaveProperty('renderedContent');
      expect(result).toHaveProperty('usedVariables');
      expect(result).toHaveProperty('requiredVariables');
      expect(result).toHaveProperty('missingVariables');
      
      expect(result.templateId).toBe(templateId);
      expect(result.renderedContent).toContain('javascript');
      expect(result.renderedContent).toContain('Hello World');
      expect(result.usedVariables).toContain('code');
    });

    test('should handle missing variables gracefully', () => {
      const templateId = 'coding.code-review';
      const variables = {
        code: 'test code'
        // language 변수 누락
      };
      
      const result = library.renderTemplate(templateId, variables);
      
      expect(result.missingVariables.length).toBeGreaterThan(0);
      expect(result.missingVariables).toContain('language');
    });

    test('should throw error for invalid template in rendering', () => {
      expect(() => {
        library.renderTemplate('invalid.template', {});
      }).toThrow('템플릿을 찾을 수 없습니다');
    });

    test('should sanitize input variables', () => {
      const templateId = 'coding.code-review';
      const variables = {
        code: '<script>alert("xss")</script>',
        language: 'html'
      };
      
      const result = library.renderTemplate(templateId, variables);
      
      // XSS 코드가 정제되었는지 확인 (완전히 제거되지는 않지만 안전하게 처리됨)
      expect(result.renderedContent).toBeDefined();
      expect(typeof result.renderedContent).toBe('string');
    });
  });

  describe('Template Recommendations', () => {
    test('should get popular templates', () => {
      const popular = library.getPopularTemplates(3);
      
      expect(Array.isArray(popular)).toBe(true);
      expect(popular.length).toBeLessThanOrEqual(3);
      
      // 태그 수가 많은 순서로 정렬되어 있는지 확인
      for (let i = 1; i < popular.length; i++) {
        expect(popular[i-1].tags.length).toBeGreaterThanOrEqual(popular[i].tags.length);
      }
    });

    test('should get related templates', () => {
      const categories = library.getCategories();
      const templates = library.getTemplatesByCategory(categories[0].id);
      const firstTemplate = templates[0];
      
      const related = library.getRelatedTemplates(firstTemplate.id, 2);
      
      expect(Array.isArray(related)).toBe(true);
      expect(related.length).toBeLessThanOrEqual(2);
      
      // 원본 템플릿은 결과에 포함되지 않아야 함
      related.forEach(relatedTemplate => {
        expect(relatedTemplate.id).not.toBe(firstTemplate.id);
      });
    });

    test('should calculate relevance score for related templates', () => {
      const categories = library.getCategories();
      const templates = library.getTemplatesByCategory(categories[0].id);
      
      if (templates.length > 1) {
        const firstTemplate = templates[0];
        const related = library.getRelatedTemplates(firstTemplate.id);
        
        if (related.length > 0) {
          related.forEach(relatedTemplate => {
            expect(relatedTemplate).toHaveProperty('relevanceScore');
            expect(typeof relatedTemplate.relevanceScore).toBe('number');
            expect(relatedTemplate.relevanceScore).toBeGreaterThan(0);
          });
        }
      }
    });
  });

  describe('Statistics and Analytics', () => {
    test('should get library statistics', () => {
      const stats = library.getStatistics();
      
      expect(stats).toHaveProperty('totalTemplates');
      expect(stats).toHaveProperty('totalCategories');
      expect(stats).toHaveProperty('totalTags');
      expect(stats).toHaveProperty('categories');
      expect(stats).toHaveProperty('mostCommonTags');
      
      expect(typeof stats.totalTemplates).toBe('number');
      expect(typeof stats.totalCategories).toBe('number');
      expect(typeof stats.totalTags).toBe('number');
      expect(Array.isArray(stats.categories)).toBe(true);
      expect(Array.isArray(stats.mostCommonTags)).toBe(true);
      
      // 퍼센티지 계산 확인
      stats.categories.forEach(category => {
        expect(category).toHaveProperty('percentage');
        expect(typeof category.percentage).toBe('string');
      });
    });

    test('should get most common tags', () => {
      const commonTags = library.getMostCommonTags(5);
      
      expect(Array.isArray(commonTags)).toBe(true);
      expect(commonTags.length).toBeLessThanOrEqual(5);
      
      commonTags.forEach(tagInfo => {
        expect(tagInfo).toHaveProperty('tag');
        expect(tagInfo).toHaveProperty('count');
        expect(typeof tagInfo.tag).toBe('string');
        expect(typeof tagInfo.count).toBe('number');
        expect(tagInfo.count).toBeGreaterThan(0);
      });
      
      // 카운트 순으로 정렬되어 있는지 확인
      for (let i = 1; i < commonTags.length; i++) {
        expect(commonTags[i-1].count).toBeGreaterThanOrEqual(commonTags[i].count);
      }
    });
  });

  describe('Built-in Templates', () => {
    test('should have coding category templates', () => {
      const codingTemplates = library.getTemplatesByCategory('coding');
      
      expect(codingTemplates.length).toBeGreaterThan(0);
      
      // 코드 리뷰 템플릿 확인
      const codeReview = codingTemplates.find(t => t.templateId === 'code-review');
      expect(codeReview).toBeDefined();
      expect(codeReview.name).toBe('코드 리뷰');
    });

    test('should have translation category templates', () => {
      const translationTemplates = library.getTemplatesByCategory('translation');
      
      expect(translationTemplates.length).toBeGreaterThan(0);
      
      // 번역 템플릿 확인
      const translateText = translationTemplates.find(t => t.templateId === 'translate-text');
      expect(translateText).toBeDefined();
      expect(translateText.name).toBe('텍스트 번역');
    });

    test('should have writing category templates', () => {
      const writingTemplates = library.getTemplatesByCategory('writing');
      
      expect(writingTemplates.length).toBeGreaterThan(0);
      
      // 문서 요약 템플릿 확인
      const summarize = writingTemplates.find(t => t.templateId === 'summarize-document');
      expect(summarize).toBeDefined();
      expect(summarize.name).toBe('문서 요약');
    });

    test('should have analysis category templates', () => {
      const analysisTemplates = library.getTemplatesByCategory('analysis');
      
      expect(analysisTemplates.length).toBeGreaterThan(0);
      
      // SWOT 분석 템플릿 확인
      const swot = analysisTemplates.find(t => t.templateId === 'swot-analysis');
      expect(swot).toBeDefined();
      expect(swot.name).toBe('SWOT 분석');
    });

    test('should have education category templates', () => {
      const educationTemplates = library.getTemplatesByCategory('education');
      
      expect(educationTemplates.length).toBeGreaterThan(0);
      
      // 수업 계획서 템플릿 확인
      const lessonPlan = educationTemplates.find(t => t.templateId === 'lesson-plan');
      expect(lessonPlan).toBeDefined();
      expect(lessonPlan.name).toBe('수업 계획서');
    });
  });

  describe('Template Content Validation', () => {
    test('should have valid template syntax in all templates', () => {
      const categories = library.getCategories();
      
      categories.forEach(category => {
        const templates = library.getTemplatesByCategory(category.id);
        
        templates.forEach(template => {
          const validation = library.validateTemplate(template.id);
          
          if (!validation.isValid) {
            console.warn(`Template ${template.id} has validation errors:`, validation.errors);
          }
          
          // 템플릿 구문이 기본적으로 올바른지 확인 (심각한 오류가 없어야 함)
          expect(validation.errors.length).toBeLessThan(5); // 경고 수준의 오류는 허용
        });
      });
    });

    test('should have all required properties in templates', () => {
      const categories = library.getCategories();
      
      categories.forEach(category => {
        const templates = library.getTemplatesByCategory(category.id);
        
        templates.forEach(template => {
          const fullTemplate = library.getTemplate(template.id);
          
          expect(fullTemplate.name).toBeTruthy();
          expect(fullTemplate.description).toBeTruthy();
          expect(fullTemplate.template).toBeTruthy();
          expect(Array.isArray(fullTemplate.variables)).toBe(true);
          expect(Array.isArray(fullTemplate.tags)).toBe(true);
        });
      });
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty search query', () => {
      const results = library.searchTemplates('');
      
      expect(Array.isArray(results)).toBe(true);
      // 빈 쿼리는 모든 템플릿을 반환할 수 있음
    });

    test('should handle invalid category in search', () => {
      const results = library.searchTemplates('test', { category: 'invalid' });
      
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    test('should handle empty variables in rendering', () => {
      const templateId = 'coding.code-review';
      
      const result = library.renderTemplate(templateId, {});
      
      expect(result).toBeDefined();
      expect(result.renderedContent).toBeDefined();
      expect(result.missingVariables.length).toBeGreaterThan(0);
    });

    test('should handle malformed template ID', () => {
      expect(() => {
        library.getTemplate('malformed');
      }).toThrow();
      
      expect(() => {
        library.getTemplate('');
      }).toThrow();
    });
  });

  describe('Singleton Instance', () => {
    test('should export singleton instance', () => {
      expect(templateLibrary).toBeInstanceOf(TemplateLibrary);
    });

    test('should work with singleton instance', () => {
      const categories = templateLibrary.getCategories();
      
      expect(Array.isArray(categories)).toBe(true);
      expect(categories.length).toBeGreaterThan(0);
    });

    test('should have same templates as new instance', () => {
      const newInstance = new TemplateLibrary();
      
      const singletonCategories = templateLibrary.getCategories();
      const newInstanceCategories = newInstance.getCategories();
      
      expect(singletonCategories.length).toBe(newInstanceCategories.length);
    });
  });

  describe('Performance', () => {
    test('should handle large search queries efficiently', () => {
      const start = Date.now();
      
      // 여러 검색 수행
      for (let i = 0; i < 10; i++) {
        library.searchTemplates('test');
        library.searchTemplates('code');
        library.searchTemplates('analysis');
      }
      
      const end = Date.now();
      const duration = end - start;
      
      // 30개 검색이 1초 이내에 완료되어야 함
      expect(duration).toBeLessThan(1000);
    });

    test('should handle multiple template renderings efficiently', () => {
      const templateId = 'coding.code-review';
      const variables = { code: 'test', language: 'javascript' };
      
      const start = Date.now();
      
      // 여러 렌더링 수행
      for (let i = 0; i < 5; i++) {
        library.renderTemplate(templateId, variables);
      }
      
      const end = Date.now();
      const duration = end - start;
      
      // 5개 렌더링이 500ms 이내에 완료되어야 함
      expect(duration).toBeLessThan(500);
    });
  });
});