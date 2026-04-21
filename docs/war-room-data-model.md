# 戰情室資料模型

## 設計原則

- Forecast 與 Actual 分開存，避免口徑混淆。
- 所有數值都要可依期間與維度 roll-up。
- 所有調整都必須保留版本與異動紀錄。
- KPI 公式與資料來源分離，避免寫死在畫面。

## 核心實體

### scenario

用來表示一個 forecast 情境版本。

欄位：

- `id`
- `name`
- `type`
- `base_scenario_id`
- `status`
- `start_period`
- `end_period`
- `created_by`
- `created_at`
- `updated_at`

建議 `type`：

- `base`
- `stretch`
- `conservative`
- `custom`

建議 `status`：

- `draft`
- `published`
- `archived`

### forecast_line

用來表示某個期間、某個維度、某個科目的預測值。

欄位：

- `id`
- `scenario_id`
- `period_type`
- `period_key`
- `company_code`
- `bu_code`
- `product_line_code`
- `region_code`
- `customer_segment`
- `metric_code`
- `value`
- `currency`
- `version_no`
- `input_mode`
- `driver_id`
- `note`
- `updated_by`
- `updated_at`

建議 `metric_code`：

- `revenue`
- `gross_profit`
- `opex`
- `ebitda`
- `capex`
- `cash_in`
- `cash_out`

建議 `input_mode`：

- `manual`
- `growth_rate`
- `driver_based`
- `copied`

### forecast_driver

用來表示可反推 forecast 的 driver。

欄位：

- `id`
- `scenario_id`
- `driver_code`
- `period_key`
- `scope_type`
- `scope_key`
- `value`
- `unit`
- `updated_by`
- `updated_at`

常見 driver：

- `sales_headcount`
- `avg_deal_size`
- `conversion_rate`
- `shipment_volume`
- `asp`
- `gross_margin_rate`

### actual_line

ERP 匯入後的實績資料。

欄位：

- `id`
- `source_system`
- `period_type`
- `period_key`
- `company_code`
- `bu_code`
- `product_line_code`
- `region_code`
- `customer_id`
- `metric_code`
- `value`
- `currency`
- `document_ref`
- `import_batch_id`
- `imported_at`

### kpi_definition

定義 KPI 名稱、公式與展示方式。

欄位：

- `id`
- `kpi_code`
- `name`
- `formula_type`
- `numerator_metric`
- `denominator_metric`
- `formula_expression`
- `target_source`
- `display_unit`
- `threshold_green`
- `threshold_yellow`
- `threshold_red`
- `is_active`

### kpi_result

儲存某期間與某維度的 KPI 計算結果。

欄位：

- `id`
- `scenario_id`
- `period_type`
- `period_key`
- `company_code`
- `bu_code`
- `product_line_code`
- `region_code`
- `kpi_code`
- `target_value`
- `actual_value`
- `achievement_rate`
- `variance_value`
- `variance_percent`
- `status_color`
- `calculated_at`

### account_mapping

ERP 欄位對應到戰情室口徑。

欄位：

- `id`
- `source_system`
- `source_table`
- `source_field`
- `source_value`
- `target_metric_code`
- `target_dimension_type`
- `target_dimension_value`
- `effective_from`
- `effective_to`

### customer

現有客戶或潛在客戶主檔。

欄位：

- `id`
- `name`
- `type`
- `industry_code`
- `listed_code`
- `country`
- `region_code`
- `owner_sales_id`
- `status`
- `potential_score`
- `last_scored_at`

建議 `type`：

- `existing`
- `prospect`

### opportunity

業務商機，用來估算 pipeline 是否足以覆蓋 forecast 缺口。

欄位：

- `id`
- `customer_id`
- `name`
- `stage`
- `expected_close_period`
- `probability`
- `expected_revenue`
- `expected_gross_profit`
- `product_line_code`
- `region_code`
- `owner_sales_id`
- `source_type`
- `created_at`
- `updated_at`

### lead_signal

台股分析資料衍生出的潛在客戶訊號。

欄位：

- `id`
- `customer_id`
- `signal_date`
- `signal_type`
- `signal_score`
- `signal_summary`
- `source_name`
- `source_ref`

建議 `signal_type`：

- `revenue_growth`
- `capex_expansion`
- `new_factory`
- `earnings_call`
- `industry_upcycle`

### report_job

固定產報的排程與執行記錄。

欄位：

- `id`
- `report_type`
- `scenario_id`
- `period_key`
- `status`
- `template_code`
- `output_pdf_url`
- `output_xlsx_url`
- `recipients`
- `started_at`
- `finished_at`
- `error_message`

建議 `report_type`：

- `monthly`
- `quarterly`
- `yearly`

## 核心公式

### 達成率

`achievement_rate = actual_value / target_value`

### 差異

`variance_value = actual_value - target_value`

### 差異百分比

`variance_percent = (actual_value - target_value) / target_value`

### Pipeline Coverage

`pipeline_coverage = weighted_pipeline_amount / forecast_gap`

其中：

- `weighted_pipeline_amount = sum(expected_revenue * probability)`
- `forecast_gap = max(target_revenue - actual_revenue - committed_revenue, 0)`

## Forecast 編輯 API 建議

### 取得 scenario

- `GET /api/scenarios`
- `GET /api/scenarios/:id`

### 複製 scenario

- `POST /api/scenarios/:id/clone`

### 批次更新 forecast

- `POST /api/forecast-lines/bulk-upsert`

payload 範例：

```json
{
  "scenarioId": "scn_base_2027",
  "updates": [
    {
      "periodKey": "2027-01",
      "companyCode": "TW01",
      "buCode": "SEMI",
      "productLineCode": "ETCH",
      "metricCode": "revenue",
      "value": 125000000,
      "inputMode": "manual"
    },
    {
      "periodKey": "2027-01",
      "companyCode": "TW01",
      "buCode": "SEMI",
      "productLineCode": "ETCH",
      "metricCode": "gross_profit",
      "value": 41800000,
      "inputMode": "manual"
    }
  ]
}
```

### KPI 重算

- `POST /api/kpis/recalculate`

payload 範例：

```json
{
  "scenarioId": "scn_base_2027",
  "periodType": "month",
  "periodKey": "2027-01"
}
```

## 推薦技術切分

- OLTP 資料庫：PostgreSQL
- ERP 匯入層：ETL worker 或 integration service
- KPI / Forecast 運算：後端 service
- 報表排程：background jobs + cron
- 分析查詢：materialized views 或獨立 data mart

## 第一版最小資料表

如果要快速啟動 MVP，先做這 8 張表：

- `scenario`
- `forecast_line`
- `forecast_driver`
- `actual_line`
- `kpi_definition`
- `kpi_result`
- `customer`
- `opportunity`
