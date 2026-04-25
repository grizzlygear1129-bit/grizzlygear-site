画像一括リサイズスクリプト
=========================

概要
----
このリポジトリに追加した `scripts/resize-images.js` は、指定したフォルダ配下の画像を再帰的に走査してリサイズ／再エンコードします。

特徴
- ファイル名・拡張子・ディレクトリ構成は変更しません（上書きする場合も元のパス・拡張子を維持します）。
- 対応拡張子: `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`, `.tif`, `.tiff`
- デフォルトで最大幅は `1600px`、品質は `75` に設定しています。

使い方
----

1. 依存パッケージをインストール（プロジェクトルートで実行）:

```bash
# npm install
# または必要なら dev に sharp を追加
npm install -D sharp
```

2. dry-run（実際には書き換えないで候補確認）:

```bash
node scripts/resize-images.js --dry-run
```

3. 実行例（上書き実行）:

```bash
node scripts/resize-images.js --max-width=1600 --quality=75 --concurrency=4
```

4. オプション:
- `--dry-run`: 実ファイルは変更しません。
- `--concurrency=N`: 並列ワーカー数（デフォルト 4）。
- `--dry-run`: 実ファイルは変更しません。
- `--concurrency=N`: 並列ワーカー数（デフォルト 4）。

注意
- SVG / ベクター画像は処理対象に含まれません。GIF アニメは想定外の変化が起きる場合があります。
- まずは `--dry-run` → 小さなフォルダで確認 → 本運用 の順で実行してください。

次のステップ提案

ファイル
- `scripts/resize-images.js`: 実行スクリプト
