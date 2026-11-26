# SEEEN AUDIO PLAYER — Local / Codex Cloud Setup

## 1. Canonical target

正式な起動ディレクトリは、リポジトリ直下ではなく次です。

```text
SEEEN_AUDIO_PLAYER/
```

リポジトリ直下と`SEEEN_AUDIO_PLAYER/SEEEN_AUDIO_PLAYER/`は旧実装です。起動・変更・正式検証の対象にしません。

正式GitHub Pages URL:

<https://041231horiko-cyber.github.io/SEEEN_AUDIO_PLAYER/SEEEN_AUDIO_PLAYER/>

旧URL:

| URL | 状態 |
| --- | --- |
| `https://041231horiko-cyber.github.io/SEEEN_AUDIO_PLAYER/` | 旧実装。正式検証に使用しない |
| `https://041231horiko-cyber.github.io/SEEEN_AUDIO_PLAYER/SEEEN_AUDIO_PLAYER/SEEEN_AUDIO_PLAYER/` | さらに古い旧実装 |

## 2. Preflight

```sh
git status --short --branch
git branch --show-current
git rev-parse HEAD
git fetch origin main
git rev-parse origin/main
```

- 基準コミットは`8b4edd2`。
- リモートに予期しない変更がある場合は作業を停止する。
- 未コミット変更がある場合は所有者と目的を確認し、破棄しない。
- 正式対象が`SEEEN_AUDIO_PLAYER/`であることを確認する。

## 3. Python HTTP server

ビルドや依存ライブラリのインストールは不要です。

### Codex Cloud

Cloud環境のリポジトリルートから:

```sh
cd SEEEN_AUDIO_PLAYER
python3 -m http.server 3000 --bind 0.0.0.0
```

- 3000番がCloud環境のHTTP Previewとして設定されている場合の例です。
- `environment_status`でHTTP PreviewのポートとURLを確認してください。
- 3000番が未設定または使用中の場合は、環境に設定された別の空きHTTPポートを使用します。
- Cloud Preview URLを推測で作らず、環境が返した正式URLを使用します。

### Local Mac

```sh
cd SEEEN_AUDIO_PLAYER
python3 -m http.server 3000 --bind 127.0.0.1
```

ChromiumまたはSafariで`http://127.0.0.1:3000/`を開きます。localhost系はService Workerの開発用secure contextとして扱われます。

## 4. Basic response checks

別ターミナルから:

```sh
curl -I http://127.0.0.1:3000/
curl -I http://127.0.0.1:3000/particle-field.js
curl -I http://127.0.0.1:3000/audio/ui-switch.wav
curl -I http://127.0.0.1:3000/audio/bright_wide_loop.wav
```

すべて200で取得できることを確認します。`particle-field.js`が404の場合は、旧階層を起動しています。

## 5. Chromium verification

1. 667×375の横画面で開く。
2. 縦画面では`LANDSCAPE REQUIRED`が出ることを確認する。
3. BRIGHT/WIDE、BRIGHT/NARROW、DARK/WIDE、DARK/NARROWを選択する。
4. 各音源でPLAY、PAUSE、再開を確認する。
5. WIDE / NARROW、BRIGHT / DARK、同一テーマ間を切り替える。
6. COUNT IN → BUFFERING/LOADING → PLAYINGの状態表示を確認する。
7. Reset、Point、Soft Press、Particle Fieldの連続性を確認する。
8. ConsoleにJavaScriptエラーがないことを確認する。
9. Canvasのdatasetで`data-wide-count="6500"`、`data-narrow-count="9500"`を確認する。

デスクトップやCPUスロットリングの結果をiPhone 7実機性能と同一視しません。

## 6. Service Worker verification

1. HTTPS Previewまたはlocalhostでアプリを開く。
2. DevTools → Application → Service Workersを開く。
3. `service-worker.js`が現在の正式ディレクトリをscopeとしていることを確認する。
4. Cache Storageに`seeen-audio-v39`があることを確認する。
5. UIが`READY`になるまで待つ。
6. キャッシュ内にアプリ本体、`particle-field.js`、フォント、アイコン、`ui-switch.wav`、4音源があることを確認する。
7. DevToolsでOfflineを有効にして再読み込みする。
8. 4音源、切替、PLAY/PAUSEが動作することを確認する。

旧キャッシュは設計上自動削除されません。検証時は現在のscopeとキャッシュ名を記録し、旧URLのService Workerと混同しないでください。

## 7. WAV Range request verification

Python HTTPサーバーへの直接`curl`は、Service WorkerのRange処理を通らないため、Service Worker検証にはなりません。

Service Workerがページを制御した状態で、Chromium DevTools Consoleから実行します。

```js
const response = await fetch("./audio/bright_wide_loop.wav", {
  headers: { Range: "bytes=0-99" }
});

console.table({
  status: response.status,
  acceptRanges: response.headers.get("Accept-Ranges"),
  contentRange: response.headers.get("Content-Range"),
  contentLength: response.headers.get("Content-Length")
});
```

期待値:

- status: `206`
- Accept-Ranges: `bytes`
- Content-Range: `bytes 0-99/2116878`
- Content-Length: `100`

不正Rangeでは416、音源取得不能時は503を期待します。

## 8. iPhone real-device verification

Cloud / Chromiumだけでは次を確定できません。

- iPhone 7 / iOS 15 Safariでの描画性能。
- Standalone PWAとSafariの表示領域差。
- Manifestの横画面指定と物理回転。
- Safe Area、アドレスバー、ホーム画面起動。
- iOSのユーザー操作必須音声再生。
- クリック音と本音源の聴感同期。
- ループ境界のクリック・無音。
- 機内モード、PWA終了・再起動、iPhone再起動後のオフライン再生。
- 長時間稼働、発熱、メモリ、音切れ。

記録項目:

```text
URL:
commit:
device:
iOS:
Safari or Standalone:
Service Worker cache:
result:
unverified items:
```

## 9. Branch workflow

ローカルとCloudから同時に`main`を直接編集しません。

```sh
git fetch origin main
git switch -c cloud/<step>-<topic> origin/main
# または local/<step>-<topic>
```

1. 1つのブランチを1環境・1工程に限定する。
2. 作業開始時とPush前に`origin/main`との差分を確認する。
3. 変更ファイルを明示的にstageし、`.DS_Store`や検証用ファイルを含めない。
4. 自動テストと回帰確認を行う。
5. ユーザー確認後にだけ`main`へ反映する。
6. force pushを使用しない。

## 10. Reference material availability

Cloud cloneで利用可能:

- `AGENTS.md`
- `docs/DEVELOPMENT_HANDOFF.md`
- `docs/DESIGN_SPEC.md`
- 本ファイル
- 正式実装に統合済みのモーション数式
- 原本ファイル名とSHA-256一覧

Cloud cloneに含まれない:

- ローカル`SEEEN_UI_V03`の原本。
- PREVIEW.html。
- 4枚のREFERENCE画像。
- SEEEN_MOTION_CODE.zip / txt。
- ローカルの外部バックアップ。

これらは公開可否が未確認のため、公開GitHubリポジトリへ追加していません。原本が必要な工程ではユーザーに安全な共有方法を確認します。
