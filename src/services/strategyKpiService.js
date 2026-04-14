// src/services/strategyKpiService.js
// KPI Engine — calculates achievement rates, pipeline coverage, and strategy execution
// Merges forecast targets with BC actuals and pipeline data

const strategyStore = require('./strategyStore');
const pipelineStore = require('./pipelineStore');

const strategyKpiService = {
  /**
   * Calculate all KPI results for a given scenario, year, and optional quarter
   * Returns: { kpis: [...], summary: { ... } }
   */
  async calculateKpis({ scenarioId, companyId, year, quarter, reportEngine }) {
    const scenario = strategyStore.getScenarioById(scenarioId);
    if (!scenario) throw new Error('Scenario not found');

    const kpiDefs = strategyStore.getKpiDefinitions();
    const results = [];

    // Get forecast lines for the period
    const periodFilter = quarter ? `${year}-Q${quarter}` : year;
    const forecastLines = strategyStore.getForecastLines({
      scenarioId,
      year: String(year),
    });

    // Aggregate forecast totals for the year/quarter
    const forecast = this._aggregateForecast(forecastLines, year, quarter);

    // Get BC actuals if reportEngine available
    let actuals = { revenue: 0, grossProfit: 0, opex: 0, operatingProfit: 0 };
    if (reportEngine && companyId) {
      try {
        actuals = await this._fetchBCActuals(reportEngine, companyId, year, quarter);
      } catch (err) {
        console.error('Failed to fetch BC actuals:', err.message);
      }
    }

    // Get pipeline data
    const pipeline = this._getPipelineMetrics();

    // Get strategy execution data
    const strategyExec = this._getStrategyExecution();

    // Calculate each KPI
    for (const kpi of kpiDefs) {
      const result = this._calculateSingleKpi(kpi, { forecast, actuals, pipeline, strategyExec });
      results.push(result);
    }

    return {
      scenarioId,
      year,
      quarter: quarter || null,
      companyId: companyId || null,
      kpis: results,
      forecast,
      actuals,
      pipeline,
      strategyExec,
    };
  },

  /**
   * Get KPI overview for dashboard — simplified summary
   */
  async getOverview({ scenarioId, companyId, year, reportEngine }) {
    const fullResult = await this.calculateKpis({ scenarioId, companyId, year, reportEngine });

    // Get quarterly breakdown for charts
    const quarterlyData = [];
    for (let q = 1; q <= 4; q++) {
      const forecastLines = strategyStore.getForecastLines({ scenarioId, year: String(year) });
      const qForecast = this._aggregateForecast(forecastLines, year, q);
      quarterlyData.push({
        quarter: `Q${q}`,
        periodKey: `${year}-Q${q}`,
        forecast: qForecast,
      });
    }

    // Get market breakdown
    const marketBreakdown = this._getMarketBreakdown(scenarioId, year);

    // Get business model breakdown
    const bizBreakdown = this._getBizModelBreakdown(scenarioId, year);

    return {
      ...fullResult,
      quarterlyData,
      marketBreakdown,
      bizBreakdown,
    };
  },

  /**
   * Calculate pipeline coverage vs forecast gap
   */
  getPipelineCoverage({ scenarioId, year }) {
    const forecastLines = strategyStore.getForecastLines({ scenarioId, year: String(year) });
    const yearForecast = this._aggregateForecast(forecastLines, year, null);
    const targetRevenue = yearForecast.revenue || 0;

    // For now, actual revenue is 0 until BC data is fetched
    // In practice, this would be populated from BC actuals
    const actualRevenue = 0;
    const forecastGap = Math.max(targetRevenue - actualRevenue, 0);

    // Calculate weighted pipeline
    const leads = pipelineStore.getLeads();
    const activeLeads = leads.filter(l => l.status !== '已完成' && l.status !== '擱置');

    // Assign probability by status
    const statusProbability = {
      '初步接觸': 0.1,
      '進行中': 0.3,
      '報價': 0.6,
      '已完成': 1.0,
      '擱置': 0,
    };

    let weightedPipeline = 0;
    let totalPipelineValue = 0;
    const leadDetails = [];

    for (const lead of activeLeads) {
      const value = lead.estimatedValue || 0;
      const prob = statusProbability[lead.status] || 0;
      const weighted = value * prob;
      weightedPipeline += weighted;
      totalPipelineValue += value;
      if (value > 0) {
        leadDetails.push({
          id: lead.id,
          company: lead.companyName,
          status: lead.status,
          value,
          probability: prob,
          weighted,
        });
      }
    }

    const coverage = forecastGap > 0 ? weightedPipeline / forecastGap : (weightedPipeline > 0 ? Infinity : 0);

    return {
      targetRevenue,
      actualRevenue,
      forecastGap,
      weightedPipeline,
      totalPipelineValue,
      coverage,
      coverageFormatted: coverage === Infinity ? '∞' : `${(coverage).toFixed(2)}x`,
      activeLeadsCount: activeLeads.length,
      leadDetails: leadDetails.sort((a, b) => b.weighted - a.weighted).slice(0, 20),
    };
  },

  // ===== Internal helpers =====

  _aggregateForecast(lines, year, quarter) {
    if (quarter) {
      const qKey = `${year}-Q${quarter}`;
      return this._aggregateForecastPeriod(lines.filter(l => l.periodKey === qKey));
    }

    const annualLines = lines.filter(l => l.periodType === 'year' && l.periodKey === String(year));
    if (annualLines.length > 0) {
      return this._aggregateForecastPeriod(annualLines);
    }

    const quarterlyLines = lines.filter(l => l.periodType === 'quarter' && l.periodKey.startsWith(String(year)));
    const agg = { revenue: 0, grossProfit: 0, opex: 0, operatingProfit: 0, netIncome: 0 };

    const quarterKeys = [...new Set(quarterlyLines.map(line => line.periodKey))];
    for (const periodKey of quarterKeys) {
      const periodAgg = this._aggregateForecastPeriod(quarterlyLines.filter(line => line.periodKey === periodKey));
      for (const [key, value] of Object.entries(periodAgg)) {
        agg[key] += value || 0;
      }
    }

    return agg;
  },

  _aggregateForecastPeriod(lines) {
    const metrics = ['revenue', 'grossProfit', 'opex', 'operatingProfit', 'netIncome'];
    const result = {};

    for (const metric of metrics) {
      result[metric] = this._pickMetricValue(lines, metric);
    }

    return result;
  },

  _pickMetricValue(lines, metricCode) {
    const candidates = this._metricLabelMatchers(metricCode);

    for (const matcher of candidates) {
      const line = lines.find(item => matcher.test(this._normalizeForecastLabel(item.rowLabel || '')));
      if (!line) continue;

      if (typeof line.metrics?.[metricCode] === 'number') return line.metrics[metricCode];
      if (typeof line.value === 'number') return line.value;
    }

    return 0;
  },

  _normalizeForecastLabel(label) {
    return String(label || '')
      .replace(/[（(].*?[)）]/g, '')
      .replace(/\s+/g, '')
      .toLowerCase();
  },

  _metricLabelMatchers(metricCode) {
    const map = {
      revenue: [/^總營收$/, /^營收合計$/, /^營收$/, /^revenue$/i],
      grossProfit: [/^總毛利$/, /^毛利合計$/, /^毛利$/, /^grossprofit$/i],
      opex: [/^營運費用$/, /^營業費用合計$/, /^其他費用$/, /^opex$/i],
      operatingProfit: [/^營業利益$/, /^operatingprofit$/i, /^operatingincome$/i],
      netIncome: [/^稅後淨利$/, /^淨利$/, /^netincome$/i],
    };

    return map[metricCode] || [];
  },

  async _fetchBCActuals(reportEngine, companyId, year, quarter) {
    try {
      // Use existing report engine to get income statement data
      let startDate, endDate;
      if (quarter) {
        const qStart = (quarter - 1) * 3 + 1;
        startDate = `${year}-${String(qStart).padStart(2, '0')}-01`;
        const qEnd = quarter * 3;
        const lastDay = new Date(year, qEnd, 0).getDate();
        endDate = `${year}-${String(qEnd).padStart(2, '0')}-${lastDay}`;
      } else {
        startDate = `${year}-01-01`;
        endDate = `${year}-12-31`;
      }

      const report = await reportEngine.getIncomeStatement(companyId, startDate, endDate);
      if (report && report.sections) {
        return {
          revenue: (report.sections.revenue?.total || 0) / 1000000,  // Convert to millions
          grossProfit: (report.sections.grossProfit?.total || 0) / 1000000,
          opex: (report.sections.operatingExpenses?.total || 0) / 1000000,
          operatingProfit: (report.sections.operatingIncome?.total || 0) / 1000000,
        };
      }
    } catch (err) {
      console.error('BC actuals fetch error:', err.message);
    }
    return { revenue: 0, grossProfit: 0, opex: 0, operatingProfit: 0 };
  },

  _getPipelineMetrics() {
    const leads = pipelineStore.getLeads();
    const statusCounts = {};
    let totalValue = 0;
    let completedValue = 0;

    for (const lead of leads) {
      statusCounts[lead.status] = (statusCounts[lead.status] || 0) + 1;
      const val = lead.estimatedValue || 0;
      totalValue += val;
      if (lead.status === '已完成') completedValue += val;
    }

    return {
      totalLeads: leads.length,
      statusCounts,
      totalValue,
      completedValue,
      conversionRate: leads.length > 0 ? leads.filter(l => l.status === '已完成').length / leads.length : 0,
    };
  },

  _getStrategyExecution() {
    const strategies = strategyStore.getStrategies();
    let totalMilestones = 0;
    let completedMilestones = 0;
    let activeStrategies = 0;

    for (const str of strategies) {
      if (str.status === 'in_progress') activeStrategies++;
      for (const ms of (str.milestones || [])) {
        totalMilestones++;
        if (ms.completed) completedMilestones++;
      }
    }

    return {
      totalStrategies: strategies.length,
      activeStrategies,
      totalMilestones,
      completedMilestones,
      executionRate: totalMilestones > 0 ? completedMilestones / totalMilestones : 0,
    };
  },

  _calculateSingleKpi(kpiDef, data) {
    let value = null;
    let target = null;
    let actual = null;

    const { forecast, actuals, pipeline, strategyExec } = data;

    switch (kpiDef.code) {
      case 'revenue_achievement':
        target = forecast.revenue || 0;
        actual = actuals.revenue || 0;
        value = target > 0 ? actual / target : 0;
        break;
      case 'gross_margin':
        actual = actuals.revenue > 0 ? actuals.grossProfit / actuals.revenue : 0;
        target = forecast.revenue > 0 ? forecast.grossProfit / forecast.revenue : 0;
        value = actual;
        break;
      case 'opex_ratio':
        actual = actuals.revenue > 0 ? actuals.opex / actuals.revenue : 0;
        target = forecast.revenue > 0 ? forecast.opex / forecast.revenue : 0;
        value = actual;
        break;
      case 'pipeline_coverage':
        // Calculated separately via getPipelineCoverage()
        value = pipeline.totalValue > 0 ? pipeline.totalValue / (forecast.revenue || 1) : 0;
        target = 3.0; // 3x coverage target
        actual = value;
        break;
      case 'strategy_execution':
        value = strategyExec.executionRate;
        target = 1.0;
        actual = value;
        break;
      case 'customer_achievement':
        // Would need BC customer count data
        value = 0;
        target = 0;
        actual = 0;
        break;
      case 'order_achievement':
        // Would need BC order count data
        value = 0;
        target = 0;
        actual = 0;
        break;
      default:
        value = 0;
    }

    // Determine traffic light color
    let statusColor = 'red';
    if (kpiDef.code === 'opex_ratio') {
      // Lower is better for expense ratio
      if (value <= kpiDef.thresholdGreen) statusColor = 'green';
      else if (value <= kpiDef.thresholdYellow) statusColor = 'yellow';
    } else {
      if (value >= kpiDef.thresholdGreen) statusColor = 'green';
      else if (value >= kpiDef.thresholdYellow) statusColor = 'yellow';
    }

    return {
      kpiId: kpiDef.id,
      code: kpiDef.code,
      name: kpiDef.name,
      nameEn: kpiDef.nameEn,
      value,
      target,
      actual,
      displayUnit: kpiDef.displayUnit,
      statusColor,
      formatted: kpiDef.displayUnit === '%' ? `${(value * 100).toFixed(1)}%`
        : kpiDef.displayUnit === 'x' ? `${value.toFixed(2)}x`
        : String(value),
    };
  },

  _getMarketBreakdown(scenarioId, year) {
    const lines = strategyStore.getForecastLines({ scenarioId, year: String(year) });
    const markets = {};

    for (const line of lines) {
      if (line.market === 'Total' || line.businessModel !== 'Total') continue;
      if (line.periodType === 'year' && line.periodKey === String(year)) {
        markets[line.market] = line.metrics?.revenue || 0;
      }
    }

    // If no annual lines, sum quarterly
    if (Object.keys(markets).length === 0) {
      for (const line of lines) {
        if (line.market === 'Total' || line.businessModel !== 'Total') continue;
        if (line.periodType === 'quarter' && line.periodKey.startsWith(String(year))) {
          markets[line.market] = (markets[line.market] || 0) + (line.metrics?.revenue || 0);
        }
      }
    }

    return Object.entries(markets).map(([market, revenue]) => ({ market, revenue }));
  },

  _getBizModelBreakdown(scenarioId, year) {
    const lines = strategyStore.getForecastLines({ scenarioId, year: String(year) });
    const bizModels = {};

    for (const line of lines) {
      if (line.businessModel === 'Total' || line.market !== 'Total') continue;
      if (line.periodType === 'year' && line.periodKey === String(year)) {
        bizModels[line.businessModel] = line.metrics?.revenue || 0;
      }
    }

    if (Object.keys(bizModels).length === 0) {
      for (const line of lines) {
        if (line.businessModel === 'Total' || line.market !== 'Total') continue;
        if (line.periodType === 'quarter' && line.periodKey.startsWith(String(year))) {
          bizModels[line.businessModel] = (bizModels[line.businessModel] || 0) + (line.metrics?.revenue || 0);
        }
      }
    }

    return Object.entries(bizModels).map(([biz, revenue]) => ({ businessModel: biz, revenue }));
  },
};

module.exports = strategyKpiService;
