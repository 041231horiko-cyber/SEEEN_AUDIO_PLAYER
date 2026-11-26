# SEEEN AUDIO PLAYER — V03 Design Specification

実装基準: `SEEEN_AUDIO_PLAYER/` at `8b4edd2`

## 1. 仕様の優先順位

1. 現行の正式実装 `SEEEN_AUDIO_PLAYER/`
2. ローカル原本 `SEEEN_UI_V03/motion/*.js` の採用済み数式
3. `SEEEN_UI_V03/DESIGN_SYSTEM.md`
4. `PREVIEW.html`の参照動作

`PREVIEW.html`は独立したデザイン試作で、音声・PWA・実状態管理を含む製品コードではありません。旧デザインやPREVIEWと現行実装が異なる場合は、`8b4edd2`の正式実装を現在値とします。

## 2. Design language

- Soft Tech: 無機質な秩序と感覚的な柔らかさ。
- Balanced: 余白と明度差で階層を作る。
- 罫線、影、グロー、ガラス表現、起動演出は使わない。
- BRIGHT / DARKは色、WIDE / NARROWは運動を表す。
- ステータスは色だけでなく文字でも状態を判別できるようにする。

## 3. 画面とレイアウト

| 要素 | 基準値 |
| --- | --- |
| デザイン座標 | 667×375 CSS px |
| 方向 | 横画面 |
| Split Layout | 左60% / 右40% |
| 外周余白 | 22px |
| ビジュアライザー中心 | X200 / Y210 |
| 操作パネル | X400 / Y75 / W245 / H270 / R27 |
| パネル内余白 | 16px |
| 音源ボタン | 2×2、W103.5 / H45 / R22.5 / gap 6 |
| 再生ボタン | 直径60、パネル内X37.75 / Y189 |
| ステータス | パネル内X145 / Y194、行高17 |
| インジケーター | 直径5.2、文字との間隔8 |

`visualViewport`、Safe Area、ウィンドウ回転を考慮し、667×375を固定表示せず等比スケールします。縦画面では`LANDSCAPE REQUIRED`を表示し、CSSによる強制回転は行いません。

## 4. Typography and logo

```css
font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
```

| 要素 | サイズ | ウェイト | 字間 |
| --- | ---: | ---: | ---: |
| 現在音源 | 21px | 700 | -0.6px |
| CURRENT SOURCE | 10px | 500 | 1.1px |
| 音源ボタン | 9.5px | 600 | 0 |
| ステータス | 10px | 500 | 0.65px |
| AUDIO PLAYER | 10px | 500 | ロゴ左右端に合わせる |
| EXHIBITION UNIT | 10px | 500 | 1.35px |

現行正式ロゴは、v20で採用した単一インラインSVGです。SVGパス、viewBox、縦横比を変更しません。

原本の`DESIGN_SYSTEM.md`には提供PNGを正式参照とする記述がありますが、製品実装ではiPhone 7のテーマ切替時に出た長方形合成問題を解決するため、`6404ccb`以降はインラインSVGが正式です。

## 5. Balanced color system

| Role | DARK | BRIGHT |
| --- | --- | --- |
| Background | `#080808` | `#F2F2F0` |
| Panel | `#1B1B1B` | `#E3E3E1` |
| Inactive | `#303030` | `#D1D1CF` |
| Primary | `#EEEEEC` | `#101010` |
| Muted | `#AAAAAA` | `#666666` |
| YES | `#65C98A` | `#238548` |
| NO | `#E66B6B` | `#C43C3C` |

選択ボタンと再生ボタンはPrimaryを背景、Backgroundを文字・アイコンに使用します。ステータス文字はMuted、点だけをYES / NOで表示します。

## 6. Canvas 2D structure

- Canvas表示座標: 667×375。
- 内部解像度: `min(devicePixelRatio, 2)`倍。独断で低下させない。
- 描画クリップ: X12 / Y75 / W376 / H287。
- 中心点: X200 / Y210 / 半径3.4。
- 粒子座標と固定係数は初期化時に生成し、毎フレーム再生成しない。
- rAFループは一つに管理し、待機時は停止する。
- 粒子自体を移動させず、固定座標に時間依存の明度と描画スケールを適用する。

## 7. Common formulas

```js
clamp(x) = max(0, min(1, x))
smooth(x) = clamp(x)^2 * (3 - 2 * clamp(x))
g(x, s) = exp(-x^2 / s^2)
hash(i) = fract(sin(i * 127.1 + 17.73) * 43758.5453)
```

`smooth`はPoint、Reset、反射統合に共通するSmoothstepです。

## 8. WIDE / Diffusion

| 項目 | 値 |
| --- | ---: |
| 粒子数 | 6500 |
| 黄金角 | 2.39996323 |
| 描画半径 | 145 CSS px |

粒子`i`の固定座標:

```js
angle = i * 2.39996323
r = sqrt((i + 0.5) / 6500)
x = cos(angle) * r
y = sin(angle) * r
j = hash(i)
```

明度:

```js
(0.015 + 0.83 * pow(0.5 + 0.5 * cos(r * 13 - t * 3.5), 7))
  * (1 - 0.77 * r * r)
  * (0.55 + 0.45 * j)
```

粒子半径:

```js
0.29 * max(0.7, R / 90) * (0.75 + 0.5 * j)
```

中心から外側への同心円状の波だけを表示します。反射、逆流、ブラー、グローを加えません。

## 9. NARROW / Integrated Reflection

| 項目 | 値 |
| --- | ---: |
| 粒子数 | 9500 |
| 正方形半幅 | 98 CSS px |

固定座標:

```js
x = 2 * ((i * 0.754877666) % 1) - 1
y = 2 * ((i * 0.569840291) % 1) - 1
r = hypot(x, y)
j = hash(i)
```

4方向の鏡像距離:

```js
d = [
  hypot(x - 2, y),
  hypot(x + 2, y),
  hypot(x, y - 2),
  hypot(x, y + 2)
]
```

時間依存値と波形:

```js
travel = (t * 0.66) % 3.1
direct = g(r - travel, 0.06) * 0.9

reflection0 = g(d[0] - travel, 0.07) * smooth( x / 0.2) * 0.85
reflection1 = g(d[1] - travel, 0.07) * smooth(-x / 0.2) * 0.85
reflection2 = g(d[2] - travel, 0.07) * smooth( y / 0.2) * 0.85
reflection3 = g(d[3] - travel, 0.07) * smooth(-y / 0.2) * 0.85

merged = max(0, reflection0, reflection1, reflection2, reflection3)
blend = smooth((travel - 1.32) / 0.55)
focus = max(0, 2 - travel)
converge = g(r - focus, 0.075) * 0.78
combined = max(direct, merged)
fade = 1 - smooth((travel - 1.97) / 0.22)
value = (combined * (1 - blend) + converge * blend) * fade
amplitude = (0.014 + 0.92 * min(1, value)) * (0.65 + 0.35 * j)
```

粒子半径:

```js
0.29 + 0.13 * j
```

反射の重複は加算せず`Math.max`で統合します。正方形へ単純モーフィングせず、反射波を反対側まで通過させません。壁面は通常表示しません。

STEP 13.2では中心点に完全に隠れる粒子だけを描画省略します。これは視覚結果を変えないオーバードロー削減で、粒子配列と数式は維持されています。

## 10. Point, Reset, Soft Press

### Point

- 待機: 中心点のみ。連続描画なし。
- Emission: 288ms。
- Collapse: 420ms。
- 補間: Smoothstep。
- 停止時は音声を先に停止し、視覚収束を独立して完了する。

### Reset

- 全体: 900ms。
- Collapse: 32% / 288ms。
- Transition: 36% / 324ms。
- Emission: 32% / 288ms。

```js
scale = q < 0.32
  ? 1 - smooth(q / 0.32)
  : q < 0.68
    ? 0
    : smooth((q - 0.68) / 0.32)

blend = smooth((q - 0.32) / 0.36)
newState = q >= 0.5
emit = q >= 0.68
```

同一テーマ内の切替でもCollapse / Emissionを実行しますが、不要な色反転は行いません。

### BUFFERING continuity

- Reset完了時に音声が短時間`COUNT IN`または`BUFFERING`でも、phaseを停止・再初期化しない。
- 短時間BUFFERING継続上限: 1200ms。
- 上限を超えて再生できない場合は420msのPoint Collapseへ移行する。
- 音声状態表示を偽装せず、`BUFFERING`を実状態のまま表示する。

### Soft Press

- 通常: `scale(1)`, `brightness(1)`。
- 押下: `scale(.95)`, `brightness(1.18)`。
- 時間: 140ms。
- easing: `ease`。
- レイアウトや操作領域は変化させない。

## 11. Audio switching

- 単一 `HTMLAudioElement`。
- BRIGHT/WIDE、BRIGHT/NARROW、DARK/WIDE、DARK/NARROWの4音源。
- 初回選択、同じ音源の再選択、PAUSEからの再開は本音源を直接再生。
- 異なる音源間では`ui-switch.wav`を再生し、終了後に選択音源を先頭から再生。
- `ui-switch.wav`内に2回のクリック音。0.75秒、375ms間隔、基準160 BPM。
- 本音源再生中は`audio.loop = true`。
- `operationId`で古い非同期処理が最新操作を上書きしないようにする。
- `COUNT IN`、`BUFFERING`、`PLAYING`、`PAUSED`、`ERROR`を実際の音声状態に接続する。

## 12. PWA and offline

- Manifest: `display: standalone`, `orientation: landscape`,相対`start_url` / `scope`。
- Service Worker: `seeen-audio-v39`。
- アプリ本体、フォント、アイコン、Particle Field、クリック音、4音源をキャッシュする。
- 全必須ファイルが現在キャッシュに存在するときだけ`READY`。
- WAVのRangeリクエストを解析し、`206 Partial Content`、`Accept-Ranges`、`Content-Range`を返す。
- 不正なRangeは`416`。
- 音源取得失敗は`503`。
- 旧キャッシュは、再生中音源を不意に削除しないため自動削除しない。
- Service WorkerにはHTTPSまたはlocalhostが必要。

## 13. Original reference manifest

原本はローカルの`SEEEN_UI_V03`にあり、内容は変更していません。公開可否が未確認のため、原本・画像・PREVIEW・ZIPはリポジトリへ追加していません。

| File | SHA-256 | Repository status |
| --- | --- | --- |
| `DESIGN_SYSTEM.md` | `cd44ea835e7edfc095c758250540a6765d9c59e2fa3d253879d271e00b060796` | 仕様を本書へ要約、原本未移行 |
| `DEVELOPMENT_ROADMAP.md` | `f88a4fe0fb8175890934e1ce19f1fd0a2cfadf927175f4b39e5a2dc0c5467294` | ロードマップを引き継ぎ資料へ要約、原本未移行 |
| `PREVIEW.html` | `dceb037e9061a997b077d50a44ad27f085a92a4e0f2afd629941f6aa533d1e7b` | 独立試作、公開可否未確認のため未移行 |
| `motion/COMMON.js` | `b80ff4cb4d6d956e87a6c20dc923c371ed39ab2d433299d5b0a314bc9ff6fb5` | 採用式は現行実装に統合済み、原本未移行 |
| `motion/WIDE.js` | `038461c9d822f98f568c05dc17904077202e92787fdc84a23f0ccb06b4562005` | 採用式は現行実装に統合済み、原本未移行 |
| `motion/NARROW.js` | `d6fa0410a64b0117f798c3c10c1099f0b6f943f4369c701973bdde2518c78b47` | 採用式は現行実装に統合済み、原本未移行 |
| `motion/TRANSITION.js` | `eafc63fddd305d73422ef453167337d30ccfa2687db7879b5d0e768eab4c8124` | 採用式は現行実装に統合済み、原本未移行 |
| `REFERENCE_BRIGHT_WIDE.png` | `cf2885ac60277a74bf4c0918532485e4524dc979dc46f1693756e1b251affdbe` | 第三者権利・公開可否未確認のため未移行 |
| `REFERENCE_BRIGHT_NARROW.png` | `5fdc58b08657bb5005b8c9a038cc3a6773a01aa9858e2784fafa71db3d8a3006` | 第三者権利・公開可否未確認のため未移行 |
| `REFERENCE_DARK_WIDE.png` | `c78bb87242100db681cee36ba7376fd1729af634698f6e8e0fe307058af6e8d7` | 第三者権利・公開可否未確認のため未移行 |
| `REFERENCE_DARK_NARROW.png` | `5364b1d6f3b82db0b38f2a88c2e150194f52687ad48f9b6a9f1892e7af5581d8` | 第三者権利・公開可否未確認のため未移行 |
| `SEEEN_MOTION_CODE.txt` | `6d309fceed68c3e2a7f040857d4c3a06bddc2e5548df8b5d84db825ab4b3e4bd` | 原本重複資料、公開可否未確認のため未移行 |
| `SEEEN_MOTION_CODE.zip` | `f20b5ecc6a7db9b6a024ed8e69854f3068f7869e4beac5ccff8341d912439ebe` | アーカイブ、公開可否未確認のため未移行 |

Cloudでは本書と現行`particle-field.js`を参照できます。原本との再照合が必要な変更では、公開可否を確認したうえで安全な共有方法をユーザーに確認してください。
