# MCP Prompt Manager

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
- **Search Functionality**: Search prompts by filename or content
- **Category & Tag System**: Organize prompts with categories and tags
- **Template Processing**: Use variable substitution with `{{variable}}` syntax
- **Favorites Management**: Mark frequently used prompts as favorites
- **Metadata Management**: Automatic metadata tracking for enhanced organization

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
Search prompts by filename or content.
- Parameters:
  - `query` - Search query string
  - `searchInContent` - (Optional) Boolean to search within prompt content (default: false)

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
