# SEEEN V04 Preview · GitHub Pages

V04の作業元は既存リポジトリの `v04/audio-synchronized-visualization` です。公開先は専用の `041231horiko-cyber/SEEEN_AUDIO_PLAYER_V04_PREVIEW` リポジトリです。

## 初回設定

1. GitHubで `041231horiko-cyber` を所有者にして、`SEEEN_AUDIO_PLAYER_V04_PREVIEW` を空の公開リポジトリとして作成します。README・ライセンスの初期追加は不要です。
2. 作業元のリポジトリで `python3 tools/v04-pages/publish.py v04/audio-synchronized-visualization --publish` を実行します。専用リポジトリへPushできるGitHub認証が必要です。
3. 専用リポジトリの **Settings → Pages** で **Deploy from a branch → main → /(root)** を選んで保存し、**Enforce HTTPS** を有効にします。ビルド完了後は **Visit site** に表示されたURLを共有します。

サイトの公開範囲はGitHub Pagesの公開設定に従います。HTMLの `noindex, nofollow, noarchive` は検索掲載の抑制を依頼する設定です。

## 更新と復元

各STEPの承認後に、作業元の該当コミットを既存V04開発ブランチへ通常のPushで保存し、同じコミットを `publish.py <コミットID> --publish` で公開します。事前に `--output <新規ディレクトリ>` で配信内容を確認できます。配信に使うのは `SEEEN_AUDIO_PLAYER/` のService Workerが宣言した資産とフォントのライセンス、Service Worker、`.nojekyll` です。専用リポジトリの公開コミットには元のV04コミットIDが記録されます。

復元は、以前の公開コミットに記録された作業元のコミットIDを `publish.py <以前のコミットID> --publish` に渡します。公開履歴に復元のコミットが追加され、URLは維持されます。コンテンツが同じ場合は同じキャッシュ名を再利用します。

## PWA

V04のManifestは `id`・`start_url`・`scope` が相対パスの `./` で、専用のリポジトリパスを基準に解決されます。V03とはスコープとキャッシュ名が別です。V04は配信内容のハッシュとスコープを含むキャッシュ名を使い、必須資産を取得するときは公開版とSHA-256が一致するか確認します。検証に失敗した更新は有効化されず、旧キャッシュは保持されます。

iPhoneのSafariで公開済みのV04を開き、**共有 → ホーム画面に追加 → 追加**を選びます。アイコン名は **SEEEN V04** です。初回はオンラインで `READY` を確認します。更新時はSafariタブとホーム画面から開いたV04をすべて閉じ、再度開きます。新しい版で `READY` を確認した後、必要に応じて機内モードで再生を確認します。
