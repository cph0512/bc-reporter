# Azure AD Application 設定說明書

## BC Financial Reporter — Azure Active Directory 應用程式註冊指南

**適用對象：** 系統管理員
**最後更新：** 2026-03
**目的：** 讓 BC Financial Reporter 透過 OAuth 2.0 Client Credentials 存取 Dynamics 365 Business Central API（唯讀）

---

## 目錄

1. [架構總覽](#1-架構總覽)
2. [Step 1：Azure Portal — 建立 App Registration](#2-step-1azure-portal--建立-app-registration)
3. [Step 2：Azure Portal — 建立 Client Secret](#3-step-2azure-portal--建立-client-secret)
4. [Step 3：Azure Portal — 設定 API 權限](#4-step-3azure-portal--設定-api-permissions)
5. [Step 4：Azure Portal — 設定 Redirect URI](#5-step-4azure-portal--設定-redirect-uri)
6. [Step 5：BC Admin — 註冊 Azure AD Application](#6-step-5bc-admin--註冊-azure-ad-application)
7. [Step 6：BC Admin — 授予 Permission Set](#7-step-6bc-admin--授予-permission-set)
8. [Step 7：取得 Company ID](#8-step-7取得-company-id)
9. [環境變數對照表](#9-環境變數對照表)
10. [常見問題 FAQ](#10-常見問題-faq)
11. [安全性建議](#11-安全性建議)

---

## 1. 架構總覽

```
BC Financial Reporter (Node.js)
        │
        │  OAuth 2.0 Client Credentials Flow
        │  (不需要使用者登入、不佔用 BC 授權)
        │
        ▼
Azure AD (Microsoft Entra ID)
        │
        │  Access Token
        │
        ▼
Business Central API v2.0
        │
        │  GET /companies/{id}/generalLedgerEntries
        │  GET /companies/{id}/accounts
        │  GET /companies/{id}/incomeStatement
        │  GET /companies/{id}/balanceSheet
        │
        ▼
    唯讀資料 (D365 READ Permission Set)
```

**重點：**
- 使用 **Client Credentials** 流程，不需要任何使用者互動登入
- 不佔用 BC 使用者授權 (License)
- 只有 **讀取** 權限，無法修改 BC 任何資料

---

## 2. Step 1：Azure Portal — 建立 App Registration

### 進入 Azure Portal
1. 開啟 https://portal.azure.com
2. 搜尋 **「App registrations」**（應用程式註冊）
3. 點擊 **「+ New registration」**（新增註冊）

### 填寫資訊

| 欄位 | 填寫內容 |
|------|---------|
| **Name** | `BC-Financial-Reporter`（自訂名稱） |
| **Supported account types** | 選擇 **「Accounts in this organizational directory only」**（僅限此組織目錄中的帳戶）— Single tenant |
| **Redirect URI** | 先留空（Step 4 再設定） |

4. 點擊 **「Register」**

### 記錄重要資訊

註冊完成後，在 **Overview** 頁面記錄：

| 欄位 | 對應環境變數 | 說明 |
|------|------------|------|
| **Application (client) ID** | `BC_CLIENT_ID` | 應用程式唯一識別碼 |
| **Directory (tenant) ID** | `BC_TENANT_ID` | Azure AD 租用戶識別碼 |

> **截圖位置：** Azure Portal → App registrations → BC-Financial-Reporter → Overview

---

## 3. Step 2：Azure Portal — 建立 Client Secret

1. 在 App Registration 頁面，左側選單點 **「Certificates & secrets」**
2. 點 **「+ New client secret」**
3. 填寫：

| 欄位 | 建議值 |
|------|-------|
| **Description** | `BC Reporter Production Key` |
| **Expires** | 建議選 **24 months**（到期前需更換） |

4. 點 **「Add」**

### 記錄 Secret

| 欄位 | 對應環境變數 | 注意事項 |
|------|------------|---------|
| **Value** | `BC_CLIENT_SECRET` | **只會顯示一次！** 立即複製保存 |

> **重要：** Secret 的 Value（不是 Secret ID）只在建立時顯示一次。如果沒有複製，需要刪除後重新建立。

---

## 4. Step 3：Azure Portal — 設定 API 權限

1. 左側選單點 **「API permissions」**
2. 點 **「+ Add a permission」**
3. 選擇 **「Dynamics 365 Business Central」**
4. 選擇 **「Application permissions」**（不是 Delegated permissions）
5. 勾選：
   - **`API.ReadWrite.All`** — BC API 存取權限
   - **`Automation.ReadWrite.All`**（選填，用於自動化）

6. 點 **「Add permissions」**

### 授予管理員同意

7. 回到 API permissions 頁面
8. 點 **「Grant admin consent for {你的組織}」**
9. 確認後，所有權限的 Status 應顯示 **「Granted for {組織}」** ✅

> **注意：** 如果沒有 Grant admin consent，API 呼叫會回傳 401 Unauthorized。

---

## 5. Step 4：Azure Portal — 設定 Redirect URI

> 此步驟是為了讓 BC 的「Grant Consent」按鈕能正常運作。

1. 左側選單點 **「Authentication」**
2. 點 **「+ Add a platform」**
3. 選擇 **「Web」**
4. 填入 Redirect URI：

```
https://businesscentral.dynamics.com/OAuthLanding.htm
```

5. 點 **「Configure」**

### 為什麼需要？

BC 的 Azure AD Applications 頁面有「Grant Consent」按鈕，會透過 OAuth 流程確認授權。如果沒有設定 Redirect URI，會出現錯誤：

```
AADSTS500113: No reply address is registered for the application.
```

---

## 6. Step 5：BC Admin — 註冊 Azure AD Application

### 進入 BC

1. 登入 Business Central：https://businesscentral.dynamics.com
2. 確認你在正確的 **環境**（Production / UAT / Sandbox）
3. 搜尋 **「Azure Active Directory Applications」**

### 新增 Application

4. 點 **「+ New」**
5. 填寫：

| 欄位 | 填寫內容 |
|------|---------|
| **Client Id** | 貼上 Step 1 記錄的 `Application (client) ID` |
| **Description** | `BC Financial Reporter` |
| **State / 狀態** | 改為 **「Enabled / 已啟用」** |

> **重要：** 新建的 Application 預設狀態是 **「Disabled / 已停用」**，必須手動改為 **「Enabled / 已啟用」**！

### Grant Consent

6. 點 **「Grant Consent」** 按鈕
7. 會跳出 Microsoft 登入視窗，使用管理員帳號授權
8. 授權成功後，回到 BC 頁面

> **如果 Grant Consent 失敗並出現 AADSTS500113 錯誤：** 請確認 Step 4 的 Redirect URI 已正確設定。

---

## 7. Step 6：BC Admin — 授予 Permission Set

### 在同一個 Azure AD Application 頁面

1. 往下看 **「User Permission Sets」** 區域
2. 點 **「+ New Line」**
3. 填寫：

| 欄位 | 填寫內容 |
|------|---------|
| **Permission Set** | `D365 READ` |
| **Company / 公司** | 選擇你的公司名稱（例：品辰科技物流股份有限公司） |

> **重要：** Company 欄位 **不能留空**！留空會導致 API 回傳 0 間公司。必須選擇具體的公司。

### 關於 Permission Set

| Permission Set | 說明 | 建議 |
|---------------|------|------|
| **D365 READ** | 唯讀存取所有 D365 資料 | **推薦** — 報表系統只需要讀取 |
| **D365 FULL ACCESS** | 完整讀寫權限 | 不建議 — 安全風險 |
| **D365 BUS FULL ACCESS** | 商業功能完整存取 | 不建議 |
| 自訂 Permission Set | 只開放特定 Table | 進階選項，最安全 |

---

## 8. Step 7：取得 Company ID

Company ID 是一個 GUID，不是公司名稱。透過 API 取得：

### 方法 A：使用 curl

```bash
# 1. 先取得 Token
curl -X POST "https://login.microsoftonline.com/{BC_TENANT_ID}/oauth2/v2.0/token" \
  -d "grant_type=client_credentials" \
  -d "client_id={BC_CLIENT_ID}" \
  -d "client_secret={BC_CLIENT_SECRET}" \
  -d "scope=https://api.businesscentral.dynamics.com/.default"

# 2. 用 Token 查詢 Companies
curl -H "Authorization: Bearer {TOKEN}" \
  "https://api.businesscentral.dynamics.com/v2.0/{BC_TENANT_ID}/{BC_ENVIRONMENT}/api/v2.0/companies"
```

### 方法 B：使用瀏覽器

直接在 BC 的網址列觀察，公司 ID 通常出現在 URL 中：
```
https://businesscentral.dynamics.com/{tenant}/...?company=aca05dc8-264e-ef11-bfe6-6045bdac9a88
```

### 回傳範例

```json
{
  "value": [
    {
      "id": "aca05dc8-264e-ef11-bfe6-6045bdac9a88",
      "name": "品辰科技物流股份有限公司",
      "displayName": "品辰科技物流股份有限公司"
    }
  ]
}
```

將 `id` 欄位的值設為 `BC_COMPANY_ID`。

---

## 9. 環境變數對照表

將以下環境變數設定在 `.env` 檔案或部署平台（如 Railway）：

```env
# Azure AD / Microsoft Entra ID
BC_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx     # Step 1: Directory (tenant) ID
BC_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx     # Step 1: Application (client) ID
BC_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx    # Step 2: Client Secret Value

# Business Central
BC_ENVIRONMENT=Production                              # 環境名稱：Production / UAT / Sandbox
BC_COMPANY_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx    # Step 7: Company GUID

# Server
PORT=8080
```

| 變數 | 來源 | 格式 |
|------|------|------|
| `BC_TENANT_ID` | Azure Portal → App Registration → Overview | GUID |
| `BC_CLIENT_ID` | Azure Portal → App Registration → Overview | GUID |
| `BC_CLIENT_SECRET` | Azure Portal → Certificates & secrets | 字串 |
| `BC_ENVIRONMENT` | BC 環境名稱 | `Production` / `UAT` / `Sandbox` |
| `BC_COMPANY_ID` | API 查詢取得 | GUID |

---

## 10. 常見問題 FAQ

### Q1: Grant Consent 出現 AADSTS500113 錯誤
**原因：** 未設定 Redirect URI
**解決：** 回到 Azure Portal → Authentication → 新增 Redirect URI：
```
https://businesscentral.dynamics.com/OAuthLanding.htm
```

### Q2: API 回傳 401 Unauthorized
**可能原因：**
1. 未在 Azure Portal 點「Grant admin consent」
2. BC 的 Azure AD Application 狀態為「已停用」
3. BC 的 Permission Set 未授予或 Company 欄位為空
4. Client Secret 已過期

### Q3: API 回傳 0 間公司（空陣列）
**原因：** Permission Set 的 Company 欄位留空
**解決：** 到 BC → Azure AD Applications → User Permission Sets → 選擇具體公司

### Q4: incomeStatement / balanceSheet 回傳 404
**原因：** BC 環境尚未初始化標準報表 API
**解決方案 A：** 在 BC 搜尋「API Setup」→ 勾選「Integrate APIs」→ 執行
**解決方案 B：** BC Financial Reporter 已內建 fallback，會從 General Ledger Entries 自動建構報表

### Q5: Client Secret 過期了怎麼辦？
1. Azure Portal → App Registration → Certificates & secrets
2. 建立新的 Client Secret
3. 更新 `.env` 或 Railway 的 `BC_CLIENT_SECRET`
4. 重啟服務

### Q6: 多個 BC 環境（Production + UAT）怎麼辦？
每個 BC 環境需要**各自註冊**：
- Azure AD App Registration：**只需要一個**（共用 Client ID/Secret）
- BC Azure AD Applications：**每個環境各建一個**（Step 5-6 重複執行）
- 部署時用 `BC_ENVIRONMENT` 環境變數切換

### Q7: D365 READ 權限能做什麼？
| 能讀取的資料 | 範例 |
|------------|------|
| 總帳分錄 | General Ledger Entries |
| 會計科目表 | Chart of Accounts |
| 客戶/供應商 | Customers / Vendors |
| 項目/品項 | Items |
| 銷售/採購單據 | Sales Orders / Purchase Orders |
| 銀行帳戶 | Bank Accounts |
| 固定資產 | Fixed Assets |

**不能做的事：** 新增、修改、刪除任何資料。

---

## 11. 安全性建議

### Client Secret 管理
- **永遠不要** 把 Client Secret 寫進程式碼或 Git
- 使用 `.env` 檔案（已加入 `.gitignore`）
- 部署時使用平台的環境變數功能（Railway / Vercel / Azure Key Vault）
- 設定到期提醒，Secret 過期前更換

### 最小權限原則
- 使用 `D365 READ` 而非 `D365 FULL ACCESS`
- 只授權需要的公司
- 如果只需要特定 Table，建立自訂 Permission Set

### 監控
- 定期檢查 Azure Portal → App Registration → 登入記錄
- 設定異常登入通知
- 監控 API 使用量

### Token 安全
- Access Token 有效期通常為 1 小時
- BC Financial Reporter 會在過期前 5 分鐘自動更新
- Token 只存在記憶體中，不會寫入檔案

---

## 完整流程 Checklist

- [ ] **Azure Portal**
  - [ ] 建立 App Registration
  - [ ] 記錄 Tenant ID 和 Client ID
  - [ ] 建立 Client Secret 並記錄 Value
  - [ ] 新增 API Permission: Dynamics 365 Business Central
  - [ ] Grant admin consent
  - [ ] 新增 Redirect URI: `https://businesscentral.dynamics.com/OAuthLanding.htm`

- [ ] **Business Central**
  - [ ] 建立 Azure AD Application（填入 Client ID）
  - [ ] 狀態改為「已啟用」
  - [ ] Grant Consent
  - [ ] 新增 Permission Set: D365 READ
  - [ ] Permission Set 的 Company 欄位選擇正確公司

- [ ] **環境變數**
  - [ ] 設定 BC_TENANT_ID
  - [ ] 設定 BC_CLIENT_ID
  - [ ] 設定 BC_CLIENT_SECRET
  - [ ] 設定 BC_ENVIRONMENT
  - [ ] 設定 BC_COMPANY_ID（GUID 格式）

- [ ] **驗證**
  - [ ] `npm run test:api` 通過
  - [ ] Dashboard 可正常顯示報表
