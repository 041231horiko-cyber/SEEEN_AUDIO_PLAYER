# SEEEN AUDIO PLAYER — Agent Instructions

このファイルは、ローカル環境とCodex Cloudの両方から本リポジトリを扱う際の共通ルールです。

## Canonical scope

- 正式な開発対象は、第2階層の `SEEEN_AUDIO_PLAYER/` のみです。
- リポジトリ直下のHTML/CSS/JavaScript/PWA一式は旧実装です。変更対象に含めず、最新版として扱わないでください。
- `SEEEN_AUDIO_PLAYER/SEEEN_AUDIO_PLAYER/` はさらに古い旧実装です。変更・削除・統合・移動を行わないでください。
- 正式なGitHub Pages URLは <https://041231horiko-cyber.github.io/SEEEN_AUDIO_PLAYER/SEEEN_AUDIO_PLAYER/> です。
- ベースURL <https://041231horiko-cyber.github.io/SEEEN_AUDIO_PLAYER/> は旧実装を表示するため、正式版の検証には使用しません。

## Baselines

- V03基準: `8b4edd2` — `V03 STEP 13.3 — Emission continuity correction`
- v20復元基準: `6404ccb`
- 基準ブランチ: `main`
- 正式Service Workerキャッシュ: `seeen-audio-v39`

作業開始前に、必ず次を確認してください。

```sh
git status --short --branch
git branch --show-current
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

対象ファイルが `SEEEN_AUDIO_PLAYER/` 配下であることを確認し、旧2階層を誤って編集しないでください。

## Branch policy

- ローカルとCloudから同時に `main` を直接変更しないでください。
- 今後の実装変更は、最新の `origin/main` から作業ブランチを作成します。
- 変更を検証し、ユーザーの承認を得た後にだけ `main` へ反映します。
- force push、強制reset、履歴改変は禁止です。
- リモート `main` に予期しない変更がある場合は停止し、差分を報告してください。

## Protected implementation

以下は採用済み仕様です。ユーザーの明示的な承認なしに変更しないでください。

- iPhone 7 / iOS 15互換性を最優先する。
- 外部ライブラリ、ビルド依存、フレームワークを不用意に追加しない。
- 667×375 CSS px、横画面、60:40 Split Layout、Soft Tech / Balancedを維持する。
- 正式な単一インラインSVGロゴのパス・縦横比を変更しない。
- WIDE 6500粒子、NARROW 9500粒子を維持する。
- 粒子座標、採用数式、粒子サイズ、明度、Canvas描画解像度を独断で変更しない。
- WIDE / NARROWの通常モーション、Point、Reset、Soft Pressの時間と見え方を維持する。
- 音声処理とビジュアル時間の分離を維持する。
- 単一 `HTMLAudioElement`、4音源、2回のクリック音、ループ、連続操作対策を維持する。
- Service Workerの全必須ファイル検証、オフライン再生、WAV Rangeレスポンスを維持する。
- Service Workerまたは同一URLの資産を変更する場合は、キャッシュ更新の要否を必ず検討する。
- 現在の12秒WAVは開発用テスト音源であり、長尺展示用音源ではない。

## Verification and reporting

- デスクトップブラウザ、CPUスロットリング、シミュレーターの結果をiPhone実機結果として報告しないでください。
- 実機未検証の項目は必ず「未検証」と明記してください。
- iPhoneテストでは、URL、コミットID、端末、iOS、Service Workerキャッシュ番号を記録してください。
- アプリ変更後は、BRIGHT/DARK、WIDE/NARROW、4方向の切替、PLAY/PAUSE、クリック音、ループ、オフライン、JavaScriptエラーを回帰確認します。
- 変更前後で `git diff` を確認し、指定工程外の変更を含めないでください。

## Documentation and references

- 現状と開発経緯: `docs/DEVELOPMENT_HANDOFF.md`
- 確定デザイン・モーション仕様: `docs/DESIGN_SPEC.md`
- ローカル/Cloud起動・検証手順: `docs/CLOUD_SETUP.md`
- ローカルの `SEEEN_UI_V03` は正式参照原本ですが、リポジトリには原本をコピーしていません。公開可否が未確認の画像・PREVIEW・アーカイブを無断で追加しないでください。

## User approval required

次の変更は、実施前にユーザーの明示的な承認が必要です。

- UI、ロゴ、カラー、タイポグラフィ、配置、モーション品質の変更
- 粒子数、数式、描画解像度、アニメーション時間の変更
- 音源、クリック音、再生・ループ・切替処理の変更
- PWA、Manifest、Service Worker、キャッシュ方式、Range処理の変更
- GitHub Pages設定や正式URLの変更
- 旧実装の削除、統合、移動
- 長尺展示用音源の追加または公開
