# BC Financial Reporter — 設定指南

## 📁 專案結構

```
bc-reporter/
├── config/
│   └── accounts-mapping.json    ← 會計科目對照（EBITDA計算用）
├── scripts/
│   └── test-bc-connection.js    ← 連線測試腳本
├── src/
│   ├── index.js                 ← Express 主程式
│   ├── routes/
│   │   └── reports.js           ← REST API 路由
│   └── services/
│       ├── bcClient.js          ← BC API 連線（OAuth 2.0）
│       ├── lineBot.js           ← LINE Bot 整合
│       └── reportEngine.js      ← 報表引擎（EBITDA/損益/資產負債）
├── .env.example
└── package.json
```

## 🔧 Step 1：Azure AD App Registration（免佔 BC 帳號）

1. 登入 [Azure Portal](https://portal.azure.com)
2. 搜尋 **App Registrations** → **New registration**
3. 名稱：`BC Financial Reporter`
4. Supported account types：選 **Single tenant**
5. 建立後記下：
   - **Application (client) ID** → 填入 `BC_CLIENT_ID`
   - **Directory (tenant) ID** → 填入 `BC_TENANT_ID`

6. 左側 **Certificates & secrets** → **New client secret**
   - 建立後記下 Value → 填入 `BC_CLIENT_SECRET`

7. 左側 **API permissions** → **Add a permission**
   - 選 **Dynamics 365 Business Central**
   - 選 **Application permissions**
   - 勾選 `API.ReadWrite.All` 或 `Financials.ReadWrite.All`
   - 按 **Grant admin consent**

## 🔧 Step 2：在 BC 註冊 Azure AD App

1. 登入 Business Central
2. 搜尋頁面 **Azure Active Directory Applications**
3. **New** → 填入：
   - **Client ID**: 貼上上面的 Application (client) ID
   - **Description**: BC Financial Reporter
4. **Grant Consent** 按鈕
5. 設定 **User Permission Sets**：
   - 新增 `D365 READ` 或自訂一個僅含讀取權限的 Permission Set

## 🔧 Step 3：取得 Company ID

在 BC 中搜尋 **Companies** 頁面，或呼叫 API：
```
GET https://api.businesscentral.dynamics.com/v2.0/{TenantID}/Production/api/v2.0/companies
```
找到你的公司，記下 `id` 欄位 → 填入 `BC_COMPANY_ID`

## 🔧 Step 4：設定 .env

```bash
cp .env.example .env
# 用編輯器填入上面收集到的資訊
```

## 🔧 Step 5：安裝 & 測試

```bash
npm install

# 先測試連線
npm run test:api

# 啟動伺服器
npm start       # Production
npm run dev     # Development（自動重啟）
```

## 🔧 Step 6：調整科目對照

執行 `test:api` 後會列出你公司的 Chart of Accounts。
根據實際科目號碼編輯 `config/accounts-mapping.json`：

```json
{
  "revenue": ["4100-4999"],       ← 營收科目範圍
  "cogs": ["5100-5999"],          ← 銷貨成本
  "operating_expenses": ["6100-6399"], ← 營業費用（排除折舊攤銷）
  "depreciation": ["6100"],       ← 折舊科目
  "amortization": ["6200"],       ← 攤銷科目
  "interest_expense": ["7510"],   ← 利息費用
  "tax_expense": ["8100"]         ← 所得稅費用
}
```

## 📡 API 端點

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/ebitda?year=2025&month=6&compare=yoy` | EBITDA（可比較） |
| GET | `/api/ebitda/ytd?year=2025&month=6` | EBITDA 年度累計 |
| GET | `/api/ebitda/trend?year=2025&month=6&months=6` | EBITDA 趨勢 |
| GET | `/api/income-statement?year=2025&month=6&compare=mom` | 損益表 |
| GET | `/api/balance-sheet?year=2025&month=6&compare=yoy` | 資產負債表 |
| GET | `/api/accounts` | 會計科目表 |
| GET | `/api/config/accounts-mapping` | 科目對照設定 |
| PUT | `/api/config/accounts-mapping` | 更新科目對照 |

**compare 參數值：**
- `none` — 不比較
- `yoy` — 去年同期 (Year over Year)
- `mom` — 上個月 (Month over Month)
- `qoq` — 上一季 (Quarter over Quarter)

## 💬 LINE Bot 指令

連接 LINE Bot 後可用自然語言查詢：

```
EBITDA 2025/6
損益表 2025/6 比去年
資產負債表 2025/3
這個月EBITDA
上個月損益表
YTD EBITDA 2025
```

## 🖥️ React Dashboard

React Dashboard（bc-financial-dashboard.jsx）可以：
1. 作為獨立的 React 元件嵌入你的前端專案
2. 將 Mock Data 替換為呼叫後端 API（fetch `/api/ebitda` 等）
3. 支援中英文切換、年月選擇、YoY/MoM 比較

### 連接真實 API 的改法

將 dashboard 中的 mock data 替換為：
```javascript
const fetchEbitda = async (year, month, compare) => {
  const res = await fetch(`/api/ebitda?year=${year}&month=${month}&compare=${compare}`);
  return res.json();
};
```

## ⚠️ 注意事項

1. **Rate Limiting**: BC API 有請求限制，程式已內建 retry 邏輯
2. **Token 過期**: Client Secret 預設 6 個月過期，記得提前更換
3. **科目對照**: 這是最關鍵的步驟，EBITDA 的正確性完全取決於科目分類是否正確
4. **資料延遲**: BC 的帳務如果還沒 Post，API 拉到的會是部分資料
5. **快取**: 報表結果快取 10 分鐘，可在 reportEngine.js 調整
