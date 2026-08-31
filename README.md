# 北海道イベントナビ PWA — Render対応版

スマホのホーム画面に追加して使えるWebアプリです。

## Renderへのデプロイ

### 1. GitHubへこのフォルダをアップロード
リポジトリ例: `hokkaido-event-navi`

### 2. RenderでWeb Serviceを作成
Render Dashboard → New → Web Service → GitHubリポジトリを選択。
`render.yaml`を使う場合は Blueprint から作成しても構いません。

手入力する場合:
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/meta`

### 3. 環境変数
Renderの Environment に以下を登録:
- `OPENAI_API_KEY` = OpenAI APIキー（Secret）
- `OPENAI_MODEL` = `gpt-5.6-luna`（省略可）

`PORT` はRenderが自動設定するため登録不要です。

### 4. Deploy
Deploy後、`https://<サービス名>.onrender.com` が発行されます。
`/api/meta` にアクセスしてJSONが返ればサーバー起動成功です。
トップURLを開くとPWA画面が表示されます。

## スマホへ追加
- iPhone: Safari → 共有 → ホーム画面に追加
- Android: Chrome → メニュー → アプリをインストール / ホーム画面に追加

## 画面構成
1. チケットぴあ指定検索URLのお笑い有料チケット（発売日・料金・会場・URL）
2. 次の土日祝のイベント
3. 次の次の土日祝のイベント
4. それ以降の土日祝イベント（開催日の近い順）

## 検索条件
札幌10区＋小樽、江別、北広島、恵庭、石狩、当別、新篠津、余市、仁木、岩見沢、南幌、長沼、月形、千歳、苫小牧、白老、登別。祭り、フェス、花火、ステージ、お笑い、マルシェ等を対象とし、町内会・公園・神社・商店街・地域SNSも検索します。「盆踊り」「縁日」は単独イベントなら除外します。

## 注意
- OpenAI API利用料が発生します。
- APIキーはブラウザ側へ置かず、RenderのSecret環境変数で管理してください。
- チケットぴあ側のHTMLやアクセス制限が変わると直接取得できない場合があります。その際はWeb検索をフォールバックとして使います。
