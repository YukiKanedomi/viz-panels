# viz-panels

各プロジェクトの**可視化をスマホで確認するハブ**。Claude Code が生成したインタラクティブパネル・グラフ・レポート・ダッシュボードをここに publish すると、GitHub Pages で公開されスマホから見られる。

**公開URL:** https://yukikanedomi.github.io/viz-panels/

## 構成
- `index.html` … ハブの一覧（`manifest.json` を読み、プロジェクト別カード＋検索で表示）
- `manifest.json` … 掲載物の台帳（project / title / file / type / added / desc）
- `<project>/<slug>.html` … 各可視化の実体（自己完結HTML）
- `add-viz.mjs` … 追加ヘルパー

## 追加のしかた
```
node add-viz.mjs <html> --project <名> --title "タイトル" --desc "説明" --type panel|chart|report|dashboard --date YYYY-MM-DD
git add -A && git commit -m "viz: ..." && git push   # push で自動公開
```

## 掲載中
- **kaizen-desk / 巡回コンサル 設定パネル** … 巡回設定を調整して「設定をコピー」→チャットに貼り戻す
