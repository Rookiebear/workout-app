# workout-app
筋トレメニュー管理アプリ（iPhone向けPWA）

目的・曜日・ジムの器具から週のメニューを作り、ジムで片手で記録し、次回の重量と回数をダブルプログレッションで提案する。データは端末内（IndexedDB）だけに保存し、JSONで書き出し・読み込みできる。

要件は [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)。いまは Phase 1（生成→記録→次回提案が一周回る状態）まで実装済み。

## 使い方（iPhone）

1. GitHub Pages の URL（`https://rookiebear.github.io/workout-app/`）を Safari で開く
2. 共有 → ホーム画面に追加
3. 初回は目的・曜日・器具・使えるマシン・重量を選んで「メニューを作る」
4. 一度開けば以降は電波がなくても動く

## 開発

```sh
npm install
npm run dev      # http://localhost:5173/workout-app/
npm test         # ロジックの単体テスト（Vitest）
npm run build    # 型チェック + 本番ビルド（dist/）
npm run preview  # ビルド結果を http://localhost:4173/workout-app/ で確認
npm run icons    # public/icons のアイコンを作り直す
```

ローカルが Node 16 でも動くよう、Vite 4 系と `workbox-build@7.0.0`（overrides）に固定している。CI は Node 20。

## 構成

| 場所 | 内容 |
| --- | --- |
| `data/exercises.json` | 種目マスタ（初回起動時に取り込み。後から増えた組み込み種目は自動で追加） |
| `src/config/defaults.ts` | 要件の表にある数値すべて（モード別パラメータ、分割法、所要時間、判定の閾値） |
| `src/logic/` | 純粋関数。日付も引数で受け取る。メニュー生成・重量提案・1RM・丸め・除外・バックアップ |
| `src/logic/*.test.ts` | 判定表の行ごとのテスト |
| `src/db/db.ts` | IndexedDB（Dexie）。settings / exercises / plans / sessions / pains / bodyMetrics |
| `src/ui/` | Preact の画面（今日・セッション・メニュー・履歴・設定） |

## 公開（GitHub Pages）

`main` への push で `.github/workflows/deploy.yml` がテスト→ビルド→公開する。初回だけリポジトリの Settings → Pages → Source を「GitHub Actions」にする。無料プランの Pages は公開リポジトリが必要（記録データは端末内なので公開されない）。

## Phase 1 で決めた既定値

要件の未決事項は、次の初期値で実装している。どれも設定画面で変えられる。

- マシンの種類：初回起動の「使えるマシン」でないものを外す。初期マスタは一般的なマシンを入れてある
- スミスのバー重量 15kg、ダンベルは片手 2–30kg の2kg刻み（設定でカンマ区切りの重量リストに変更可）
- RIR は任意入力
- UI は Preact
- 腹筋は部位に含めない（設定でON）
- 範囲で書かれた休憩時間は中央値を初期値にした（筋肥大の多関節 150秒 など）
- 1日の種目数は最大8、1部位1日最大8セット。同じ主働筋の2種目目にはウォームアップを付けない
