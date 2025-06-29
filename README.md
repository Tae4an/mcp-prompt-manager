# MCP Prompt Manager

**Certified by MCP Review**

This project is officially certified by [MCP Review](https://mcpreview.com/mcp-servers/tae4an/mcp-prompt-manager).

MCP (Model Context Protocol) Prompt Manager is a server that enables AI models like Claude to access local prompt files. It provides functionality for creating, retrieving, updating, and deleting prompts, allowing efficient management of frequently used prompts.

## Key Features

- List all prompts
- Retrieve specific prompt content
- Create new prompts
- Update prompt content
- Delete prompts

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
Deletes a prompt.
- Parameters: `filename` - Name of the prompt file to delete

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

1. Creating a new prompt:
   - Tool: `create-prompt`
   - Filename: `greeting.txt`
   - Content: `You are a friendly and helpful AI assistant. Please respond politely to user questions.`

2. Listing prompts:
   - Tool: `list-prompts`

3. Retrieving prompt content:
   - Tool: `get-prompt`
   - Filename: `greeting.txt`

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
