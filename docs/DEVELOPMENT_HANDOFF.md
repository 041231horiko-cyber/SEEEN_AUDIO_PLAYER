# SEEEN AUDIO PLAYER — Development Handoff

更新基準: V03 STEP 13.3 / `8b4edd2`

## 1. プロジェクトの目的

SEEEN AUDIO PLAYERは、展示空間で4種類の音源を排他的に再生する、iPhone向けの横画面・オフライン対応Webアプリです。最優先端末はiPhone 7 / iOS 15です。

音源のBRIGHT / DARKを視覚テーマに、WIDE / NARROWをParticle Fieldの運動に対応させます。音声再生の安定性を保ちながら、固定粒子の明度変化によって波の拡散・反射・収束を表現します。

## 2. 現在の基準状態

| 項目 | 基準 |
| --- | --- |
| 正式実装 | V03 STEP 13.3 |
| 基準コミット | `8b4edd2819d825acc9c2837f240d22070452c14c` |
| 基準ブランチ | `main` |
| v20復元基準 | `6404ccb13eee9c9d93c72689caaeb8588eab3103` |
| 正式開発対象 | `SEEEN_AUDIO_PLAYER/` |
| Service Worker | `seeen-audio-v39` |
| 正式Pages URL | <https://041231horiko-cyber.github.io/SEEEN_AUDIO_PLAYER/SEEEN_AUDIO_PLAYER/> |

端末別の最終的な正式検証結果は未確定です。ユーザーによる最新確認では4音源のモーションは滑らかに動作していますが、端末名・iOS・コミットを対応付けた記録がない限り「実機検証済み」と断定しません。

## 3. 正式なディレクトリ構成

```text
repository root/
├── AGENTS.md
├── README.md
├── docs/
├── index.html, style.css, player.js, ...       # 旧実装・変更対象外
└── SEEEN_AUDIO_PLAYER/                         # 正式開発対象
    ├── index.html
    ├── style.css
    ├── player.js
    ├── particle-field.js
    ├── field.js                                # 旧SVG fallbackを含む
    ├── service-worker.js
    ├── manifest.json
    ├── audio/
    ├── icons/
    └── SEEEN_AUDIO_PLAYER/                     # さらに古い旧実装・変更対象外
```

GitHub Pagesはリポジトリ直下を再帰的に配信しています。ベースURLは旧実装です。正式V03は1階層下のURLを使用します。

## 4. V03の設計思想

- Soft Tech: 無機質な秩序と感覚的な柔らかさ。
- Balanced: 明度差と余白で情報を整理し、罫線・影・グロー・ガラス表現を使わない。
- 667×375 CSS pxを基準とする横画面専用UI。
- 左60%をParticle Field、右40%を操作パネルとする。
- 音声処理を視覚表現より優先し、ビジュアルの時間管理を音声再生位置から分離する。
- 文章による再解釈ではなく、採用済みコードの数式と見え方を優先する。

詳細は `DESIGN_SPEC.md` を参照してください。

## 5. STEP 01〜13.3の実装経緯

| STEP | コミット | 内容 |
| --- | --- | --- |
| 01 | `72156cf` | 667×375基準の横画面基盤、Safe Area、縦画面案内 |
| 02 | `af44c12` | 60:40 Split Layout |
| 03 | `295a399` | Soft Tech操作パネル、2×2ボタン、円形再生、縦ステータス |
| 04 | `6ee7030` | Balancedカラーシステム |
| 05 | `a596d0a` | Helvetica Neue系、ロゴ・ヘッダー調整 |
| 06 | `78bfb68` | 最終整列とPLAY/PAUSEの光学補正 |
| 07 | `24d15e5` | Canvas 2D Particle Field基盤 |
| 08 | `98cf707` | WIDE Diffusion |
| 09 | `b7629c4` | NARROW Integrated Reflection |
| 10 | `b83d946` | Point待機・停止収束・再生発生 |
| 10.1 | `4d39c7d` | Point Emission補正 |
| 11 | `a228994` | Reset: Collapse → Transition → Emission |
| 12 | `95575e7` | Soft Press |
| 13 | `cb96231` | 描画・切替最適化 |
| 13.1 | `a46e09a` | 状態遷移と位相の連続性改善 |
| 13.2 | `ae85d36` | NARROW Emissionの不可視オーバードロー削減 |
| 13.3 | `8b4edd2` | BUFFERING中のEmission停止を解消 |

## 6. 過去の不具合と解決方法

### iPhone 7でロゴ周囲に長方形が出る

PNGのテーマ切替・合成を廃止し、v20 `6404ccb`で正式ロゴを単一インラインSVGへ変更しました。SVGパスと縦横比を維持してください。

### AUDIO PLAYERの下部クリッピング

STEP 05でline-height、文字領域、overflow、ヘッダー構造を調整しました。

### PLAY / PAUSEアイコンが上にずれる

STEP 06で24×24のSVG描画範囲とボタン中央配置を整理しました。PLAYは三角形の視覚重心、PAUSEは2本の棒の中心を基準にしています。

### 音源切替時のカクつき

STEP 13で固定値を事前計算し、一時配列や不要なDOM更新を削減しました。STEP 13.1でrAF timestampを一貫させ、Emission終了から通常モーションへの位相を連続化しました。

### NARROW Emission初期の負荷

STEP 13.2で中心点に完全に隠れる粒子だけを描画省略しました。9500粒子、座標、明度式、粒子サイズは変更していません。

### BUFFERING時に小さなNARROW波が停止する

STEP 13.3で、Reset完了後の短いBUFFERING中もビジュアル時間を継続するよう修正しました。音声状態表示は実状態を維持します。再生が始まらない場合は1200msを上限として既存の420ms収束へ移行します。

## 7. 音源と再生仕様

- 単一 `HTMLAudioElement` を使う。
- 4音源は `audio/bright_wide_loop.wav`、`bright_narrow_loop.wav`、`dark_wide_loop.wav`、`dark_narrow_loop.wav`。
- 現在の4音源は各12秒、44.1kHz、16bit、ステレオの開発用テスト音源。
- 長尺展示用音源はリポジトリへ未反映。
- 異なる音源間の切替時だけ `audio/ui-switch.wav` を1回再生する。WAV内に2回のクリック音が入っている。
- `ui-switch.wav` は0.75秒、44.1kHz、16bit、モノラル。2拍の間隔は375ms、基準160 BPM。
- 本音源は先頭からループする。
- `operationId`で高速連続操作時の古い非同期処理を無効化する。
- 音声の停止を待ってビジュアルを遅延させず、音声処理とビジュアル時間を分離する。

## 8. 保全済みバージョン

- v20コミット: `6404ccb`
- v20外部バックアップ: `SEEEN_AUDIO_PLAYER_v20_6404ccb_Phase00_20261124-223219.zip`
- STEP 13.2以前の外部バックアップ: `SEEEN_AUDIO_PLAYER_STEP13.2_ae85d36_before_STEP13.3_20261126-122143.zip`
- STEP 13.3はGitHub `main`の`8b4edd2`から復元可能。

外部バックアップはローカルの `SEEEN_BACKUPS` に保管されています。Cloud cloneには含まれません。

## 9. 現在残っている課題

- STEP 14: iOS 15、PWA、横画面、各実機サイズの最終確認。
- STEP 15: 4音源、クリック音、ループ、オフライン、長時間稼働の最終確認。
- STEP 13.3を端末・iOS・URL・コミットに対応付けた正式な実機記録。
- GitHub PagesのベースURLが旧実装を表示する構造の整理。
- 長尺展示用音源の所在、公開可否、容量、ループ品質の確定。
- ローカルにのみ存在する `SEEEN_UI_V03` 原本の保管・アクセス方針。
- ルートREADME下部の歴史的な旧運用説明の将来的な再整理。

## 10. STEP 14・15以降のロードマップ

### STEP 14 — 横画面・PWA

- iPhone 7 / iOS 15を含むSafariとStandalone PWAの表示領域。
- Manifest `orientation: landscape`と、物理的に横向きにする運用。
- Safe Area、ホーム画面起動、Service Worker更新、オフライン再生。
- 旧キャッシュ・異なるURLスコープの影響。

### STEP 15 — 最終検証

- 全4音源・全12方向の切替。
- クリック音、本音源開始、ループ境界。
- 高速連続操作、停止・再開、画面回転。
- 機内モード、PWA再起動、iPhone再起動後のオフライン再生。
- 長時間稼働、メモリ増加、発熱、音切れ。

## 11. ローカルとCloudの併用

1. 作業開始時に `git status`、ブランチ、HEAD、GitHub `main`を照合する。
2. 最新の `origin/main`から環境ごとの作業ブランチを作る。
3. ローカルとCloudで同じブランチを同時編集しない。
4. 実装対象を必ず `SEEEN_AUDIO_PLAYER/`に限定する。
5. コミット前に基準コミットとの差分を確認する。
6. ユーザー確認後にだけ`main`へ反映する。
7. 実機検証記録にURL・SHA・端末・iOS・キャッシュ番号を残す。

詳細な起動・検証手順は `CLOUD_SETUP.md` を参照してください。

## 12. ユーザー承認が必要な変更

- UI、レイアウト、カラー、書体、正式ロゴ。
- 粒子数、座標、サイズ、明度式、モーション式、Canvas解像度。
- Point、Reset、Soft Press、BUFFERING上限などの時間設定。
- 音源・クリック音・音声切替・ループ・連続操作対策。
- Service Worker、Manifest、Range処理、キャッシュ方式。
- 長尺音源の追加・公開。
- GitHub Pages設定、正式URL、フォルダ構造。
- 旧実装の削除・統合・移動。
