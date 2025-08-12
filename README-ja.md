# MCP プロンプトマネージャー

**MCP Review認証取得**

このプロジェクトは[MCP Review](https://mcpreview.com/mcp-servers/tae4an/mcp-prompt-manager)で公式認証を受けています。

MCP（Model Context Protocol）プロンプトマネージャーは、ClaudeのようなAIモデルがローカルプロンプトファイルにアクセスできるようにするサーバーです。よく使用されるプロンプトの効率的な管理のための作成、取得、更新、削除機能を提供します。

## 主な機能

### コア機能
- すべてのプロンプト一覧表示
- 特定のプロンプトコンテンツ取得
- 新しいプロンプト作成
- プロンプトコンテンツ更新
- プロンプト削除

### 高度な機能
- **インテリジェント検索**: 複数アルゴリズム（レーベンシュタイン、ジャロ・ウィンクラー、n-gram類似度）ベースの高度なファジー検索
- **カテゴリ＆タグシステム**: カテゴリとタグによるプロンプトの体系的管理
- **テンプレート処理**: `{{変数}}` 構文と高度な条件文を使用した変数置換
- **テンプレートライブラリ**: 5つのカテゴリにわたる12の専門テンプレート内蔵
- **お気に入り管理**: よく使用するプロンプトをお気に入りに設定
- **メタデータ管理**: 拡張された構成のための自動メタデータ追跡
- **バージョン管理**: 履歴追跡、diff比較、ロールバック機能を備えた完全なバージョン制御
- **インポート/エクスポートシステム**: メタデータとバージョン履歴を含むJSON形式のバックアップと復元
- **セキュリティ＆検証**: 包括的な入力サニタイゼーション、レート制限、エラー処理
- **キャッシングシステム**: パフォーマンス向上のためのインテリジェントキャッシング
- **構造化ログ**: 複数レベルとファイル出力をサポートする高度なログ

## インストール

### 前提条件

- Node.js v18以上
- npm

### インストール手順

1. リポジトリのクローン
   ```bash
   git clone https://github.com/Tae4an/mcp-prompt-manager.git
   cd mcp-prompt-manager
   ```

2. 依存関係のインストール
   ```bash
   npm install
   ```

3. 実行権限の付与
   ```bash
   chmod +x server.js
   ```

## コンテナでの実行

### Dockerで実行

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

### docker-composeで実行

```bash
docker compose up -d --build
```

### 環境変数
- PROMPTS_DIR: プロンプト保存ディレクトリ（既定: プロジェクト内 `prompts`）
- LOG_DIR: ファイルロギング出力先（既定: `./logs`）
- キャッシュ TTL/サイズ:
  - FILE_CACHE_TTL, FILE_CACHE_MAX_SIZE
  - SEARCH_CACHE_TTL, SEARCH_CACHE_MAX_SIZE
  - METADATA_CACHE_TTL, METADATA_CACHE_MAX_SIZE
  - TEMPLATE_CACHE_TTL, TEMPLATE_CACHE_MAX_SIZE
- レート制限プリセット:
  - RATE_LIMIT_STANDARD_WINDOW_MS, RATE_LIMIT_STANDARD_MAX
  - RATE_LIMIT_STRICT_WINDOW_MS, RATE_LIMIT_STRICT_MAX
  - RATE_LIMIT_LENIENT_WINDOW_MS, RATE_LIMIT_LENIENT_MAX
  - RATE_LIMIT_UPLOAD_WINDOW_MS, RATE_LIMIT_UPLOAD_MAX
 - ポリシー/権限制御:
   - READ_ONLY (true/false): 書き込み操作を禁止
   - DISABLE_IMPORT (true/false): インポート禁止
   - DISABLE_EXPORT (true/false): エクスポート禁止
   - DISABLE_VERSION_ROLLBACK (true/false): ロールバック禁止

## 運用ツール

### get-server-stats
プロセス/サーバーランタイム状態（稼働時間、メモリ、ポリシーフラグ、キャッシュ情報）
- パラメータ: なし

### get-policy-status
環境変数に基づくポリシー/権限フラグの取得
- パラメータ: なし

### get-cache-stats
ファイル/メタ/検索/テンプレート キャッシュ統計の取得（size, hit/miss, メモリ）
- パラメータ: なし

### get-rate-limit-status
standard/strict/upload レートリミッター状態の取得
- パラメータ: なし

## Claude Desktopとの接続

1. Claude Desktopのインストール（まだインストールしていない場合）
   - [Claude Desktopダウンロード](https://claude.ai/desktop)

2. Claude Desktop設定ファイルを開く:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

3. 設定ファイルに以下の内容を追加:
   ```json
   {
     "mcpServers": {
       "promptManager": {
         "command": "node",
         "args": ["クローンしたリポジトリの絶対パス/server.js"]
       }
     }
   }
   ```
   
   例:
   ```json
   {
     "mcpServers": {
       "promptManager": {
         "command": "node",
         "args": ["/Users/ユーザー名/projects/mcp-prompt-manager/server.js"]
       }
     }
   }
   ```

4. Claude Desktopを再起動

## 使用方法

Claude Desktopでツールアイコン（🛠️）をクリックして、以下のMCPツールにアクセスできます：

## コアツール

### list-prompts
すべてのプロンプトのリストを取得します。
- パラメータ: なし

### get-prompt
特定のプロンプトのコンテンツを取得します。
- パラメータ: `filename` - 取得するプロンプトファイル名

### create-prompt
新しいプロンプトを作成します。
- パラメータ: 
  - `filename` - 作成するプロンプトファイル名（例: my-prompt.txt）
  - `content` - プロンプトコンテンツ

### update-prompt
既存のプロンプトのコンテンツを更新します。
- パラメータ:
  - `filename` - 更新するプロンプトファイル名
  - `content` - 新しいプロンプトコンテンツ

### delete-prompt
プロンプトを削除します（関連メタデータも自動削除）。
- パラメータ: `filename` - 削除するプロンプトファイル名

## 高度なツール

### search-prompts
インテリジェントランキングによるファイル名またはコンテンツベースの高度なファジー検索。
- パラメータ:
  - `query` - 検索クエリ文字列
  - `searchInContent` - （オプション）プロンプトコンテンツ内検索の有無（デフォルト: false）
  - `limit` - （オプション）返す最大結果数（デフォルト: 10）
  - `threshold` - （オプション）最小類似度閾値（0.0-1.0、デフォルト: 0.3）

### tag-prompt
より良い構成のためプロンプトにタグを追加します。
- パラメータ:
  - `filename` - タグを追加するプロンプトファイル名
  - `tags` - タグ文字列の配列

### categorize-prompt
プロンプトにカテゴリを設定します。
- パラメータ:
  - `filename` - 分類するプロンプトファイル名
  - `category` - カテゴリ名文字列

### list-by-category
カテゴリ別に整理されたプロンプトリストを表示します。
- パラメータ:
  - `category` - （オプション）フィルタリングする特定のカテゴリ

### process-template
変数置換によるプロンプトテンプレート処理。
- パラメータ:
  - `filename` - テンプレートプロンプトファイル名
  - `variables` - 変数名をキー、置換値を値とするオブジェクト
- 注: テンプレートで `{{変数}}` 形式を使用

### list-template-variables
テンプレートプロンプトで見つかったすべての変数をリストします。
- パラメータ:
  - `filename` - 分析するテンプレートプロンプトファイル名

### favorite-prompt
お気に入りからプロンプトを追加または削除します。
- パラメータ:
  - `filename` - プロンプトファイル名
  - `action` - "add"または"remove"

### list-favorites
詳細情報とともにすべてのお気に入りプロンプトをリストします。
- パラメータ: なし

## バージョン管理ツール

### list-prompt-versions
タイムスタンプとアクションとともに特定のプロンプトのすべてのバージョンをリストします。
- パラメータ:
  - `filename` - バージョン履歴を取得するプロンプトファイル名

### compare-prompt-versions
プロンプトの2つのバージョンを比較し、詳細な違いを表示します。
- パラメータ:
  - `filename` - 比較するプロンプトファイル名
  - `fromVersion` - 比較元バージョン番号
  - `toVersion` - 比較先バージョン番号

### rollback-prompt
プロンプトを特定の以前のバージョンにロールバックします。
- パラメータ:
  - `filename` - ロールバックするプロンプトファイル名
  - `version` - ロールバックするバージョン番号

### get-prompt-version
プロンプトの特定バージョンのコンテンツを取得します。
- パラメータ:
  - `filename` - プロンプトファイル名
  - `version` - 取得するバージョン番号

### get-prompt-version-stats
総バージョン数、アクション分析、サイズ履歴を含むプロンプトバージョン履歴統計を取得します。
- パラメータ:
  - `filename` - 統計を取得するプロンプトファイル名

## テンプレートライブラリツール

内蔵テンプレートライブラリは5つのカテゴリにわたって12の専門テンプレートを含みます：

### 利用可能なテンプレートカテゴリ:
- **🖥️ コーディング＆開発**（3テンプレート）: コードレビュー、デバッグヘルプ、API文書化
- **🌐 翻訳＆言語**（2テンプレート）: テキスト翻訳、文法チェック
- **📝 文書作成**（2テンプレート）: 文書要約、議事録
- **📊 分析＆リサーチ**（2テンプレート）: SWOT分析、競合分析  
- **🎓 教育＆学習**（3テンプレート）: レッスンプラン、クイズ生成

### list-template-categories
説明とテンプレート数とともに利用可能なすべてのテンプレートカテゴリをリストします。
- パラメータ: なし

### list-templates-by-category
特定のカテゴリのすべてのテンプレートをリストします。
- パラメータ:
  - `categoryId` - テンプレートをリストするカテゴリID

### get-template-details
変数と使用法を含む特定のテンプレートの詳細情報を取得します。
- パラメータ:
  - `templateId` - テンプレートID（形式: category.template-name）

### search-templates
ファジーマッチングを使用してテンプレートライブラリを検索します。
- パラメータ:
  - `query` - 検索クエリ文字列
  - `category` - （オプション）特定のカテゴリでフィルタリング
  - `tags` - （オプション）フィルタリングするタグの配列
  - `limit` - （オプション）最大結果数（デフォルト: 10）

### render-template
提供された変数でテンプレートをレンダリングし、処理されたコンテンツを取得します。
- パラメータ:
  - `templateId` - レンダリングするテンプレートID
  - `variables` - 変数名と値を持つオブジェクト
  - `sanitizeOutput` - （オプション）出力サニタイゼーション有効化（デフォルト: true）

### validate-template
テンプレート構文を検証し、潜在的な問題をチェックします。
- パラメータ:
  - `templateId` - 検証するテンプレートID

### get-popular-templates
使用パターンに基づいて最も人気のあるテンプレートリストを取得します。
- パラメータ:
  - `limit` - （オプション）返すテンプレート数（デフォルト: 5）

### get-related-templates
タグとカテゴリに基づいて特定のテンプレートに関連するテンプレートを取得します。
- パラメータ:
  - `templateId` - 関連テンプレートを探すテンプレートID
  - `limit` - （オプション）関連テンプレート数（デフォルト: 3）

### get-template-library-stats
テンプレートライブラリに関する包括的な統計を取得します。
- パラメータ: なし

### create-prompt-from-template
変数置換を通じてテンプレートを使用して新しいプロンプトファイルを作成します。
- パラメータ:
  - `templateId` - 使用するテンプレートID
  - `filename` - 新しいプロンプトファイル名
  - `variables` - テンプレート変数を持つオブジェクト
  - `addMetadata` - （オプション）ファイルにテンプレートメタデータ追加（デフォルト: true）

## インポート/エクスポートツール

### export-prompts
バックアップまたは共有のためプロンプトをJSON形式でエクスポートします。
- パラメータ:
  - `format` - （オプション）エクスポート形式: "json"（デフォルト: json）
  - `includeMetadata` - （オプション）エクスポートにメタデータ含める（デフォルト: true）
  - `includeVersionHistory` - （オプション）バージョン履歴含める（デフォルト: false）
  - `filterByTags` - （オプション）プロンプトをフィルタリングするタグ配列
  - `filterByCategory` - （オプション）プロンプトをフィルタリングするカテゴリ
  - `compress` - （オプション）エクスポートデータ圧縮（デフォルト: false）

### import-prompts
検証と競合解決を通じてJSON形式からプロンプトをインポートします。
- パラメータ:
  - `importData` - エクスポート形式のインポートデータオブジェクト
  - `overwriteExisting` - （オプション）既存ファイル上書き（デフォルト: false）
  - `skipDuplicates` - （オプション）重複ファイルスキップ（デフォルト: true）
  - `validateChecksums` - （オプション）ファイルチェックサム検証（デフォルト: true）
  - `createBackup` - （オプション）インポート前バックアップ作成（デフォルト: true）
  - `mergeMetadata` - （オプション）既存メタデータとマージ（デフォルト: true）

### get-import-export-status
インポート/エクスポートシステムステータスと機能を取得します。
- パラメータ: なし

## 技術的特徴

### セキュリティ＆パフォーマンス
- **入力サニタイゼーション**: 包括的なXSSとインジェクション攻撃防止
- **レート制限**: スライディングウィンドウアルゴリズムによる設定可能なレート制限
- **キャッシングシステム**: パフォーマンス向上のためのTTLサポート多レベルLRUキャッシング
- **エラー処理**: 高度なエラー回復とログシステム
- **ファイル検証**: SHA-256チェックサムと整合性確認

### 高度なテンプレートエンジン
- **条件ロジック**: `{{#if}}`、`{{#unless}}`、`{{#each}}`構文サポート
- **ループ処理**: テンプレート内での配列とオブジェクトの反復
- **関数呼び出し**: フォーマットと処理のための内蔵ヘルパー関数
- **ネスト変数**: 複雑なオブジェクト構造サポート
- **エラー回復**: 欠落変数と不正なテンプレートの優雅な処理

### ファジー検索アルゴリズム
- **レーベンシュタイン距離**: 文字ベース類似度マッチング
- **ジャロ・ウィンクラー距離**: プレフィックスマッチングに最適化
- **N-gram類似度**: 部分文字列パターンマッチング
- **インテリジェントランキング**: カスタマイズ可能な閾値を持つ多要素スコアリング
- **ハイライト**: より良いユーザー体験のための検索結果ハイライト

### データ管理
- **バージョン制御**: diff比較による完全な履歴追跡
- **メタデータシステム**: 自動タグ付け、分類、お気に入り
- **バックアップシステム**: インポート操作中の自動バックアップ作成
- **エクスポート形式**: オプション圧縮とフィルタリングをサポートするJSON
- **ファイル構成**: 隠しメタデータディレクトリを持つ構造化ストレージ

## 高度な設定

### プロンプト保存パスの変更

デフォルトでは、プロンプトはサーバーファイルがあるディレクトリの`prompts`フォルダに保存されます。環境変数を使用してパスを変更できます：

```bash
PROMPTS_DIR=/希望/パス node server.js
```

またはclaude_desktop_config.jsonで環境変数を設定：

```json
{
  "mcpServers": {
    "promptManager": {
      "command": "node",
      "args": ["/絶対/パス/mcp-prompt-manager/server.js"],
      "env": {
        "PROMPTS_DIR": "/希望/パス"
      }
    }
  }
}
```

## 例

### 基本的な使用法

1. **新しいプロンプト作成**:
   - ツール: `create-prompt`
   - ファイル名: `greeting.txt`
   - コンテンツ: `あなたは親切で役立つAIアシスタントです。ユーザーの質問に丁寧に答えてください。`

2. **プロンプトリスト表示**:
   - ツール: `list-prompts`

3. **プロンプトコンテンツ取得**:
   - ツール: `get-prompt`
   - ファイル名: `greeting.txt`

### 高度な使用法

4. **テンプレートプロンプト作成**:
   - ツール: `create-prompt`
   - ファイル名: `email-template.txt`
   - コンテンツ: `{{名前}}様、{{製品}}にご興味をお持ちいただき、ありがとうございます。{{送信者}}より`

5. **テンプレート処理**:
   - ツール: `process-template`
   - ファイル名: `email-template.txt`
   - 変数: `{"名前": "田中太郎", "製品": "MCPサーバー", "送信者": "サポートチーム"}`

6. **プロンプト構成**:
   - ツール: `categorize-prompt`
   - ファイル名: `greeting.txt`
   - カテゴリ: `カスタマーサービス`
   
   - ツール: `tag-prompt`
   - ファイル名: `greeting.txt`
   - タグ: `["丁寧", "プロフェッショナル", "挨拶"]`

7. **プロンプト検索**:
   - ツール: `search-prompts`
   - クエリ: `アシスタント`
   - コンテンツ内検索: `true`

8. **お気に入り管理**:
   - ツール: `favorite-prompt`
   - ファイル名: `greeting.txt`
   - アクション: `add`

### バージョン管理使用法

9. **バージョン履歴表示**:
   - ツール: `list-prompt-versions`
   - ファイル名: `greeting.txt`

10. **バージョン比較**:
    - ツール: `compare-prompt-versions`
    - ファイル名: `greeting.txt`
    - 元バージョン: `1`
    - 先バージョン: `3`

11. **以前のバージョンへロールバック**:
    - ツール: `rollback-prompt`
    - ファイル名: `greeting.txt`
    - バージョン: `2`

12. **バージョン統計取得**:
    - ツール: `get-prompt-version-stats`
    - ファイル名: `greeting.txt`

### テンプレートライブラリ使用法

13. **テンプレートカテゴリ参照**:
    - ツール: `list-template-categories`

14. **テンプレート使用**:
    - ツール: `render-template`
    - テンプレートID: `coding.code-review`
    - 変数: `{"code": "function hello() { console.log('こんにちは'); }", "language": "javascript"}`

15. **テンプレートからプロンプト作成**:
    - ツール: `create-prompt-from-template`
    - テンプレートID: `writing.meeting-minutes`
    - ファイル名: `週次スタンドアップ.txt`
    - 変数: `{"meeting_title": "週次スタンドアップ", "date": "2024-08-04", "attendees": "アルファチーム"}`

16. **テンプレート検索**:
    - ツール: `search-templates`
    - クエリ: `コードレビュー`
    - カテゴリ: `coding`

### インポート/エクスポート使用法

17. **バックアップ用プロンプトエクスポート**:
    - ツール: `export-prompts`
    - メタデータ含む: `true`
    - バージョン履歴含む: `false`
    - タグフィルタ: `["重要", "本番"]`

18. **バックアップからプロンプトインポート**:
    - ツール: `import-prompts`
    - インポートデータ: `{エクスポートされたデータオブジェクト}`
    - バックアップ作成: `true`
    - 既存ファイル上書き: `false`

19. **インポート/エクスポート状態確認**:
    - ツール: `get-import-export-status`

### 高度な検索使用法

20. **パラメータ付きファジー検索**:
    - ツール: `search-prompts`
    - クエリ: `カスタマー　サーピス`（意図的な誤字）
    - コンテンツ内検索: `true`
    - 閾値: `0.6`
    - 制限: `15`

## トラブルシューティング

### MCPサーバーが接続しない場合
- サーバーファイルパスが正しいことを確認
- サーバーに実行権限があることを確認
- Node.jsバージョンがv18以上であることを確認

### ツールが表示されない場合
- Claude Desktopの再起動を試す
- `claude_desktop_config.json`ファイルが正しく設定されていることを確認

### ファイルアクセス権限問題
- プロンプトディレクトリの読み書き権限があることを確認

## ライセンス

このプロジェクトはMITライセンスの下でライセンスされています。詳細は[LICENSE](LICENSE)ファイルを参照してください。

## 貢献

貢献を歓迎します！お気軽にプルリクエストを提出してください。

## サポート

問題が発生したり質問がある場合は、[GitHubリポジトリ](https://github.com/Tae4an/mcp-prompt-manager/issues)でissueを開いてください。

## 他の言語
- [English](README.md)
- [한국어](README-ko.md)  
- [中文](README-zh.md)