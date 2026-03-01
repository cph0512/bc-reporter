// src/services/lineBot.js
// LINE Bot 整合 — 自然語言查詢財務報表

const { Client, middleware } = require('@line/bot-sdk');

class LineBotService {
  constructor(config, reportEngine) {
    this.reportEngine = reportEngine;
    this.lineConfig = {
      channelSecret: config.LINE_CHANNEL_SECRET,
      channelAccessToken: config.LINE_CHANNEL_ACCESS_TOKEN,
    };
    this.client = new Client(this.lineConfig);
  }

  get middleware() {
    return middleware(this.lineConfig);
  }

  async handleWebhook(events) {
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        await this.handleTextMessage(event);
      }
    }
  }

  async handleTextMessage(event) {
    const text = event.message.text.trim();
    const replyToken = event.replyToken;

    try {
      const parsed = this.parseQuery(text);
      if (!parsed) {
        await this.client.replyMessage(replyToken, {
          type: 'text',
          text: '📊 財務報表查詢指令：\n\n'
            + '• EBITDA 2025/6\n'
            + '• 損益表 2025/6 比去年\n'
            + '• 資產負債表 2025/6\n'
            + '• EBITDA 2025/6 比上月\n'
            + '• 這個月EBITDA\n'
            + '• YTD EBITDA 2025',
        });
        return;
      }

      const { type, year, month, compare } = parsed;
      let message;

      switch (type) {
        case 'ebitda':
          message = await this.buildEbitdaMessage(year, month, compare);
          break;
        case 'income':
          message = await this.buildIncomeStatementMessage(year, month, compare);
          break;
        case 'balance':
          message = await this.buildBalanceSheetMessage(year, month, compare);
          break;
        default:
          message = { type: 'text', text: '抱歉，無法理解您的查詢。' };
      }

      await this.client.replyMessage(replyToken, message);
    } catch (error) {
      console.error('[LineBot] Error:', error.message);
      await this.client.replyMessage(replyToken, {
        type: 'text',
        text: `❌ 查詢失敗：${error.message}`,
      });
    }
  }

  // ===== Natural Language Parser =====

  parseQuery(text) {
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 1;
    let type = null;
    let compare = 'none';

    // Detect report type
    if (/ebitda/i.test(text)) type = 'ebitda';
    else if (/損益|income|p&l|pl/i.test(text)) type = 'income';
    else if (/資產負債|balance\s*sheet|bs/i.test(text)) type = 'balance';
    else if (/報表|財報|report/i.test(text)) type = 'ebitda'; // Default
    else return null;

    // Extract year/month: "2025/6", "2025-06", "2025年6月"
    const dateMatch = text.match(/(\d{4})[\/\-年](\d{1,2})/);
    if (dateMatch) {
      year = parseInt(dateMatch[1]);
      month = parseInt(dateMatch[2]);
    }

    // "這個月" / "本月" / "this month"
    if (/這個月|本月|this month/i.test(text)) {
      year = now.getFullYear();
      month = now.getMonth() + 1;
    }

    // "上個月" / "上月" / "last month"
    if (/上個月|上月|last month/i.test(text)) {
      month = now.getMonth(); // getMonth() is 0-indexed, so this gives last month
      if (month < 1) { month = 12; year--; }
    }

    // Detect comparison
    if (/去年|yoy|year.over|同期/i.test(text)) compare = 'yoy';
    else if (/上月|上個月|mom|month.over|比上/i.test(text)) compare = 'mom';
    else if (/比較|compare|vs/i.test(text)) compare = 'yoy'; // Default comparison

    return { type, year, month, compare };
  }

  // ===== Flex Message Builders =====

  async buildEbitdaMessage(year, month, compare) {
    const data = compare !== 'none'
      ? await this.reportEngine.getEbitdaComparison(year, month, compare)
      : { current: await this.reportEngine.getEbitda(year, month), previous: null };

    const c = data.current;
    const p = data.previous;
    const compareLabel = compare === 'yoy' ? '去年同期' : compare === 'mom' ? '上月' : '';

    const fmt = (n) => {
      if (n === null || n === undefined) return '—';
      return `$${(n / 10000).toFixed(1)}萬`;
    };

    const pctChange = (curr, prev) => {
      if (!prev || prev === 0) return '';
      const change = ((curr - prev) / Math.abs(prev) * 100).toFixed(1);
      return change > 0 ? ` ↑${change}%` : ` ↓${Math.abs(change)}%`;
    };

    const rows = [
      { label: '營業收入', value: fmt(c.revenue), change: p ? pctChange(c.revenue, p.revenue) : '' },
      { label: '毛利', value: fmt(c.grossProfit), change: p ? pctChange(c.grossProfit, p.grossProfit) : '' },
      { label: '營業利益', value: fmt(c.operatingIncome), change: p ? pctChange(c.operatingIncome, p.operatingIncome) : '' },
      { label: 'EBITDA', value: fmt(c.ebitda), change: p ? pctChange(c.ebitda, p.ebitda) : '' },
      { label: 'EBITDA利潤率', value: `${(c.ebitdaMargin * 100).toFixed(1)}%`, change: '' },
      { label: '淨利', value: fmt(c.netIncome), change: p ? pctChange(c.netIncome, p.netIncome) : '' },
    ];

    return this.buildFlexTable(
      `📊 EBITDA Report`,
      `${year}/${month}${compareLabel ? ` vs ${compareLabel}` : ''}`,
      rows
    );
  }

  async buildIncomeStatementMessage(year, month, compare) {
    const data = compare !== 'none'
      ? await this.reportEngine.getEbitdaComparison(year, month, compare) // Reuse EBITDA data which has all IS fields
      : { current: await this.reportEngine.getEbitda(year, month), previous: null };

    const c = data.current;
    const p = data.previous;
    const compareLabel = compare === 'yoy' ? '去年同期' : compare === 'mom' ? '上月' : '';

    const fmt = (n) => n ? `$${(n / 10000).toFixed(1)}萬` : '—';
    const pctChange = (curr, prev) => {
      if (!prev || prev === 0) return '';
      const change = ((curr - prev) / Math.abs(prev) * 100).toFixed(1);
      return change > 0 ? ` ↑${change}%` : ` ↓${Math.abs(change)}%`;
    };

    const rows = [
      { label: '營業收入', value: fmt(c.revenue), change: p ? pctChange(c.revenue, p.revenue) : '' },
      { label: '營業成本', value: fmt(-c.cogs), change: '' },
      { label: '毛利', value: fmt(c.grossProfit), change: p ? pctChange(c.grossProfit, p.grossProfit) : '' },
      { label: '營業費用', value: fmt(-c.operatingExpenses), change: '' },
      { label: '折舊', value: fmt(-c.depreciation), change: '' },
      { label: '攤銷', value: fmt(-c.amortization), change: '' },
      { label: '營業利益', value: fmt(c.operatingIncome), change: p ? pctChange(c.operatingIncome, p.operatingIncome) : '' },
      { label: '利息費用', value: fmt(-c.interestExpense), change: '' },
      { label: '所得稅', value: fmt(-c.taxExpense), change: '' },
      { label: '淨利', value: fmt(c.netIncome), change: p ? pctChange(c.netIncome, p.netIncome) : '' },
    ];

    return this.buildFlexTable(
      `📋 損益表`,
      `${year}/${month}${compareLabel ? ` vs ${compareLabel}` : ''}`,
      rows
    );
  }

  async buildBalanceSheetMessage(year, month, compare) {
    const data = await this.reportEngine.getBalanceSheet(year, month);

    return {
      type: 'text',
      text: `🏦 資產負債表 ${year}/${month}\n\n`
        + `資產總計: ${data.summary.totalAssets ? `$${(data.summary.totalAssets / 10000).toFixed(0)}萬` : '—'}\n`
        + `負債總計: ${data.summary.totalLiabilities ? `$${(data.summary.totalLiabilities / 10000).toFixed(0)}萬` : '—'}\n`
        + `股東權益: ${data.summary.equity ? `$${(data.summary.equity / 10000).toFixed(0)}萬` : '—'}\n\n`
        + `💡 完整報表請查看 Web Dashboard`,
    };
  }

  // ===== Flex Message Template =====

  buildFlexTable(title, subtitle, rows) {
    const bodyContents = rows.map(row => ({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: row.label, size: 'xs', color: '#8C8C8C', flex: 3 },
        { type: 'text', text: row.value, size: 'xs', color: '#333333', align: 'end', weight: 'bold', flex: 2 },
        ...(row.change ? [{
          type: 'text',
          text: row.change,
          size: 'xxs',
          color: row.change.includes('↑') ? '#10B981' : row.change.includes('↓') ? '#EF4444' : '#8C8C8C',
          align: 'end',
          flex: 2,
        }] : []),
      ],
      margin: 'md',
    }));

    return {
      type: 'flex',
      altText: title,
      contents: {
        type: 'bubble',
        size: 'giga',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: title, weight: 'bold', size: 'lg', color: '#1a1a2e' },
            { type: 'text', text: subtitle, size: 'xs', color: '#8C8C8C', margin: 'sm' },
          ],
          paddingAll: '20px',
          backgroundColor: '#F8F9FA',
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: bodyContents,
          paddingAll: '20px',
        },
      },
    };
  }
}

module.exports = LineBotService;
