# MCP 提示词管理器

**MCP Review 认证**

此项目已获得 [MCP Review](https://mcpreview.com/mcp-servers/tae4an/mcp-prompt-manager) 官方认证。

MCP（模型上下文协议）提示词管理器是一个让 Claude 等 AI 模型能够访问本地提示词文件的服务器。它提供创建、检索、更新和删除功能，用于高效管理常用提示词。

## 主要功能

### 核心功能
- 列出所有提示词
- 检索特定提示词内容
- 创建新提示词
- 更新提示词内容
- 删除提示词

### 高级功能
- **智能搜索**: 基于多种算法（Levenshtein、Jaro-Winkler、n-gram 相似度）的高级模糊搜索
- **分类和标签系统**: 通过分类和标签系统化管理提示词
- **模板处理**: 使用 `{{变量}}` 语法和高级条件语句进行变量替换
- **模板库**: 内置 5 个分类的 12 个专业模板
- **收藏夹管理**: 将常用提示词设为收藏
- **元数据管理**: 自动元数据跟踪以增强组织管理
- **版本管理**: 具有历史跟踪、差异比较和回滚功能的完整版本控制
- **导入/导出系统**: JSON 格式的备份和恢复，包含元数据和版本历史
- **安全与验证**: 全面的输入清理、速率限制和错误处理
- **缓存系统**: 智能缓存以提升性能
- **结构化日志**: 支持多级别和文件输出的高级日志

## 安装

### 先决条件

- Node.js v18 或更高版本
- npm

### 安装步骤

1. 克隆仓库
   ```bash
   git clone https://github.com/Tae4an/mcp-prompt-manager.git
   cd mcp-prompt-manager
   ```

2. 安装依赖
   ```bash
   npm install
   ```

3. 授予执行权限
   ```bash
   chmod +x server.js
   ```

## 容器化运行

### 使用 Docker 运行

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

### 使用 Docker Compose 运行

```bash
docker compose up -d --build
```

### 环境变量
- PROMPTS_DIR：提示词存储目录（默认：项目内 `prompts`）
- LOG_DIR：文件日志目录（默认：`./logs`）
- 缓存 TTL/大小：
  - FILE_CACHE_TTL, FILE_CACHE_MAX_SIZE
  - SEARCH_CACHE_TTL, SEARCH_CACHE_MAX_SIZE
  - METADATA_CACHE_TTL, METADATA_CACHE_MAX_SIZE
  - TEMPLATE_CACHE_TTL, TEMPLATE_CACHE_MAX_SIZE
- 速率限制预设：
  - RATE_LIMIT_STANDARD_WINDOW_MS, RATE_LIMIT_STANDARD_MAX
  - RATE_LIMIT_STRICT_WINDOW_MS, RATE_LIMIT_STRICT_MAX
  - RATE_LIMIT_LENIENT_WINDOW_MS, RATE_LIMIT_LENIENT_MAX
  - RATE_LIMIT_UPLOAD_WINDOW_MS, RATE_LIMIT_UPLOAD_MAX

## 连接到 Claude Desktop

1. 安装 Claude Desktop（如果尚未安装）
   - [下载 Claude Desktop](https://claude.ai/desktop)

2. 打开 Claude Desktop 配置文件：
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

3. 在配置文件中添加以下内容：
   ```json
   {
     "mcpServers": {
       "promptManager": {
         "command": "node",
         "args": ["克隆仓库的绝对路径/server.js"]
       }
     }
   }
   ```
   
   示例：
   ```json
   {
     "mcpServers": {
       "promptManager": {
         "command": "node",
         "args": ["/Users/用户名/projects/mcp-prompt-manager/server.js"]
       }
     }
   }
   ```

4. 重启 Claude Desktop

## 使用方法

在 Claude Desktop 中点击工具图标（🛠️）访问以下 MCP 工具：

## 核心工具

### list-prompts
获取所有提示词的列表。
- 参数：无

### get-prompt
获取特定提示词的内容。
- 参数：`filename` - 要检索的提示词文件名

### create-prompt
创建新提示词。
- 参数：
  - `filename` - 要创建的提示词文件名（例如：my-prompt.txt）
  - `content` - 提示词内容

### update-prompt
更新现有提示词的内容。
- 参数：
  - `filename` - 要更新的提示词文件名
  - `content` - 新的提示词内容

### delete-prompt
删除提示词（自动删除相关元数据）。
- 参数：`filename` - 要删除的提示词文件名

## 高级工具

### search-prompts
通过智能排名进行文件名或内容的高级模糊搜索。
- 参数：
  - `query` - 搜索查询字符串
  - `searchInContent` - （可选）是否在提示词内容中搜索（默认：false）
  - `limit` - （可选）返回的最大结果数（默认：10）
  - `threshold` - （可选）最小相似度阈值（0.0-1.0，默认：0.3）

### tag-prompt
为提示词添加标签以便更好地组织。
- 参数：
  - `filename` - 要添加标签的提示词文件名
  - `tags` - 标签字符串数组

### categorize-prompt
为提示词设置分类。
- 参数：
  - `filename` - 要分类的提示词文件名
  - `category` - 分类名称字符串

### list-by-category
列出按分类组织的提示词。
- 参数：
  - `category` - （可选）要筛选的特定分类

### process-template
通过变量替换处理提示词模板。
- 参数：
  - `filename` - 模板提示词文件名
  - `variables` - 以变量名为键、替换值为值的对象
- 注意：模板中使用 `{{变量}}` 格式

### list-template-variables
列出模板提示词中找到的所有变量。
- 参数：
  - `filename` - 要分析的模板提示词文件名

### favorite-prompt
在收藏夹中添加或删除提示词。
- 参数：
  - `filename` - 提示词文件名
  - `action` - "add" 或 "remove"

### list-favorites
列出所有收藏的提示词及详细信息。
- 参数：无

## 版本管理工具

### list-prompt-versions
列出特定提示词的所有版本及时间戳和操作。
- 参数：
  - `filename` - 要获取版本历史的提示词文件名

### compare-prompt-versions
比较提示词的两个版本并显示详细差异。
- 参数：
  - `filename` - 要比较的提示词文件名
  - `fromVersion` - 比较源版本号
  - `toVersion` - 比较目标版本号

### rollback-prompt
将提示词回滚到特定的先前版本。
- 参数：
  - `filename` - 要回滚的提示词文件名
  - `version` - 要回滚到的版本号

### get-prompt-version
获取提示词特定版本的内容。
- 参数：
  - `filename` - 提示词文件名
  - `version` - 要检索的版本号

### get-prompt-version-stats
获取提示词版本历史统计信息，包括总版本数、操作分析和大小历史。
- 参数：
  - `filename` - 要获取统计信息的提示词文件名

## 模板库工具

内置模板库包含 5 个分类的 12 个专业模板：

### 可用模板分类：
- **🖥️ 编程与开发**（3 个模板）：代码审查、调试帮助、API 文档
- **🌐 翻译与语言**（2 个模板）：文本翻译、语法检查
- **📝 文档写作**（2 个模板）：文档摘要、会议纪要
- **📊 分析与研究**（2 个模板）：SWOT 分析、竞争分析
- **🎓 教育与学习**（3 个模板）：课程计划、测验生成

### list-template-categories
列出所有可用的模板分类及描述和模板数量。
- 参数：无

### list-templates-by-category
列出特定分类中的所有模板。
- 参数：
  - `categoryId` - 要列出模板的分类 ID

### get-template-details
获取特定模板的详细信息，包括变量和用法。
- 参数：
  - `templateId` - 模板 ID（格式：category.template-name）

### search-templates
使用模糊匹配搜索模板库。
- 参数：
  - `query` - 搜索查询字符串
  - `category` - （可选）按特定分类筛选
  - `tags` - （可选）要筛选的标签数组
  - `limit` - （可选）最大结果数（默认：10）

### render-template
使用提供的变量渲染模板并获取处理后的内容。
- 参数：
  - `templateId` - 要渲染的模板 ID
  - `variables` - 包含变量名和值的对象
  - `sanitizeOutput` - （可选）启用输出清理（默认：true）

### validate-template
验证模板语法并检查潜在问题。
- 参数：
  - `templateId` - 要验证的模板 ID

### get-popular-templates
基于使用模式获取最受欢迎的模板列表。
- 参数：
  - `limit` - （可选）返回的模板数量（默认：5）

### get-related-templates
基于标签和分类获取与特定模板相关的模板。
- 参数：
  - `templateId` - 要查找相关模板的模板 ID
  - `limit` - （可选）相关模板数量（默认：3）

### get-template-library-stats
获取模板库的综合统计信息。
- 参数：无

### create-prompt-from-template
通过变量替换使用模板创建新的提示词文件。
- 参数：
  - `templateId` - 要使用的模板 ID
  - `filename` - 新提示词文件名
  - `variables` - 包含模板变量的对象
  - `addMetadata` - （可选）向文件添加模板元数据（默认：true）

## 导入/导出工具

### export-prompts
将提示词导出为 JSON 格式用于备份或共享。
- 参数：
  - `format` - （可选）导出格式："json"（默认：json）
  - `includeMetadata` - （可选）在导出中包含元数据（默认：true）
  - `includeVersionHistory` - （可选）包含版本历史（默认：false）
  - `filterByTags` - （可选）筛选提示词的标签数组
  - `filterByCategory` - （可选）筛选提示词的分类
  - `compress` - （可选）压缩导出数据（默认：false）

### import-prompts
通过验证和冲突解决从 JSON 格式导入提示词。
- 参数：
  - `importData` - 导出格式的导入数据对象
  - `overwriteExisting` - （可选）覆盖现有文件（默认：false）
  - `skipDuplicates` - （可选）跳过重复文件（默认：true）
  - `validateChecksums` - （可选）验证文件校验和（默认：true）
  - `createBackup` - （可选）导入前创建备份（默认：true）
  - `mergeMetadata` - （可选）与现有元数据合并（默认：true）

### get-import-export-status
获取导入/导出系统状态和功能。
- 参数：无

## 技术特性

### 安全与性能
- **输入清理**：全面的 XSS 和注入攻击防护
- **速率限制**：滑动窗口算法的可配置速率限制
- **缓存系统**：支持 TTL 的多级 LRU 缓存以提升性能
- **错误处理**：高级错误恢复和日志系统
- **文件验证**：SHA-256 校验和和完整性验证

### 高级模板引擎
- **条件逻辑**：支持 `{{#if}}`、`{{#unless}}`、`{{#each}}` 构造
- **循环处理**：在模板中迭代数组和对象
- **函数调用**：用于格式化和处理的内置辅助函数
- **嵌套变量**：支持复杂对象结构
- **错误恢复**：优雅处理缺失变量和格式错误的模板

### 模糊搜索算法
- **Levenshtein 距离**：基于字符的相似度匹配
- **Jaro-Winkler 距离**：为前缀匹配优化
- **N-gram 相似度**：子字符串模式匹配
- **智能排名**：具有可自定义阈值的多因子评分
- **高亮显示**：搜索结果高亮以提供更好的用户体验

### 数据管理
- **版本控制**：通过差异比较完整的历史跟踪
- **元数据系统**：自动标记、分类和收藏
- **备份系统**：导入操作期间的自动备份创建
- **导出格式**：支持可选压缩和筛选的 JSON
- **文件组织**：具有隐藏元数据目录的结构化存储

## 高级配置

### 更改提示词存储路径

默认情况下，提示词存储在服务器文件所在目录的 `prompts` 文件夹中。您可以使用环境变量更改路径：

```bash
PROMPTS_DIR=/desired/path node server.js
```

或在 claude_desktop_config.json 中设置环境变量：

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

## 示例

### 基本用法

1. **创建新提示词**：
   - 工具：`create-prompt`
   - 文件名：`greeting.txt`
   - 内容：`您是一个友好且有帮助的 AI 助手。请礼貌地回答用户问题。`

2. **列出提示词**：
   - 工具：`list-prompts`

3. **获取提示词内容**：
   - 工具：`get-prompt`
   - 文件名：`greeting.txt`

### 高级用法

4. **创建模板提示词**：
   - 工具：`create-prompt`
   - 文件名：`email-template.txt`
   - 内容：`亲爱的 {{姓名}}，感谢您对 {{产品}} 的关注。此致，{{发件人}}`

5. **处理模板**：
   - 工具：`process-template`
   - 文件名：`email-template.txt`
   - 变量：`{"姓名": "张三", "产品": "MCP 服务器", "发件人": "支持团队"}`

6. **组织提示词**：
   - 工具：`categorize-prompt`
   - 文件名：`greeting.txt`
   - 分类：`客户服务`
   
   - 工具：`tag-prompt`
   - 文件名：`greeting.txt`
   - 标签：`["礼貌", "专业", "问候"]`

7. **搜索提示词**：
   - 工具：`search-prompts`
   - 查询：`助手`
   - 搜索内容：`true`

8. **管理收藏夹**：
   - 工具：`favorite-prompt`
   - 文件名：`greeting.txt`
   - 操作：`add`

### 版本管理用法

9. **查看版本历史**：
   - 工具：`list-prompt-versions`
   - 文件名：`greeting.txt`

10. **比较版本**：
    - 工具：`compare-prompt-versions`
    - 文件名：`greeting.txt`
    - 源版本：`1`
    - 目标版本：`3`

11. **回滚到先前版本**：
    - 工具：`rollback-prompt`
    - 文件名：`greeting.txt`
    - 版本：`2`

12. **获取版本统计**：
    - 工具：`get-prompt-version-stats`
    - 文件名：`greeting.txt`

### 模板库用法

13. **浏览模板分类**：
    - 工具：`list-template-categories`

14. **使用模板**：
    - 工具：`render-template`
    - 模板ID：`coding.code-review`
    - 变量：`{"code": "function hello() { console.log('你好'); }", "language": "javascript"}`

15. **从模板创建提示词**：
    - 工具：`create-prompt-from-template`
    - 模板ID：`writing.meeting-minutes`
    - 文件名：`周会记录.txt`
    - 变量：`{"meeting_title": "周会", "date": "2024-08-04", "attendees": "Alpha团队"}`

16. **搜索模板**：
    - 工具：`search-templates`
    - 查询：`代码审查`
    - 分类：`coding`

### 导入/导出用法

17. **导出提示词进行备份**：
    - 工具：`export-prompts`
    - 包含元数据：`true`
    - 包含版本历史：`false`
    - 标签筛选：`["重要", "生产"]`

18. **从备份导入提示词**：
    - 工具：`import-prompts`
    - 导入数据：`{导出的数据对象}`
    - 创建备份：`true`
    - 覆盖现有：`false`

19. **检查导入/导出状态**：
    - 工具：`get-import-export-status`

### 高级搜索用法

20. **带参数的模糊搜索**：
    - 工具：`search-prompts`
    - 查询：`客户 服务`（故意打错字）
    - 搜索内容：`true`
    - 阈值：`0.6`
    - 限制：`15`

## 故障排除

### 如果 MCP 服务器无法连接
- 验证服务器文件路径是否正确
- 检查服务器是否有执行权限
- 确保 Node.js 版本为 v18 或更高

### 如果工具不显示
- 尝试重启 Claude Desktop
- 验证 `claude_desktop_config.json` 文件配置是否正确

### 文件访问权限问题
- 确保您对提示词目录有读/写权限

## 许可证

此项目在 MIT 许可证下授权 - 详情请参阅 [LICENSE](LICENSE) 文件。

## 贡献

欢迎贡献！请随时提交 Pull Request。

## 支持

如果您遇到任何问题或有疑问，请在 [GitHub 仓库](https://github.com/Tae4an/mcp-prompt-manager/issues) 中创建 issue。

## 其他语言
- [English](README.md)
- [한국어](README-ko.md)
- [日本語](README-ja.md)