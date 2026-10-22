# サードパーティコンポーネントとライセンス表記（THIRD-PARTY NOTICES）

[中文](THIRD-PARTY-NOTICES.zh-CN.md) | [English](THIRD-PARTY-NOTICES.md) | **日本語**

iRix Audio Player 本体は MIT ライセンスで公開されています（`LICENSE` 参照）。**パッケージに同梱、または実行時に依存する**サードパーティコンポーネントは以下のとおりです。
本ファイルはインストーラーに同梱されます（`package.json` の `build.files` に含まれています）。

## 1. アプリに同梱されるコンポーネント

| コンポーネント | ライセンス | 説明・義務 |
|---|---|---|
| **Electron** | MIT | アプリケーションのシェル。配布物には `LICENSE.electron.txt` と `LICENSES.chromium.html`（後者は 14.8 MB で、Chromium とそのすべてのサードパーティライブラリを収録）が含まれ、パッケージにも同梱されます ✓ |
| **Chromium** | BSD-3-Clause | Electron に内蔵。Apache-2.0 / LGPL / MIT などのライブラリを含み、すべて `LICENSES.chromium.html` に列挙されています |
| **Node.js** | MIT | Electron に同梱されるランタイム |
| **Material Symbols / Icons** | Apache-2.0 | タイトルバーの「音符」アイコンは `music_note` を使用しています。ライセンス全文：<https://www.apache.org/licenses/LICENSE-2.0>、上流リポジトリ：<https://github.com/google/material-design-icons> |

> Electron / Chromium / Node の完全なライセンス全文は Electron のパッケージング工程が提供します（製品ルートの `LICENSE.electron.txt`、`LICENSES.chromium.html` を参照）。本ファイルでは再掲しません。

## 2. パッケージに同梱される外部プログラム：FFmpeg / ffprobe（**GPLv3**）

> ⚠️ **2026-10-16 訂正**：本節は以前「パッケージに同梱されない」と記載していました ✗。これは**誤り**です。実際には `package.json` の `build.extraResources` が `vendor/ffmpeg/bin/` をインストーラーへコピーし（`resources/ffmpeg/bin/`）、`vendor/` に該当する 2 つのバイナリも存在します。以下が訂正後の説明です。

| 項目 | 内容 |
|---|---|
| 同梱ファイル | `vendor/ffmpeg/bin/ffmpeg.exe`（61.5 MB）、`vendor/ffmpeg/bin/ffprobe.exe`（77.2 MB） |
| ビルド | `ffmpeg version N-92722-gf22fcd4483`（2018 年ビルド、gcc 8.2.1） |
| 主要な configure フラグ | `--enable-gpl --enable-version3 --enable-libx264 --enable-libmp3lame` → したがって **GPLv3**（LGPL ではない） |
| ライセンス全文 | 同梱：[`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt) |
| 本アプリとの関係 | 本アプリは**子プロセス**（`spawn` / `execFile`）で呼び出すだけで、**リンクも埋め込みもしません** → 「**独立したプログラムの集合的配布**」に該当します。GPLv3 は**本アプリ自身の MIT ライセンスを変更しません** ✓。ただし**インストーラー全体を配布する際は GPLv3 の遵守も必要**です（ライセンス全文の同梱 + ソース入手方法の提示）✓ |

### ffmpeg のソース入手（GPLv3 の要件）
同梱バイナリは **BtbN の Windows ビルド**（<https://github.com/BtbN/FFmpeg-Builds>）で、**FFmpeg 公式ソース**（<https://ffmpeg.org/download.html>）に上記の configure フラグを適用したものです。
本インストーラーを受け取った誰もが、これらのリンクから完全な対応ソースを入手できます。こちらからの提供が必要な場合は <https://github.com/sakihanaraku/irix-audio-player/issues> で Issue を作成してください。

> **インストーラーのサイズ削減 / この GPL 義務を外したい場合**：`vendor/ffmpeg/bin/`（約 139 MB）を削除し、`package.json` の `build.extraResources` を外してください。アプリは自動的にユーザー環境の ffmpeg へフォールバックします（設定で指定、または `AURORA_FFMPEG` / `PATH` 経由）。

## 3. 本プロジェクトの独自実装部分

- ネイティブオーディオエンジン（`native/`、N-API + WASAPI / DirectSound / WinMM / ALSA、さらに Wine フォールバックチェーン）；
- レンダラー側の UI コードすべてと自前描画 SVG アイコン（26 個の `<path>` のうち、上記の `music_note` のみ Material 由来）；
- 歌詞（LRC）、イコライザー（DSP）、音声変換、再生統計などのモジュール；
- **テスト素材はすべて自前生成**：`scripts/make-test-media.mjs` がコードで音声とカバーアートを合成しており、サードパーティ素材は含みません；
- サードパーティのフォント、アイコンフォント、フロントエンドライブラリは一切埋め込んでいません（jQuery / CryptoJS / lodash / Bootstrap / webpack 成果物なし）。
