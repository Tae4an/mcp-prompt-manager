# MCP Prompt Manager
- [한국어](README-ko.md)
- [日本語](README-ja.md)  
- [中文](README-zh.md)

**Certified by MCP Review**

This project is officially certified by [MCP Review](https://mcpreview.com/mcp-servers/tae4an/mcp-prompt-manager).

MCP (Model Context Protocol) Prompt Manager is a server that enables AI models like Claude to access local prompt files. It provides functionality for creating, retrieving, updating, and deleting prompts, allowing efficient management of frequently used prompts.

## Key Features

### Core Features
- List all prompts
- Retrieve specific prompt content
- Create new prompts
- Update prompt content
- Delete prompts

### Advanced Features
- **Intelligent Search**: Advanced fuzzy search with multiple algorithms (Levenshtein, Jaro-Winkler, n-gram similarity)
- **Category & Tag System**: Organize prompts with categories and tags
- **Template Processing**: Use variable substitution with `{{variable}}` syntax and advanced conditionals
- **Template Library**: Built-in template library with 12 professional templates across 5 categories
- **Favorites Management**: Mark frequently used prompts as favorites
- **Metadata Management**: Automatic metadata tracking for enhanced organization
- **Version Management**: Complete version control with history tracking, diff comparison, and rollback capabilities
- **Import/Export System**: Backup and restore prompts with JSON format, including metadata and version history
- **Security & Validation**: Comprehensive input sanitization, rate limiting, and error handling
- **Caching System**: Intelligent caching for improved performance
- **Structured Logging**: Advanced logging with multiple levels and file output

## Installation

### Prerequisites

- Node.js v18 or higher
- npm

### Installation Steps

1. Clone the repository
   ```bash
   git clone https://github.com/Tae4an/mcp-prompt-manager.git
   cd mcp-prompt-manager
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Grant execution permissions
   ```bash
   chmod +x server.js
   ```

## Containerized Run

### Run with Docker

```bash
docker build -t mcp-prompt-manager:local .
docker run --rm \
  -e NODE_ENV=production \
  -e LOG_DIR=/var/log/mcp \
  -e PROMPTS_DIR=/data/prompts \
  -v $(pwd)/prompts:/data/prompts \
  -v $(pwd)/logs:/var/log/mcp \
  mcp-prompt-manager:local
```

### Run with Docker Compose

```bash
docker compose up -d --build
```

### Environment variables
- PROMPTS_DIR: Directory to store prompts (default: project `prompts`)
- LOG_DIR: Directory for file logging (default: `./logs`)
- Cache TTL/size:
  - FILE_CACHE_TTL, FILE_CACHE_MAX_SIZE
  - SEARCH_CACHE_TTL, SEARCH_CACHE_MAX_SIZE
  - METADATA_CACHE_TTL, METADATA_CACHE_MAX_SIZE
  - TEMPLATE_CACHE_TTL, TEMPLATE_CACHE_MAX_SIZE
- Rate limit presets:
  - RATE_LIMIT_STANDARD_WINDOW_MS, RATE_LIMIT_STANDARD_MAX
  - RATE_LIMIT_STRICT_WINDOW_MS, RATE_LIMIT_STRICT_MAX
  - RATE_LIMIT_LENIENT_WINDOW_MS, RATE_LIMIT_LENIENT_MAX
  - RATE_LIMIT_UPLOAD_WINDOW_MS, RATE_LIMIT_UPLOAD_MAX

## Connecting to Claude Desktop

1. Install Claude Desktop (if not already installed)
   - [Download Claude Desktop](https://claude.ai/desktop)

2. Open Claude Desktop configuration file:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

3. Add the following content to the configuration file:
   ```json
   {
     "mcpServers": {
       "promptManager": {
         "command": "node",
         "args": ["absolute_path_to_cloned_repository/server.js"]
       }
     }
   }
   ```
   
   Example:
   ```json
   {
     "mcpServers": {
       "promptManager": {
         "command": "node",
         "args": ["/Users/username/projects/mcp-prompt-manager/server.js"]
       }
     }
   }
   ```

4. Restart Claude Desktop

## Usage

In Claude Desktop, click the tools icon (🛠️) to access the following MCP tools:

## Core Tools

### list-prompts
Retrieves a list of all prompts.
- Parameters: None

### get-prompt
Retrieves the content of a specific prompt.
- Parameters: `filename` - Name of the prompt file to retrieve

### create-prompt
Creates a new prompt.
- Parameters: 
  - `filename` - Name of the prompt file to create (e.g., my-prompt.txt)
  - `content` - Prompt content

### update-prompt
Updates the content of an existing prompt.
- Parameters:
  - `filename` - Name of the prompt file to update
  - `content` - New prompt content

### delete-prompt
Deletes a prompt (automatically removes associated metadata).
- Parameters: `filename` - Name of the prompt file to delete

## Advanced Tools

### search-prompts
Advanced fuzzy search prompts by filename or content with intelligent ranking.
- Parameters:
  - `query` - Search query string
  - `searchInContent` - (Optional) Boolean to search within prompt content (default: false)
  - `limit` - (Optional) Maximum number of results to return (default: 10)
  - `threshold` - (Optional) Minimum similarity threshold (0.0-1.0, default: 0.3)

### tag-prompt
Add tags to a prompt for better organization.
- Parameters:
  - `filename` - Name of the prompt file to tag
  - `tags` - Array of tag strings

### categorize-prompt
Set a category for a prompt.
- Parameters:
  - `filename` - Name of the prompt file to categorize
  - `category` - Category name string

### list-by-category
List prompts organized by category.
- Parameters:
  - `category` - (Optional) Specific category to filter by

### process-template
Process a prompt template with variable substitution.
- Parameters:
  - `filename` - Name of the template prompt file
  - `variables` - Object with variable names as keys and replacement values as values
- Note: Use `{{variable}}` format in templates

### list-template-variables
List all variables found in a template prompt.
- Parameters:
  - `filename` - Name of the template prompt file to analyze

### favorite-prompt
Add or remove a prompt from favorites.
- Parameters:
  - `filename` - Name of the prompt file
  - `action` - Either "add" or "remove"

### list-favorites
List all favorite prompts with detailed information.
- Parameters: None

## Version Management Tools

### list-prompt-versions
List all versions of a specific prompt with timestamps and actions.
- Parameters:
  - `filename` - Name of the prompt file to get version history for

### compare-prompt-versions
Compare two versions of a prompt and show detailed differences.
- Parameters:
  - `filename` - Name of the prompt file to compare
  - `fromVersion` - Source version number to compare from
  - `toVersion` - Target version number to compare to

### rollback-prompt
Rollback a prompt to a specific previous version.
- Parameters:
  - `filename` - Name of the prompt file to rollback
  - `version` - Version number to rollback to

### get-prompt-version
Get the content of a specific version of a prompt.
- Parameters:
  - `filename` - Name of the prompt file
  - `version` - Version number to retrieve

### get-prompt-version-stats
Get statistics about a prompt's version history including total versions, actions breakdown, and size history.
- Parameters:
  - `filename` - Name of the prompt file to get statistics for

## Template Library Tools

The built-in template library includes 12 professional templates across 5 categories:

### Available Template Categories:
- **🖥️ Coding & Development** (3 templates): Code review, debugging help, API documentation
- **🌐 Translation & Language** (2 templates): Text translation, grammar checking
- **📝 Document Writing** (2 templates): Document summarization, meeting minutes
- **📊 Analysis & Research** (2 templates): SWOT analysis, competitive analysis  
- **🎓 Education & Learning** (3 templates): Lesson plans, quiz generation

### list-template-categories
List all available template categories with descriptions and template counts.
- Parameters: None

### list-templates-by-category
List all templates in a specific category.
- Parameters:
  - `categoryId` - Category ID to list templates from

### get-template-details
Get detailed information about a specific template including variables and usage.
- Parameters:
  - `templateId` - Template ID (format: category.template-name)

### search-templates
Search through the template library using fuzzy matching.
- Parameters:
  - `query` - Search query string
  - `category` - (Optional) Filter by specific category
  - `tags` - (Optional) Array of tags to filter by
  - `limit` - (Optional) Maximum number of results (default: 10)

### render-template
Render a template with provided variables and get the processed content.
- Parameters:
  - `templateId` - Template ID to render
  - `variables` - Object with variable names and values
  - `sanitizeOutput` - (Optional) Enable output sanitization (default: true)

### validate-template
Validate template syntax and check for potential issues.
- Parameters:
  - `templateId` - Template ID to validate

### get-popular-templates
Get list of most popular templates based on usage patterns.
- Parameters:
  - `limit` - (Optional) Number of templates to return (default: 5)

### get-related-templates
Get templates related to a specific template based on tags and categories.
- Parameters:
  - `templateId` - Template ID to find related templates for
  - `limit` - (Optional) Number of related templates (default: 3)

### get-template-library-stats
Get comprehensive statistics about the template library.
- Parameters: None

### create-prompt-from-template
Create a new prompt file using a template with variable substitution.
- Parameters:
  - `templateId` - Template ID to use
  - `filename` - Name for the new prompt file
  - `variables` - Object with template variables
  - `addMetadata` - (Optional) Add template metadata to file (default: true)

## Import/Export Tools

### export-prompts
Export prompts to JSON format for backup or sharing.
- Parameters:
  - `format` - (Optional) Export format: "json" (default: json)
  - `includeMetadata` - (Optional) Include metadata in export (default: true)
  - `includeVersionHistory` - (Optional) Include version history (default: false)
  - `filterByTags` - (Optional) Array of tags to filter prompts
  - `filterByCategory` - (Optional) Category to filter prompts
  - `compress` - (Optional) Compress export data (default: false)

### import-prompts
Import prompts from JSON format with validation and conflict resolution.
- Parameters:
  - `importData` - Import data object in export format
  - `overwriteExisting` - (Optional) Overwrite existing files (default: false)
  - `skipDuplicates` - (Optional) Skip duplicate files (default: true)
  - `validateChecksums` - (Optional) Validate file checksums (default: true)
  - `createBackup` - (Optional) Create backup before import (default: true)
  - `mergeMetadata` - (Optional) Merge with existing metadata (default: true)

### get-import-export-status
Get import/export system status and capabilities.
- Parameters: None

## Technical Features

### Security & Performance
- **Input Sanitization**: Comprehensive XSS and injection attack prevention
- **Rate Limiting**: Configurable rate limiting with sliding window algorithm
- **Caching System**: Multi-level LRU caching with TTL support for improved performance
- **Error Handling**: Advanced error recovery and logging system
- **File Validation**: SHA-256 checksums and integrity verification

### Advanced Template Engine
- **Conditional Logic**: Support for `{{#if}}`, `{{#unless}}`, `{{#each}}` constructs
- **Loop Processing**: Iterate over arrays and objects in templates
- **Function Calls**: Built-in helper functions for formatting and processing
- **Nested Variables**: Support for complex object structures
- **Error Recovery**: Graceful handling of missing variables and malformed templates

### Fuzzy Search Algorithms
- **Levenshtein Distance**: Character-based similarity matching
- **Jaro-Winkler Distance**: Optimized for prefix matching
- **N-gram Similarity**: Substring pattern matching
- **Intelligent Ranking**: Multi-factor scoring with customizable thresholds
- **Highlighting**: Search result highlighting for better user experience

### Data Management
- **Version Control**: Complete history tracking with diff comparison
- **Metadata System**: Automatic tagging, categorization, and favorites
- **Backup System**: Automated backup creation during import operations
- **Export Formats**: JSON with optional compression and filtering
- **File Organization**: Structured storage with hidden metadata directories

## Advanced Configuration

### Changing Prompt Storage Path

By default, prompts are stored in the `prompts` folder in the directory where the server file is located. You can change the path using environment variables:

```bash
PROMPTS_DIR=/desired/path node server.js
```

Or set environment variables in claude_desktop_config.json:

```json
{
  "mcpServers": {
    "promptManager": {
      "command": "node",
      "args": ["/absolute/path/mcp-prompt-manager/server.js"],
      "env": {
        "PROMPTS_DIR": "/desired/path"
      }
    }
  }
}
```

## Examples

### Basic Usage

1. **Creating a new prompt**:
   - Tool: `create-prompt`
   - Filename: `greeting.txt`
   - Content: `You are a friendly and helpful AI assistant. Please respond politely to user questions.`

2. **Listing prompts**:
   - Tool: `list-prompts`

3. **Retrieving prompt content**:
   - Tool: `get-prompt`
   - Filename: `greeting.txt`

### Advanced Usage

4. **Creating a template prompt**:
   - Tool: `create-prompt`
   - Filename: `email-template.txt`
   - Content: `Dear {{name}}, Thank you for your interest in {{product}}. Best regards, {{sender}}`

5. **Processing a template**:
   - Tool: `process-template`
   - Filename: `email-template.txt`
   - Variables: `{"name": "John", "product": "MCP Server", "sender": "Support Team"}`

6. **Organizing prompts**:
   - Tool: `categorize-prompt`
   - Filename: `greeting.txt`
   - Category: `customer-service`
   
   - Tool: `tag-prompt`
   - Filename: `greeting.txt`
   - Tags: `["polite", "professional", "greeting"]`

7. **Searching prompts**:
   - Tool: `search-prompts`
   - Query: `assistant`
   - SearchInContent: `true`

8. **Managing favorites**:
   - Tool: `favorite-prompt`
   - Filename: `greeting.txt`
   - Action: `add`

### Version Management Usage

9. **Viewing version history**:
   - Tool: `list-prompt-versions`
   - Filename: `greeting.txt`

10. **Comparing versions**:
    - Tool: `compare-prompt-versions`
    - Filename: `greeting.txt`
    - FromVersion: `1`
    - ToVersion: `3`

11. **Rolling back to a previous version**:
    - Tool: `rollback-prompt`
    - Filename: `greeting.txt`
    - Version: `2`

12. **Getting version statistics**:
    - Tool: `get-prompt-version-stats`
    - Filename: `greeting.txt`

### Template Library Usage

13. **Browsing template categories**:
    - Tool: `list-template-categories`

14. **Using a template**:
    - Tool: `render-template`
    - TemplateId: `coding.code-review`
    - Variables: `{"code": "function hello() { console.log('Hello'); }", "language": "javascript"}`

15. **Creating prompt from template**:
    - Tool: `create-prompt-from-template`
    - TemplateId: `writing.meeting-minutes`
    - Filename: `weekly-standup.txt`
    - Variables: `{"meeting_title": "Weekly Standup", "date": "2024-08-04", "attendees": "Team Alpha"}`

16. **Searching templates**:
    - Tool: `search-templates`
    - Query: `code review`
    - Category: `coding`

### Import/Export Usage

17. **Exporting prompts for backup**:
    - Tool: `export-prompts`
    - IncludeMetadata: `true`
    - IncludeVersionHistory: `false`
    - FilterByTags: `["important", "production"]`

18. **Importing prompts from backup**:
    - Tool: `import-prompts`
    - ImportData: `{exported data object}`
    - CreateBackup: `true`
    - OverwriteExisting: `false`

19. **Checking import/export status**:
    - Tool: `get-import-export-status`

### Advanced Search Usage

20. **Fuzzy search with parameters**:
    - Tool: `search-prompts`
    - Query: `custmer servce` (intentional typos)
    - SearchInContent: `true`
    - Threshold: `0.6`
    - Limit: `15`

## Troubleshooting

### If the MCP server doesn't connect
- Verify that the server file path is correct
- Check that the server has execution permissions
- Ensure Node.js version is v18 or higher

### If tools don't appear
- Try restarting Claude Desktop
- Verify that the `claude_desktop_config.json` file is configured correctly

### File access permission issues
- Ensure you have read/write permissions for the prompts directory

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

If you encounter any issues or have questions, please open an issue on the [GitHub repository](https://github.com/Tae4an/mcp-prompt-manager/issues).


