# cc-glm 開発タスク状況

## 完了したタスク

### Phase 1: プロジェクトセットアップ ✅
- [x] package.json 作成（npmパッケージ設定、binエントリ）
- [x] tsconfig.json 作成（TypeScriptコンパイラ設定）
- [x] tsup.config.ts 作成（ビルド設定、hashbang追加）
- [x] .npmignore 作成（配布除外ファイル設定）
- [x] .gitignore 作成

### Phase 2: 設定システム ✅
- [x] src/config/types.ts - 設定値のTypeScriptインターフェース
- [x] src/config/loader.ts - YAML読み込み、環境変数展開、バリデーション

### Phase 3: コア機能（プロキシサーバー） ✅
- [x] src/proxy/types.ts - プロキシ関連型定義
- [x] src/proxy/router.ts - モデルベースルーティングロジック
- [x] src/proxy/server.ts - HTTPプロキシサーバー本体

### Phase 4: ライフサイクル管理 ✅
- [x] src/utils/process.ts - プロセスユーティリティ
- [x] src/lifecycle/tracker.ts - Claudeプロセス追跡（pgrep使用）
- [x] src/lifecycle/singleton.ts - シングルトンプロキシ管理

### Phase 5: CLI統合 ✅
- [x] src/utils/logger.ts - ロギングユーティリティ
- [x] src/bin/cli.ts - メインCLIエントリーポイント

### Phase 6: テストとドキュメント ✅
- [x] test/unit/router.test.ts - ルーティングユニットテスト
- [x] test/integration/proxy.test.ts - プロキシ統合テスト
- [x] README.md - ドキュメント
- [x] config.example.yml - 設定ファイルサンプル
- [x] vitest.config.ts - テスト設定

---

## 修正済みの問題点

### 1. CLIからのプロキシ起動が動作しない → ✅ 修正済み

**根本原因（特定・修正済み）:**
- [x] `__dirname` がESMモジュール `singleton.ts` で未定義 → `import.meta.url` ベースの定義を追加
- [x] `require()` がESMで動作しない → `singleton.ts` と `process.ts` の全 `require()` を ESM `import` 文に変更
- [x] `ensureStateDir` がロック取得後に呼ばれていた → ロック取得前に移動（ロックDirの親ディレクトリが存在しない問題を修正）
- [x] binパス修正: `./dist/cli.js` → `./dist/bin/cli.js`
- [x] serverパス修正: `dist/server.js` → `dist/proxy/server.js`
- [x] 環境変数継承: spawnのoptionsに `env: { ...process.env }` を追加
- [x] hashbang重複の修正

### 2. 設定ファイルの環境変数展開 → ✅ 修正済み

- [x] `TMPDIR` デフォルト値の重複参照を修正 (`TMPDIR ?? TMPDIR` → `TMPDIR ?? "/tmp"`)

---

## 次のステップ

### 動作確認
1. `npm link` で再インストール
2. `cc-glm` コマンドでプロキシが起動することを確認
3. ログファイルが正常に作成されることを確認

---

## テスト結果

### プロキシサーバー単体 ✅
```bash
$ ZAI_API_KEY=test node dist/proxy/server.js
Claude Router Proxy on :8787
  anthropic -> https://api.anthropic.com
  glm-*    -> https://api.z.ai/api/anthropic
```

### ルーティングテスト ✅
```bash
# Anthropic route
$ curl -X POST http://127.0.0.1:8787/v1/messages \
  -H "Authorization: Bearer test" \
  -d '{"model":"claude-opus-4-6"}'
[xxx] POST /v1/messages model=claude-opus-4-6 -> anthropic
[xxx] <- 401 (Invalid bearer token - expected)

# z.ai route
$ curl -X POST http://127.0.0.1:8787/v1/messages \
  -H "Authorization: Bearer test" \
  -d '{"model":"glm-4.7"}'
[yyy] POST /v1/messages model=glm-4.7 -> zai
[yyy] <- 401 (token expired - expected)
```

### ユニットテスト ✅
```bash
$ npm run test:run
✓ test/unit/router.test.ts  (3 tests)
✓ test/integration/proxy.test.ts  (1 test)
```

---

## ファイル構造

```
cc-glm/
├── src/
│   ├── bin/
│   │   └── cli.ts              # メインCLIエントリーポイント
│   ├── proxy/
│   │   ├── server.ts           # HTTPプロキシサーバー
│   │   ├── router.ts           # モデルベースルーティング
│   │   └── types.ts            # プロキシ関連型定義
│   ├── config/
│   │   ├── loader.ts           # YAML設定ローダー
│   │   └── types.ts            # 設定値型定義
│   ├── lifecycle/
│   │   ├── singleton.ts        # シングルトンプロキシ管理
│   │   └── tracker.ts          # Claudeプロセス追跡
│   └── utils/
│       ├── logger.ts           # ロギングユーティリティ
│       └── process.ts          # プロセスユーティリティ
├── dist/                       # コンパイル済み出力
│   ├── bin/
│   │   └── cli.js              # CLI（#!/usr/bin/env node付き）
│   └── proxy/
│       └── server.js           # スタンドアロン実行可能
├── test/
│   ├── unit/router.test.ts
│   └── integration/proxy.test.ts
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── README.md
└── config.example.yml
```

---

## 概念理解（記事より）

### 認証フロー

**Anthropic API（Claude Maxプラン）:**
- OAuth認証を使用
- Claude Codeが自動的に付与する `authorization` ヘッダーを**そのまま転送**
- API Keyは不要

**z.ai API:**
- `x-api-key` ヘッダーを使用
- OAuth `authorization` ヘッダーを削除し、`ZAI_API_KEY` を設定

### 実装ロジック

```typescript
if (target.name === "zai") {
  delete forwardHeaders["authorization"];
  forwardHeaders["x-api-key"] = target.apiKey;
}
// Anthropic: 元の認証をそのまま転送（何もしない）
```
