# `.xtxs` プラグイン開発ガイド（コミュニティ投稿版）

[中文](EXTENSIONS.md) | [English](EXTENSIONS.en.md) | **日本語**

> 対象：**iRix Audio Player 1.0.2-extUpdate 以降** · 拡張インターフェース **ext**
> ドキュメントバージョン：2026-10-21 · リポジトリ：<https://github.com/sakihanaraku/irix-audio-player>

本ガイドは、iRix Audio Player 用のプラグインを書きたいコミュニティ開発者を対象としています。最小の動作例、マニフェストとモジュールの仕様から、
設定/コマンド、起動ウィンドウ、デバッグ、投稿の流れまで、すべて現行バージョンの実際の挙動に基づいて説明します。

> **レイアウト**：プラグインのソースは独立したディレクトリ `irix-extension/` としてワークスペースのルート（`music-player/` と同じ階層）に置かれています。
> 本ガイドは `music-player/EXTENSIONS.md` にあるため、以下のファイルパスは `music-player/` ルートからの相対パスです。
> プラグイン側のパスは `../irix-extension/...` と表記します。第 11 節の投稿手順は独立した拡張リポジトリに対応します。

**30 秒版**

1. テンプレートディレクトリをコピー：`../irix-extension/community/irix-extension-template/`
   （独立リポジトリ：<https://github.com/sakihanaraku/irix-extension-template>、そのまま clone 可能）。
2. `extension.json`（id/name/version/extensions）と `index.js`（自分のコンテナ形式）を変更。
3. `tar -cf my-plugin.xtxs -C プラグインのディレクトリ .`。
4. アプリ → 設定 → 拡張機能 → 拡張機能をインストール… → 再起動。
5. テストが通ったら拡張リポジトリへ PR を提出（ソースは `irix-extension/community/<id>/` に置くか、`.xtxs` のカタログ項目を提出）。

---

## 1. プラグインとは

プレイヤーは ffmpeg で通常の音声（FLAC/WAV/MP3/…）をデコードします。プラグインを使うと次のことができます：

- **プレイヤーに新しいコンテナを認識させる**（独自/暗号化フォーマット）。再生前に通常の音声へ復元できます。
- これらのファイルに**メタデータ**（タイトル/アーティスト/アルバム/長さ）と**カバーアート**を提供する。
- 「設定 → 拡張機能」に**宣言型の設定項目**（スイッチ/ドロップダウン/数値/テキスト）を提供する。
- **コマンドボタン**を提供する（例：キャッシュ削除、サンプル生成、セルフチェックウィンドウを開く）。
- ライフサイクルフックで初期化/後片付けを行う、または**起動時のアクティブ化**を宣言する（テストウィンドウを出す場面などに適しています）。

### 1.1 プラグインにできること

| 機能 | 対応インターフェース |
|---|---|
| コンテナのデコード | `decode(buffer, { name })` |
| メタデータの高速読み取り（音声全体をデコードしない） | `readMeta(buffer, { name })` |
| カバーアートの高速取得（キャッシュに書き込まない） | `extractCover(buffer, { name })` |
| ファイル単位の音声後処理（正規化/リサンプリングなど） | `processAudio(data, ctx)` |
| ライフサイクル | `activate(ctx)` / `deactivate()` |
| 宣言型設定 | `extension.json` の `settings` + `onSettingsChanged(values, key)` |
| コマンドボタン | `extension.json` の `commands` + `module.exports.commands` |
| 起動時のアクティブ化 | `extension.json` の `"startup": true` |

### 1.2 プラグインにできないこと

- ❌ **任意の UI を注入することはできません**：マニフェストの `settings` / `commands` から宣言型コントロールを生成できるだけです。
  HTML/JS/CSS を注入したり、プレイヤーのメイン画面レイアウトを変更したりはできません。
- ❌ **リアルタイム DSP/音響効果はできません**：リアルタイムの音声コールバックはありません。`processAudio` が扱うのは「デコード済みのファイル全体」だけです。
- ❌ **オンライン音楽ソース/検索はできません**：プラグインは「ローカルファイル → 再生可能な音声」の段階でのみ呼ばれます。
- ❌ **ストリーミング復号はできません**：`decode` / `readMeta` が受け取るのはファイル全体の `Buffer` で、同期的に返す必要があります。
- ❌ **バックグラウンド常駐はできません**：プラグインモジュールは必要なときに一度だけ読み込まれ、独自の常駐タイマー/ライフサイクル API はありません。

> これ以外の能力が必要な場合は、まず Issue でインターフェース設計を議論してください。未公開の挙動に依存するプラグインを直接書かないでください。

---

## 2. クイックスタート

### 2.1 ディレクトリ構造

```
deepseek-harness/
├── music-player/                       ← 主应用（本指南所在）
└── irix-extension/                     ← 插件源码（独立目录）
    └── community/
        └── irix-extension-template/    ← 复制这个目录，改成你自己的插件
            ├── extension.json          ← 清单（必须有）
            ├── index.js                ← 入口模块（必须有，默认 index.js）
            ├── README.md               ← 插件说明（社区投稿必须有）
            └── make-sample.mjs         ← 模板自带：生成测试用 .hello 文件
```

コピーしたらまず次を変更します：

| 変更する項目 | 変更後の内容 |
|---|---|
| ディレクトリ名 | プラグインの id（小文字/数字/`.-_`） |
| `extension.json` の `id` | ディレクトリ名と一致させる |
| `extension.json` の `name` / `description` / `author` / `version` | 自分の情報 |
| `extension.json` の `extensions` | 自分のコンテナ拡張子（ドットなし、小文字） |
| `index.js` の `MAGIC` / 解析ロジック / `match` | 自分のコンテナ形式 |
| `index.js` の `module.exports.id` | マニフェストの `id` と一致させる（可読性のため。ローダーはマニフェストを優先） |

### 2.2 `extension.json`（そのままコピーできる完全な例）

```json
{
  "id": "irix-extension-template",
  "name": "Irix Extension Template",
  "version": "1.0.0",
  "description": "iRix Audio Player 扩展模板：示例容器 .hello → 可播放音频，包含 decode/readMeta/extractCover/processAudio/生命周期/声明式设置/命令的完整写法。",
  "entry": "index.js",
  "extensions": ["hello"],
  "minAppVersion": "1.0.2-extUpdate",
  "author": "your-name",
  "license": "MIT",
  "settings": [
    {
      "key": "passthroughUnknown",
      "type": "boolean",
      "label": "未知音频头时原样放行",
      "default": false,
      "description": "识别不出真实格式时，不返回音频而是 passthrough（交给播放器原文件处理）"
    }
  ],
  "commands": [
    {
      "id": "ping",
      "label": "测试命令",
      "description": "返回插件 id/版本，验证命令接口是否接通"
    }
  ]
}
```

### 2.3 `index.js`（そのままコピーできる完全な例）

```js
'use strict';

// 示例容器格式：
//   [0, 8)         magic "HELLOXTS"
//   [8, 12)        元数据 JSON 长度 N（uint32 LE）
//   [12, 12+N)     元数据 JSON：{ title, artist, album, duration }（duration 单位毫秒）
//   [12+N, ...)    原始音频数据（FLAC/MP3/WAV/OGG/...）

const MAGIC = Buffer.from('HELLOXTS');
const MAX_HEADER = 64 * 1024;

function detectExt(buf) {
  const head = (n) => buf.subarray(0, n).toString('latin1');
  if (head(4) === 'fLaC') return 'flac';
  if (head(4) === 'OggS') return 'ogg';
  if (head(4) === 'RIFF') return 'wav';
  if (head(3) === 'ID3') return 'mp3';
  if (buf.length > 1 && buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return 'aac';
  if (head(4) === 'ftyp') return 'm4a';
  return null;
}

function splitContainer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) throw new Error('文件太短，不是 HELLOXTS 容器');
  if (!buffer.subarray(0, 8).equals(MAGIC)) throw new Error('魔数不匹配（不是 .hello 容器）');
  const headLen = buffer.readUInt32LE(8);
  if (headLen < 2 || headLen > MAX_HEADER || 12 + headLen > buffer.length) {
    throw new Error('容器头部长度不合法');
  }
  let meta = null;
  try {
    const j = JSON.parse(buffer.subarray(12, 12 + headLen).toString('utf8'));
    if (j && typeof j === 'object') {
      meta = {
        title: String(j.title || ''),
        artist: String(j.artist || ''),
        album: String(j.album || ''),
        duration: Number(j.duration) || 0,   // 毫秒
      };
    }
  } catch { meta = null; }
  return { meta, data: buffer.subarray(12 + headLen) };
}

let currentSettings = { passthroughUnknown: false };

function decode(buffer) {
  const { meta, data } = splitContainer(buffer);
  if (!data.length) throw new Error('容器里没有音频数据');
  const ext = detectExt(data);
  if (!ext && currentSettings.passthroughUnknown) {
    return { data: Buffer.alloc(0), ext: 'bin', meta, passthrough: true };
  }
  if (!ext) throw new Error('无法识别容器里的音频格式');
  return { data, ext, meta, passthrough: false };
}

/** 加入列表快速路径：只读元数据，不复制音频 */
function readMeta(buffer) {
  try { return splitContainer(buffer).meta; } catch { return null; }
}

module.exports = {
  id: 'irix-extension-template',
  match: /\.hello$/i,

  activate(ctx) {
    currentSettings = { ...ctx.settings };
    ctx.log('irix-extension-template activated', ctx.extension.version);
  },
  deactivate() { /* 释放资源 */ },
  onSettingsChanged(values) { currentSettings = { ...values }; },
  commands: {
    async ping(ctx) { return `irix-extension-template v${ctx.extension.version} OK`; },
  },

  decode,
  readMeta,
};
```

### 2.4 パッケージ化・インストール・検証

```powershell
# 1) 打包（.xtxs 就是 tar 包；-C 指定源目录，. 表示把目录内容放在包根）
tar -cf iRix-Extension-irix-extension-template-1.0.0.xtxs -C ..\irix-extension\community\irix-extension-template .

# 2) 检查包内容（应看到 extension.json / index.js / README.md）
tar -tf iRix-Extension-irix-extension-template-1.0.0.xtxs
```

1. プレイヤー → **設定 → 拡張機能 → 拡張機能をインストール…** → `.xtxs` を選択。
2. 「変更されました。アプリを再起動すると反映されます」と表示されたら **アプリを再起動** をクリック。
3. テストファイルを生成（任意の flac/mp3 を `.hello` で包む）：

```powershell
node ..\irix-extension\community\irix-extension-template\make-sample.mjs .\song.flac .\song.hello
```

4. 再起動後、ファイルブラウザに `.hello` ファイルが見えます。プレイリストに追加します：
   - 項目は**即座に表示**されるはずです（`readMeta` の高速パスを通る）。
   - 再生時のタイトル/アーティスト/アルバム/長さはコンテナのメタデータ由来。
   - 設定ページにテンプレートのスイッチ設定とテストコマンドが表示され、変更/クリックに即座に反応するはずです。

---

## 3. `.xtxs` パッケージ形式

- `.xtxs` = **tar パッケージ**（非圧縮）。拡張子は単なる取り決めです。
- パッケージの**ルート**に `extension.json` が必須。`index.js`、`README.md`、任意で `LICENSE` を持たせることを推奨。
- パッケージ内にディレクトリを一層余分に挟んでも構いません（インストーラーが単層のラップを自動的に剥がします）が、ファイルはパッケージのルートに直接置いてください。
- インストール時にアプリは OS の `tar -xf` で展開します（Windows 10 以降は bsdtar を同梱、サードパーティ依存ゼロ）。
- `.zip` もダイアログで受け付けますが bsdtar に依存します。**Linux/macOS では標準の `.xtxs`（tar）を使ってください**。
- ファイル名の推奨：`iRix-Extension-<id>-<version>.xtxs`。
- `node_modules`、ネイティブの `.node` モジュール、実行ファイルは入れないでください（第 8 節の安全ルールを参照）。

インストール後の配置（アプリが管理）：

```
<userData>/extensions/<id>/extension.json
<userData>/extensions/<id>/index.js
```

- ポータブル版：`userData` = exe と同じディレクトリにある `iRixAudioPlayer-data/`。
- インストール版：`userData` = OS のアプリデータディレクトリ（`%APPDATA%` 配下）。

インストール = 展開 → マニフェスト検証 → `extensions/<id>/` へコピー → 自動的に有効化。
**インストール/アンインストール/有効化の切り替え後は、いずれもアプリの再起動が必要です**（ファイル拡張子テーブルとモジュールキャッシュは起動時に構築されます）。
設定の永続値は `settings.json` の `extensionSettings.<id>` に保存されます。アンインストール時に自動で削除されます。

---

## 4. `extension.json` フィールド仕様

| フィールド | 必須 | 型 | 説明 |
|---|---|---|---|
| `id` | ✅ | string | 一意な id：`^[a-z0-9][a-z0-9._-]{1,48}$`（大文字小文字は区別しない、すべて小文字を推奨）。ディレクトリ名 = id |
| `name` | ✅ | string | 表示名 |
| `version` | ✅ | string | バージョン番号、セマンティックバージョニングを推奨 |
| `description` | ✅ | string | 一文の説明 |
| `entry` | 任意 | string | エントリーファイル（プラグインディレクトリからの相対パス）、デフォルトは `index.js` |
| `extensions` | 推奨 | string[] | 扱えるコンテナ拡張子（ドットなし、小文字）。再起動後にファイルブラウザに表示されます |
| `minAppVersion` | 任意 | string | 最低アプリバージョン。**現状はメタデータの表示のみで、ローダーは強制検証しません** |
| `author` | 推奨 | string | 作者名/ID |
| `homepage` | 任意 | string | プラグインのホームページ/ソース URL（ローダーは無視、カタログ表示用） |
| `license` | 任意 | string | ライセンス識別子（ローダーは無視、カタログ表示用） |
| `startup` | 任意 | boolean | `true` = アプリ起動時に自動で `activate()`（ダイアログ/バックグラウンド補助系プラグイン向け） |
| `settings` | 任意 | array | 宣言型の設定項目（最大 32 項目） |
| `commands` | 任意 | array | コマンドボタン（最大 16 項目） |

### 4.1 `settings` 設定項目

```js
{
  key: 'quality',                 // ^[a-z0-9][a-z0-9._-]{0,63}$
  type: 'select',                 // text | number | boolean | select
  label: '处理质量',               // 最长 80 字符
  description: '可选说明',         // 最长 240 字符
  default: 'high',
  options: [{ value: 'low', label: '快速' }, { value: 'high', label: '高质量' }]
}
```

- `number` は `min` / `max` / `step` をサポートし、範囲外の値は clamp されます。
- `boolean` のデフォルトは `true`（明示的に `default: false` を指定しない限り）。
- `select` の `options` は最大 24 項目、値はホワイトリスト内でなければなりません。
- テキスト値は最大 4096 文字。不正/未知の項目は破棄または拒否され、アプリがクラッシュすることはありません。

設定値はメインプロセスが保存し、プラグインの `activate(ctx)` 時に `ctx.settings` として提供されます（デフォルト値 + 保存済みの値）。
ユーザーが設定を変更すると `onSettingsChanged(values, key)` が呼ばれます。このフックを実装していない場合、設定ページは再起動を促します。

### 4.2 `commands` コマンドボタン

```js
{ id: 'clear-cache', label: '清理解码缓存', description: '删除本扩展的解码缓存' }
```

モジュール内で同名の関数をエクスポートします：

```js
module.exports = {
  commands: {
    async 'clear-cache'(ctx) {
      return '已清理 3 个缓存文件';   // 返回值显示在设置页状态行
    },
  },
};
```

- コマンドはメインプロセスで実行され、async でも構いません。
- 例外を投げると「実行に失敗しました：…」と表示され、アプリには影響しません。
- 同名の関数を実装していない場合は「プラグインはこのコマンドを実装していません」と表示されます。

---

## 5. `index.js` モジュールインターフェース

プラグインのエントリは **CommonJS** モジュールで、**メインプロセス**で読み込まれます（レンダラーでは動作しません）。そのため
`node:fs` / `node:crypto` などの Node 組み込みモジュールを利用できます。

### 5.1 エクスポートの形

```js
module.exports = {
  id: 'my-plugin',                  // 可选，与 manifest.id 一致
  match: /\.xyz$/i,                 // 必须：RegExp（对文件名 basename 测试）

  decode(buffer, { name }) {        // 容器解码，必须同步
    return {
      data: Buffer,                 // 解码出的原始音频
      ext: 'flac',                  // 真实格式（不带点）
      meta: { title, artist, album, duration }, // 可选，duration 单位毫秒
      cover: Buffer,                // 可选：JPEG/PNG 封面
      passthrough: false,           // 可选：true = 原样交给播放器
    };
  },

  readMeta(buffer, { name }) { /* 可选：只读元数据，返回 meta 或 null */ },
  extractCover(buffer, { name }) { /* 可选：返回封面 Buffer 或 null */ },
  processAudio(data, ctx) { /* 可选：返回 Buffer 或 { data, ext } */ },
  activate(ctx) { /* 可选：模块加载完成 */ },
  deactivate() { /* 可选：卸载/禁用/退出 */ },
  onSettingsChanged(values, key) { /* 可选：设置变更 */ },
  commands: { /* 可选：与 manifest.commands 对应 */ },
};
```

### 5.2 `match`

- **RegExp** でなければなりません（ローダーは `instanceof RegExp` で判定）。
- **ファイル名**（basename）に対してのみテストし、フルパスにはマッチしません。
- 複数のプラグインが同時にマッチした場合、拡張機能の表示名でソートして最初のものが有効になります → `match` はできるだけ正確に。
  例えば `/\.hello$/i` とし、`/hello/i` は使わないでください。
- 大文字小文字は必要に応じて `i` を付けます。

### 5.3 コアインターフェース

| インターフェース | 必須 | 説明 |
|---|---|---|
| `decode(buffer, { name })` | はい（メタデータ専用のプラグインなら省略可） | **同期必須**。`{ data, ext, meta?, cover?, passthrough? }` を返す |
| `readMeta(buffer, { name })` | 任意 | **同期必須**。`meta`（`duration` はミリ秒）または `null` のみを返す。プレイリスト追加の高速パスに使用。`null` を返すと完全デコードにフォールバック |
| `extractCover(buffer, { name })` | 任意 | **同期必須**。JPEG/PNG の `Buffer`（64 バイト超）または `null` を返す。カバー読み取り時に優先して呼ばれ、キャッシュには書き込まない |
| `processAudio(data, ctx)` | 任意 | **同期必須**。`Buffer` または `{ data, ext }` を返す。`ctx = { name, ext, meta, sourcePath }`。これは**ファイル単位の後処理**であり、リアルタイム DSP ではありません |

呼び出しのタイミング（同じファイルが複数回呼ばれる可能性があるため、**副作用なし・繰り返し可能**でなければなりません）：

1. **プレイリストへの追加**：優先的に `readMeta()`。存在しない/失敗 → 完全な `decode()` + ffprobe。
2. **再生**：完全な `decode()` の後に任意の `processAudio()`、結果はデコードキャッシュに書き込まれる。
3. **カバーアート**：優先的に `extractCover()`。なければデコード済み音声/sidecar から読み取る。

**同期の要件**：プレイヤーは戻り値を直接読み取り、`await` しません。`Promise` を返すと「結果なし」と見なされ、
**エラーは出ないが反映されない**という挙動になります（最もよくある初歩的な罠）。

**性能とメモリ**：ファイル全体がメモリ上にあり、メインプロセスで同期実行されます → 長時間ブロックしないでください。
大きなファイルではメモリ使用量を見積もってください。ヘッダーだけ読めば済むなら全体をスキャンしないでください。

**堅牢性**：長さ/オフセットを必ず検証してください（テンプレートの `headLen` チェックを参照）。壊れたファイルは例外を投げるべきで、
範囲外のメモリ確保や無限ループになってはいけません。

### 5.4 `decode` の戻り値

| キー | 型 | 説明 |
|---|---|---|
| `data` | Buffer | **必須**（`passthrough` を除く）。生の音声バイト |
| `ext` | string | **必須**（`passthrough` を除く）。実際の形式：`flac`/`mp3`/`wav`/`ogg`/`m4a`/`aac`/`opus` など |
| `meta` | object | 任意。フィールドは下表 |
| `cover` | Buffer | 任意。JPEG/PNG。2 MB 以下、1024×1024 以下を推奨 |
| `passthrough` | boolean | 任意。`true` = 自分のコンテナではない/デコード結果が通常の音声で、プレイヤーは元ファイルで続行 |

`meta` フィールド：

| フィールド | 型 | 説明 |
|---|---|---|
| `title` | string | タイトル |
| `artist` | string | アーティスト |
| `album` | string | アルバム |
| `duration` | number | **ミリ秒**（3 分 15 秒 = `195000`）。プレイヤー内部で `/1000` される |

### 5.5 ライフサイクル、設定、コマンド

```js
activate(ctx) {
  // ctx = {
  //   appVersion: '1.0.2-extUpdate',
  //   extension: { id, name, version, dir },
  //   settings: { ...默认值 + 已保存值 },
  //   log: (...args) => void,   // 主进程日志
  // }
}
deactivate() { /* 释放资源 */ }
onSettingsChanged(values, key) { /* 用户改了设置 */ }
```

- `activate` は Promise を返しても構いません（アプリは完了を待ちません。非同期の失敗はログに記録されるだけで、他の機能には影響しません）。
- `deactivate` はアンインストール/無効化/アプリ終了時に呼ばれます（best effort）。
- `ctx.settings` は読み取り専用のスナップショットです。自分で `settings.json` を書かないでください。永続設定はマニフェストの `settings` を使ってください。
- `commands` の実装は `module.exports.commands` オブジェクトに置きます。引数は `ctx` と同じです。

### 5.6 エラー処理

- 直接 `throw new Error('読みやすい日本語の理由')`。
- 再生時のエラーは「拡張機能の復号に失敗しました：…」と表示されます。`processAudio` の失敗は「拡張機能の音声処理に失敗しました：…」。
  プレイリスト追加の失敗は「デコードできません」と表示されます。設定/コマンドのエラーは設定ページのステータス行に表示されます。
- `process.exit()` を呼んだり、`app.quit()` を呼んだり、OS のダイアログを出したりしないでください。
- 常駐タイマーを起動したりポートを待ち受けたりしないでください — プラグインは必要なときにだけ呼ばれ、独自のライフサイクル管理はありません。

---

## 6. ランタイムとキャッシュ

- デコード結果はアプリがキャッシュし、プラグイン自身はファイルを書きません：
  - 場所：`<userData>/decode-cache/`。
  - キャッシュキー：`sha1(元ファイルのパス + ファイルサイズ + mtime + プラグイン id@version)` → プラグインを更新すると古いキャッシュにヒットしません。
  - キャッシュファイル：`<key>.<ext>` + 同名の `.meta.json` / `.cover.img` sidecar。
- `readMeta` の高速パスは**デコードキャッシュを書きません**。実際に再生するときにデコードしてキャッシュします。
- プラグインのコードを変えたのに `version` を上げていない場合、古いファイルが古いキャッシュにヒットすることがあります → `decode-cache/` を削除するかテストファイルを変えてください。
- 元ファイルは変更/移動されません。プラグインが自分でキャッシュを書く必要はありません。
- プラグインモジュールは 1 プロセスにつき一度しか `require` されません → コードを変えたらアプリを再起動してください。
- 有効リストは `settings.enabledExtensions`、設定値は `settings.extensionSettings`。
- 読み込みに失敗したプラグインは黙ってスキップされます（起動には影響しません）→ デバッグ時はまずメインプロセスのログを見る / Node で単体テストしてください。

---

## 7. 起動時のアクティブ化とウィンドウ

マニフェストで `"startup": true` を宣言したプラグインは、アプリ起動時（メインウィンドウ作成後）に自動で `activate(ctx)` が呼ばれます。
これは**テストウィンドウ**やバックグラウンド補助が必要なプラグインに適しています（ワークスペースの `../irix-extension/qa/test-interfaces/` がその例です）。

Electron のメインプロセス内で、プラグインは `require('electron')` でウィンドウを作成できますが、次に従うことを推奨します：

- `contextIsolation: true`、`nodeIntegration: false`。
- `preload.js` + `contextBridge` で最小限の API を公開し、ウィンドウのページから Node を直接触らせない。
- IPC チャネルには一意なプレフィックスを使い（例：`irix-test-interfaces:*`）、`deactivate()` 時に `ipcMain` ハンドラーを外してウィンドウを閉じる。
- ウィンドウ作成の失敗は `ctx.log` に記録するだけにし、アプリの起動を失敗させない（`activate` 内で try/catch）。
- Electron 以外の環境（Node 単体テスト）では `require('electron')` で BrowserWindow が取得できない → 優雅にスキップする。

> プラグインはメインプロセスで動作し、完全な Node 権限を持ちます。宣言型の設定/コマンドは**UI を制限するだけ**で、権限を分離しません。
> 必要な能力だけを書き、第 8 節のセキュリティレビューに従ってください。

---

## 8. セキュリティモデルと投稿レビュー

> **プラグイン = 信頼されたローカルコード**です。メインプロセスで動作し、アプリと同等の Node 権限を持ちます
> （ファイルの読み書き、子プロセスの起動、ネットワークアクセス……）。アプリにプラグインのサンドボックスはありません。
> ユーザーがプラグインを入れる = そのコードの実行に同意することです。信頼できる入手元からのみインストールしてください。

投稿レビューのチェックリスト：

- [ ] **純粋な JavaScript**：ネイティブの `.node` モジュールなし、npm 依存なし（プラグインディレクトリにインストール手順はありません）。
- [ ] **リモートコードの読み込みなし**：`eval` / `new Function` / コードのダウンロードと実行をしない。
- [ ] **最小権限**：プラグインディレクトリの外に書き込まない（キャッシュはアプリが担当）、ユーザーの音楽ファイルを変更しない。
- [ ] **ネットワークは任意かつ宣言**：デフォルトでネットワークリクエストを送らない。必要な場合は README に明記。
- [ ] **子プロセスなし**：`child_process` で外部プログラムを呼ばない。どうしても必要な場合は PR で理由を説明。
- [ ] **テレメトリ/プライバシー収集なし**：ユーザーのパス、ファイル名、音声内容をアップロードしない。
- [ ] **堅牢**：切り詰め/偽造/巨大ファイルでもクラッシュせず OOM しない（最低限、長さとオフセットを検証）。
- [ ] **性能**：同期フックは 1 ファイルあたり概ね 1 秒未満（大きなファイルは別途）。
- [ ] **設定/コマンドの安全性**：コマンドロジックで入力を検証。ユーザー設定値をそのままシェルコマンドに連結しない。
- [ ] **著作権上の問題なし**：コードは自作または互換ライセンスを使用し、サードパーティのライブラリ/素材を含めない。
      ユーザーが**自ら合法的に所有する**ファイルのみを扱い、著作権保護されたキー/コンテンツを内蔵しない。
- [ ] **ドキュメント**：ディレクトリ内に `README.md`（機能、形式、既知の制限、テスト方法）。
- [ ] **マニフェストが正当**：id が一意で正規表現に適合、version が増加、extensions の拡張子が正確、settings/commands が読める。

メンテナーはマージ前に、実際のインストール + 実ファイルでの再生 + 設定/コマンドの検証を行います。

---

## 9. パッケージ化

### 9.1 Windows PowerShell

```powershell
tar -cf "iRix-Extension-myplugin-1.0.0.xtxs" -C "..\irix-extension\community\myplugin" .
tar -tf "iRix-Extension-myplugin-1.0.0.xtxs"
Get-FileHash "iRix-Extension-myplugin-1.0.0.xtxs" -Algorithm SHA256 | Format-List
```

### 9.2 Linux / macOS / Git Bash

```bash
tar -cf "iRix-Extension-myplugin-1.0.0.xtxs" -C "../irix-extension/community/myplugin" .
tar -tf "iRix-Extension-myplugin-1.0.0.xtxs"
sha256sum "iRix-Extension-myplugin-1.0.0.xtxs"
```

### 9.3 公式の組み込み拡張機能（メンテナー向け）

公式拡張機能のソースはリポジトリ外の `../extensions-src/<id>/` に置き、次を使います：

```bash
node scripts/build-extension.mjs
# 输出：dist/iRix-Extension-<id>-<version>.xtxs
```

コミュニティプラグインは `../irix-extension/community/<id>/` で 9.1 に従ってパッケージ化します。

### 9.4 リポジトリ同梱のテンプレートプラグインをパッケージ化する

メインリポジトリにはテンプレートプラグインのパッケージ化スクリプトがあります（出力は `dist/`、アプリにインストールして検証できます）：

```bash
node scripts/build-template-plugin.mjs
# 输出：dist/iRix-Extension-irix-extension-template-1.0.0.xtxs
# 或：npm run pack:template-plugin
```

インストール手順は第 10 節と同じ：設定 → 拡張機能 → 拡張機能をインストール… → `.xtxs` を選択 → 再起動。
テンプレートプラグインの `.hello` サンプルファイルは `../irix-extension/community/irix-extension-template/make-sample.mjs` で生成できます。

---

## 10. インストールとデバッグ

### 10.1 アプリでインストール（推奨）

設定 → **拡張機能** → **拡張機能をインストール…** → `.xtxs` を選択 → 「アプリを再起動」をクリック。
インストール後はデフォルトで有効になります。設定リストには名前/バージョン/説明が表示され、オン/オフ、アンインストールが可能です。
`settings` / `commands` を宣言したプラグインは、カード内に対応するコントロール/ボタンが生成されます。

### 10.2 手動インストール（開発デバッグ）

1. 一度インストールした後、`<userData>/extensions/<id>/` 配下のファイルを直接編集します。
2. 変更のたびにアプリを再起動します（モジュールにはプロセス内キャッシュがあります）。
3. またはソースから `npm start` で起動すると、メインプロセスの `console.log` がターミナルに表示されます。

> ポータブル版の例：`<exe のあるディレクトリ>\iRixAudioPlayer-data\extensions\<id>\`。
> インストール版は実際のデータディレクトリに依存します。

### 10.3 アプリを起動せずに Node で単体テスト（強く推奨）

`index.js` は普通の CommonJS モジュールなので、Node で直接実行できます：

```js
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const plugin = require('../irix-extension/community/irix-extension-template/index.js');

const buf = fs.readFileSync('song.hello');
const r = plugin.decode(buf, { name: 'song.hello' });
console.log(r.ext, r.meta, r.data.length);
console.log(plugin.readMeta(buf, { name: 'song.hello' }));
```

カバーすることを推奨：

- 正常なコンテナ → `ext` / `meta` / `cover` / `data` の長さが正しい。
- `readMeta` はメタデータのみを返し、壊れたファイルは `null` を返す。
- 切り詰め/誤ったマジック/空ファイル → 読めるエラーを投げ、クラッシュしない。
- コンテナを装った通常の音声 → `passthrough: true`（形式が対応していれば）。
- 同じ入力を 2 回連続で呼んでも結果が同じ（副作用なし）。

参考：`test/ncm-ext-unit.mjs`（公式 NCM 拡張機能の 22 項目のラウンドトリップテスト）。

### 10.4 テンプレートとインターフェーステスト用プラグイン

```bash
node ../irix-extension/community/irix-extension-template/make-sample.mjs input.flac song.hello
node test/extensions-guide-unit.mjs     # 文档/模板/真实 .xtxs 安装流程（23 项，含三语指南）
node test/extensions-api-unit.mjs       # 生命周期/设置/命令（14 项）
node test/extensions-test-plugin-unit.mjs  # 测试插件（17 项）
```

ワークスペースには**開発セルフテスト用プラグイン** `../irix-extension/qa/test-interfaces/` もあります：

- マニフェスト `"startup": true` → アプリ起動時に「iRix 拡張機能インターフェーステスト」ウィンドウが自動で開きます。
- ウィンドウでは `ctx/設定/readMeta/decode/extractCover/processAudio/commands/ウィンドウ` をワンクリック/項目ごとに確認でき、
  **再生可能な `.testext`**（1 秒の無音 WAV 入り）を生成してエンドツーエンドの検証に使えます。
- 設定ページにもその設定項目と 3 つのコマンド（ウィンドウを開く/セルフチェック/テストファイル生成）が表示されます。

```powershell
tar -cf dist/iRix-Extension-test-interfaces-1.0.0.xtxs -C ..\irix-extension\qa\test-interfaces .
```

---

## 11. コミュニティ投稿の流れ

メインプロジェクトの公開リポジトリ：<https://github.com/sakihanaraku/irix-audio-player>
拡張機能ソースリポジトリ：ワークスペースの独立ディレクトリ `irix-extension/`（`music-player/` と同じ階層。現在は GitHub リポジトリとして単独公開されていません）

### 11.1 方法 A：ソースを拡張リポジトリに入れる（推奨）

1. 拡張リポジトリを Fork/コピー。
2. `irix-extension/community/<your-plugin-id>/` に次をコミット：
   - `extension.json`（必須）
   - `index.js`（必須、またはマニフェストで指定したエントリ）
   - `README.md`（必須：機能、形式、制限、テスト方法）
   - `LICENSE`（任意、推奨）
   - `test/` または `fixtures/`（任意：合成サンプル/単体テスト。**著作権保護された音楽ファイルはコミットしないでください**）
3. ローカルで第 9 節に従ってパッケージ化し、第 10 節に従ってインストール検証。
4. PR を提出、タイトル：`[extension] <name> v<version>`。
5. PR の説明に添付：プラグインの id/バージョン/対応拡張子/宣言した設定とコマンド、テストしたアプリのバージョンとプラットフォーム、
   テストファイルの生成方法、`.xtxs` の SHA-256。

### 11.2 方法 B：自分でホストして公開し、カタログ項目を提出

1. 自分のリポジトリの GitHub Releases で `.xtxs` を公開（SHA-256 を添付）。
2. PR を提出し、`irix-extension/community/CATALOG.md` に 1 行追加（形式はそのファイルを参照）。
3. メンテナーがダウンロード → SHA-256 を検証 → インストール → 実際の再生/設定/コマンドを検証してからマージ。

### 11.3 バージョンと更新

- 同じ `id` を再インストールすると旧バージョンが上書きされます（`extensions/<id>/` を丸ごと置換）。
- リリースごとに `version` を上げ、README に CHANGELOG を記録。
- キャッシュキーには `id@version` が含まれるため、更新後は古いキャッシュにヒットしません。
- 破壊的な形式変更ではメジャーバージョンを上げ、`minAppVersion` に必要なアプリバージョンを明記することを推奨
  （現在のローダーは強制検証せず、メタデータとしてのみ扱います）。

### 11.4 レビュー結果

- 承認：PR をマージし、メンテナーが `.xtxs` を作成して Release/カタログに添付。
- 修正が必要：PR に記載（セキュリティ、性能、マニフェスト、ドキュメントなど）。
- 受け付け不可：リモートコード、ネイティブモジュール、著作権コンテンツ、悪意ある挙動、または現在のインターフェース範囲を超えるプラグイン。

---

## 12. よくある質問（FAQ）

| 症状 | 考えられる原因 / 対処 |
|---|---|
| インストール時に「これは拡張パッケージではありません（extension.json がありません）」 | パッケージ化時にディレクトリを一層余分に入れ子にした。`tar -cf x.xtxs -C <dir> .` を使う |
| インストール時に「拡張機能の id が不正です」 | id が `^[a-z0-9][a-z0-9._-]{1,48}$` に適合しない（2–49 文字、小文字始まり） |
| インストール後、ファイルブラウザに拡張子が表示されない | `extensions` にその拡張子がない / 再起動していない / 拡張子にドットが付いている |
| ファイルはプレイリストに追加できるが再生時にデコードできない | `decode` が例外を投げた、Promise を返した、`ext` が違う、`data` が Buffer でない |
| `decode` を書いたのに全く反映されない | 再起動を忘れた。`match` が basename にマッチしていない。`decode` をエクスポートしていない |
| プレイリストへの追加が遅い/固まる | `readMeta()` の高速パスを実装し、`decode` で重い処理をしない |
| プラグインのコードを変えても反映されない | モジュール/デコードキャッシュ → アプリを再起動。開発中は `decode-cache/` を削除 |
| 長さが 0 または不正確 | `meta.duration` の単位を秒で書いた、**ミリ秒**が正しい |
| カバーアートが表示されない | `cover` が小さすぎる（64 バイト未満は無視）か JPEG/PNG でない。`extractCover` が Buffer 以外を返した |
| 設定を保存しても反映されない | プラグインが `onSettingsChanged` をエクスポートしていないと再起動を促される。実装すれば即時反映 |
| コマンドで「プラグインはこのコマンドを実装していません」と表示される | マニフェストでコマンドを宣言したが `module.exports.commands` に同名関数がない |
| 起動時のダイアログがクラッシュ/応答なし | ウィンドウ作成に try/catch がない、IPC チャネルの衝突、preload で nodeIntegration を使用。第 7 節を参照 |
| 複数のプラグインがファイルを取り合う | `match` が広すぎる。正確な正規表現に変更 |
| ファイルを開く/再生時にフリーズ | `decode`/`readMeta`/`processAudio` の無限ループ、または巨大なメモリ確保 |
| ファイルを変更したのに古い音のまま | `decode-cache/` にヒットし、プラグインのバージョンも変わっていない。キャッシュディレクトリを削除するかファイルを touch |

---

## 13. 英語サマリー（国際的なコントリビューター向け）

拡張機能は **tar パッケージ（`.xtxs`）** で、`extension.json` と CommonJS のエントリ
（`index.js`）を含み、Electron の**メインプロセス**で読み込まれます。

```js
module.exports = {
  match: /\.xyz$/i,
  decode(buffer, { name }) {           // SYNCHRONOUS
    return {
      data: Buffer,                    // decoded audio bytes
      ext: 'flac',                     // real format, no dot
      meta: { title, artist, album, duration /* ms */ },
      cover: Buffer,                   // optional JPEG/PNG
      passthrough: false,
    };
  },
  readMeta(buffer, { name }) { /* optional sync: meta or null */ },
  extractCover(buffer, { name }) { /* optional sync: Buffer or null */ },
  processAudio(data, ctx) { /* optional sync: Buffer or { data, ext } */ },
  activate(ctx) {},                 // ctx: { appVersion, extension, settings, log }
  deactivate() {},
  onSettingsChanged(values, key) {},
  commands: { async ping(ctx) { return 'pong'; } },
};
```

`extension.json` では `settings`（text/number/boolean/select）と `commands` を宣言でき、
設定 → 拡張機能で宣言型コントロールとして描画されます。
`"startup": true` を指定すると、アプリ起動時に拡張機能がアクティブ化されます。

ルール：純粋な JavaScript のみ（ネイティブモジュールなし、npm 依存なし）、リモートコードなし、
子プロセスなし、すべての長さ/オフセットを検証し、冪等で適度に高速であること。
プラグインはメインプロセスの権限を持つ信頼されたローカルコードです — 慎重にレビューしてください。
宣言型 UI はインターフェースを制限するだけで、実行時の権限を制限する**ものではありません**。

ビルド / コントリビュート：

```bash
tar -cf iRix-Extension-my-plugin-1.0.0.xtxs -C ../irix-extension/community/my-plugin .
node test/extensions-guide-unit.mjs
node test/extensions-api-unit.mjs
# PR: add irix-extension/community/<id>/{extension.json,index.js,README.md}
```

実行可能なテンプレートは `irix-extension/community/irix-extension-template/`（`music-player/` のワークスペース隣接ディレクトリ）にあります。

---

## 付録 A：テンプレートのコンテナ形式（例のみ）

```
偏移   长度     内容
0      8        "HELLOXTS"（ASCII 魔数）
8      4        头部 JSON 长度 N（uint32 little-endian）
12     N        头部 JSON（UTF-8）：{ title, artist, album, duration }
12+N   ...      原始音频数据（FLAC/MP3/WAV/OGG/...）
```

`duration` の単位は**ミリ秒**です。これはテンプレート独自の形式にすぎず、正式なプラグインは実際の形式に合わせて実装してください。

## 付録 B：ディレクトリとファイルの一覧

```
irix-extension/community/<id>/
├── extension.json      # 必填；id 与目录名一致；settings/commands 可选
├── index.js            # 必填；CommonJS；同步钩子；match 精确
├── README.md           # 必填；功能/格式/限制/测试方式
├── LICENSE             # 推荐；MIT 等兼容许可证
└── (可选) test/ fixtures/ make-sample.mjs …
```

パッケージ化後の `tar -tf` は次のようになるはずです：

```
./
./extension.json
./index.js
./README.md
```

> 提出前に確認してください：`node test/extensions-guide-unit.mjs`、`node test/extensions-api-unit.mjs`、
> `node test/extensions-test-plugin-unit.mjs` が通り、かつ第 10 節に従ってアプリ内で実際の再生/設定/コマンドが成功すること。
