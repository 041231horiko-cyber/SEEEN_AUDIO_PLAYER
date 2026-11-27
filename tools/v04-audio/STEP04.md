# SEEEN AUDIO PLAYER · V04 STEP 04

採用案「02 — Interference」のAMPLITUDEを、V04開発版の主旋律描画に組み込みました。この確認用ZIPには完成音源と元の解析データが含まれます。

## Macで開く

ZIPを展開したディレクトリのターミナルで次のコマンドを実行します。

```sh
cd app
python3 -m http.server 8000 --bind 127.0.0.1
```

<http://127.0.0.1:8000/> を開きます。オフライン状態も確認する場合は `READY` を待ってからブラウザのネットワークをオフラインに切り替えます。STEP 02.1を同じアドレスで開いていた場合、旧版のタブをすべて閉じてから開き直すと、待機している新しいService Workerが有効になります。iPhoneでは、公式V03とは別のオリジンまたは兄弟スコープの、許可済みHTTPS環境で `app/` だけを使います。

## 動作

- 元解析からノックと反響の区間を補間した持続音RMSを使用します。WIDEとNARROWで共通のBRIGHT／DARK各2,494点を、元の0.1 dB刻みの整数で記録しています。4音源との対応にはファイル名とSHA-256を使い、組み立て時に照合します。
- STEP 03.3と同じ400msの循環移動平均、50msサンプル間の線形補間、2テーマ共通の正規化範囲（−41.1〜−16.9 dBFS）を使います。実効明度20〜40%、波長80%、速度150%、干渉50:50です。
- 位相には本音源の `currentTime` と周回数を使います。主旋律とノック波は同じ粒子とCanvasを共有し、粒子ごとに両方の明度の最大値を取ります。停止時は最後の描画を固定してCollapseし、切替時は前の主旋律を解除してから既存のResetを行います。
- キャッシュ名の接頭辞は `seeen-v04-step04-v1:` です。24必須URLを確認します。既存のRange処理と、インストール失敗時に旧キャッシュを保持する動作を継承します。

## 復元と再検証

`development/commit.txt` が同梱版のコミット、`development/step01/` が元の解析JSONと音源マニフェストです。Git bundleから復元するには `git clone SEEEN_V04_STEP04_MELODY_SYNC.bundle seeen-step04` を実行します。

リポジトリで `python3 tools/v04-audio/prepare-step04.py <STEP03.3のZIP> --check` を実行すると、音源とRMSを照合できます。展開したSTEP 03.3を引数に `node tools/v04-audio/verify-step04.js <STEP03.3の展開先>` を実行すると、数値比較とCanvas描画を省いた性能計測ができます。`node tools/v04-audio/verify-step02.js <STEP01.3の展開先>` はノック波、切替、キャッシュの回帰検証です。
