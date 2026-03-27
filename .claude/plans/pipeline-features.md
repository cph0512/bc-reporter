# Pipeline 三項新功能計畫

## 1. 客戶名稱搜尋

**前端 `public/index.html`：**
- 在 myPipelineView 的篩選區加一個搜尋 input（`id="myPlSearch"`）
- 在 admin pipelineDashboardView 的 dash-filters 加搜尋 input（`id="plSearch"`）
- `renderMyPipelineTable()` 和 `renderPipelineTable()` 加 client-side 過濾：`leads = leads.filter(l => l.companyName.includes(searchText))`
- i18n labels 加 `plSearchPlaceholder`
- `renderPipelineLabels()` 裡初始化 placeholder

## 2. 回顧紀錄優化顯示（維持日，優化 UI）

**表格欄位改動：**
- 移除週選擇器下拉選單（`myPlWeekSelect` / `plWeekSelect`）
- 表格「本週回顧」欄改為「最新回顧」— 顯示最近一筆 activity 的內容（不限於特定日期）
- 點擊「最新回顧」文字時可展開/收合（同 notes 欄位行為）
- 移除內聯編輯功能（回顧改在詳情頁操作更直覺）

**詳情頁改動（`openLeadDetail` / `renderLeadActivities`）：**
- 回顧列表按週分組：計算每筆 activity 屬於哪一週（ISO week），同一週的歸在一起
- 每週顯示一個標題 header（如「第 13 週 (03/24 ~ 03/30)」）
- 週內每筆按日期排序，顯示日期 + 內容
- 新增回顧 input 保持原樣（自動用當天日期作為 weekLabel）

## 3. 商機圖片上傳

**後端：**
- `pipelineStore.js` lead 資料結構加 `images` 陣列：`[{ id, dataUrl, fileName, uploadedAt, uploadedBy }]`
- `src/routes/pipeline.js` 加兩個端點：
  - `POST /leads/:id/images` — 上傳圖片（base64 in body）
  - `DELETE /leads/:id/images/:imgId` — 刪除圖片
- 圖片存為 base64 在 pipeline.json 裡（已有 10MB body limit，單張圖片壓縮後約 200-500KB 足夠）

**前端：**
- `openLeadDetail()` 裡加圖片區塊（在回顧紀錄上方）
- 顯示已上傳的圖片縮圖（grid layout）
- 點擊縮圖可放大檢視（lightbox）
- 上傳按鈕 + file input（支持多選）
- 刪除按鈕（admin 或上傳者可刪）
- i18n labels

## 修改檔案清單
1. `public/index.html` — 搜尋 input、回顧顯示優化、圖片區塊
2. `src/services/pipelineStore.js` — addImage / deleteImage 方法
3. `src/routes/pipeline.js` — 圖片上傳/刪除 API
