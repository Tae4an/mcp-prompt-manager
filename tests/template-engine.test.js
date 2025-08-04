import { jest } from '@jest/globals';
import { TemplateEngine } from '../utils/template-engine.js';

describe('TemplateEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new TemplateEngine();
  });

  describe('Basic Variable Substitution', () => {
    test('should replace simple variables', () => {
      const template = 'Hello {{name}}!';
      const context = { name: 'World' };
      
      const result = engine.render(template, context);
      expect(result).toBe('Hello World!');
    });

    test('should handle multiple variables', () => {
      const template = '{{greeting}} {{name}}, you have {{count}} messages';
      const context = { greeting: 'Hi', name: 'John', count: 5 };
      
      const result = engine.render(template, context);
      expect(result).toBe('Hi John, you have 5 messages');
    });

    test('should handle nested object properties', () => {
      const template = 'Hello {{user.name}}, your email is {{user.email}}';
      const context = { user: { name: 'John', email: 'john@example.com' } };
      
      const result = engine.render(template, context);
      expect(result).toBe('Hello John, your email is john@example.com');
    });

    test('should leave undefined variables unchanged', () => {
      const template = 'Hello {{name}}, welcome to {{site}}!';
      const context = { name: 'John' };
      
      const result = engine.render(template, context);
      expect(result).toBe('Hello John, welcome to {{site}}!');
    });
  });

  describe('Conditional Logic', () => {
    test('should handle if blocks', () => {
      const template = '{{#if showMessage}}Hello World!{{/if}}';
      
      expect(engine.render(template, { showMessage: true }))
        .toBe('Hello World!');
      
      expect(engine.render(template, { showMessage: false }))
        .toBe('');
    });

    test('should handle if-else blocks', () => {
      const template = '{{#if loggedIn}}Welcome back!{{#else}}Please log in{{/if}}';
      
      expect(engine.render(template, { loggedIn: true }))
        .toBe('Welcome back!');
      
      expect(engine.render(template, { loggedIn: false }))
        .toBe('Please log in');
    });

    test('should handle unless blocks', () => {
      const template = '{{#unless error}}Success!{{/unless}}';
      
      expect(engine.render(template, { error: false }))
        .toBe('Success!');
      
      expect(engine.render(template, { error: true }))
        .toBe('');
    });

    test('should handle comparison operators', () => {
      const template = '{{#if count > 5}}Many{{#else}}Few{{/if}}';
      
      expect(engine.render(template, { count: 10 }))
        .toBe('Many');
      
      expect(engine.render(template, { count: 3 }))
        .toBe('Few');
    });
  });

  describe('Loops', () => {
    test('should handle each blocks with arrays', () => {
      const template = '{{#each items}}{{this}} {{/each}}';
      const context = { items: ['apple', 'banana', 'cherry'] };
      
      const result = engine.render(template, context);
      expect(result).toBe('apple banana cherry ');
    });

    test('should provide loop variables', () => {
      const template = '{{#each items}}{{@index}}: {{this}}{{#unless @last}}, {{/unless}}{{/each}}';
      const context = { items: ['a', 'b', 'c'] };
      
      const result = engine.render(template, context);
      expect(result).toBe('0: a, 1: b, 2: c');
    });

    test('should handle objects in loops', () => {
      const template = '{{#each users}}{{name}} ({{age}}) {{/each}}';
      const context = { 
        users: [
          { name: 'John', age: 30 },
          { name: 'Jane', age: 25 }
        ]
      };
      
      const result = engine.render(template, context);
      expect(result).toBe('John (30) Jane (25) ');
    });

    test('should handle nested loops', () => {
      const template = '{{#each categories}}{{name}}: {{#each items}}{{this}} {{/each}}| {{/each}}';
      const context = {
        categories: [
          { name: 'Fruits', items: ['apple', 'banana'] },
          { name: 'Colors', items: ['red', 'blue'] }
        ]
      };
      
      const result = engine.render(template, context);
      expect(result).toBe('Fruits: apple banana | Colors: red blue | ');
    });
  });

  describe('Built-in Functions', () => {
    test('should handle string functions', () => {
      const template = '{{upper name}} - {{lower name}} - {{capitalize name}}';
      const context = { name: 'john doe' };
      
      const result = engine.render(template, context);
      expect(result).toBe('JOHN DOE - john doe - John doe');
    });

    test('should handle math functions', () => {
      const template = '{{add 5 3}} - {{multiply 4 2}} - {{round 3.14159 2}}';
      
      const result = engine.render(template, {});
      expect(result).toBe('8 - 8 - 3.14');
    });

    test('should handle array functions', () => {
      const template = '{{join items ", "}} ({{count items}} items)';
      const context = { items: ['a', 'b', 'c'] };
      
      const result = engine.render(template, context);
      expect(result).toBe('a, b, c (3 items)');
    });

    test('should handle date functions', () => {
      const template = '{{date "iso"}}';
      
      const result = engine.render(template, {});
      expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('should handle default function', () => {
      const template = '{{default name "Anonymous"}} - {{default "" "Empty"}}';
      const context = { name: 'John' };
      
      const result = engine.render(template, context);
      expect(result).toBe('John - Empty');
    });

    test('should handle conditional functions', () => {
      const template = '{{#if (isEmpty items)}}No items{{/if}} {{#if (isNotEmpty name)}}Hello {{name}}{{/if}}';
      const context = { items: [], name: 'John' };
      
      const result = engine.render(template, context);
      expect(result).toBe('No items Hello John');
    });
  });

  describe('Comments', () => {
    test('should remove comments', () => {
      const template = 'Hello {{!-- this is a comment --}} World!';
      
      const result = engine.render(template, {});
      expect(result).toBe('Hello  World!');
    });

    test('should handle multiline comments', () => {
      const template = `Hello {{!--
        this is a
        multiline comment
      --}} World!`;
      
      const result = engine.render(template, {});
      expect(result).toBe('Hello  World!');
    });
  });

  describe('Template Validation', () => {
    test('should validate correct templates', () => {
      const template = '{{#if condition}}{{name}}{{/if}}';
      
      const validation = engine.validate(template);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should detect unbalanced braces', () => {
      const template = '{{name} missing brace';
      
      const validation = engine.validate(template);
      expect(validation.isValid).toBe(false);
      expect(validation.errors[0]).toContain('Unbalanced braces');
    });

    test('should detect unbalanced blocks', () => {
      const template = '{{#if condition}}content{{/unless}}';
      
      const validation = engine.validate(template);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(err => err.includes('if blocks'))).toBe(true);
    });

    test('should detect unclosed blocks', () => {
      const template = '{{#if condition}}content';
      
      const validation = engine.validate(template);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(err => err.includes('unclosed'))).toBe(true);
    });
  });

  describe('Variable Extraction', () => {
    test('should extract simple variables', () => {
      const template = 'Hello {{name}}, you have {{count}} messages';
      
      const variables = engine.extractVariables(template);
      expect(variables).toEqual(expect.arrayContaining(['name', 'count']));
    });

    test('should extract variables from conditions', () => {
      const template = '{{#if user.active}}Welcome {{user.name}}{{/if}}';
      
      const variables = engine.extractVariables(template);
      expect(variables).toEqual(expect.arrayContaining(['user']));
    });

    test('should extract variables from loops', () => {
      const template = '{{#each items}}{{name}}{{/each}}';
      
      const variables = engine.extractVariables(template);
      expect(variables).toEqual(expect.arrayContaining(['items']));
    });

    test('should exclude special variables', () => {
      const template = '{{#each items}}{{@index}}: {{this}}{{/each}}';
      
      const variables = engine.extractVariables(template);
      expect(variables).toEqual(['items']);
      expect(variables).not.toContain('@index');
    });
  });

  describe('Advanced Features', () => {
    test('should handle custom functions in context', () => {
      const template = '{{customFunc "hello" "world"}}';
      const context = {
        customFunc: (a, b) => `${a} ${b}!`
      };
      
      const result = engine.render(template, context);
      expect(result).toBe('hello world!');
    });

    test('should handle complex nested structures', () => {
      const template = `
        {{#each categories}}
          Category: {{name}}
          {{#each items}}
            {{#if active}}
              - {{name}} ({{price}} {{currency}})
            {{/if}}
          {{/each}}
        {{/each}}
      `;
      
      const context = {
        categories: [
          {
            name: 'Electronics',
            items: [
              { name: 'Laptop', price: 1000, currency: 'USD', active: true },
              { name: 'Phone', price: 500, currency: 'USD', active: false }
            ]
          }
        ]
      };
      
      const result = engine.render(template, context);
      expect(result).toContain('Category: Electronics');
      expect(result).toContain('- Laptop (1000 USD)');
      expect(result).not.toContain('Phone');
    });

    test('should handle iteration limits', () => {
      const template = '{{#each items}}{{this}}{{/each}}';
      const context = { items: new Array(2000).fill('x') }; // 큰 배열
      
      // maxIterations 제한으로 빈 결과 반환
      const result = engine.render(template, context, { maxIterations: 100 });
      expect(result).toBe('');
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid templates gracefully', () => {
      expect(() => {
        engine.render(null, {});
      }).toThrow('Template must be a string');
    });

    test('should handle function errors gracefully', () => {
      const template = '{{errorFunc}}';
      const context = {
        errorFunc: () => { throw new Error('Function error'); }
      };
      
      // 에러가 발생해도 원본 텍스트 유지
      const result = engine.render(template, context);
      expect(result).toBe('{{errorFunc}}');
    });

    test('should sanitize output by default', () => {
      const template = 'Hello {{name}}';
      const context = { name: '<script>alert("xss")</script>' };
      
      const result = engine.render(template, context);
      expect(result).not.toContain('<script>');
    });
  });
});