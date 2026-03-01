// src/services/bcClient.js
// Business Central API Client — OAuth 2.0 Client Credentials Flow
// 不需要佔用任何 BC 使用者帳號

const axios = require('axios');

class BCClient {
  constructor(config) {
    this.tenantId = config.BC_TENANT_ID;
    this.clientId = config.BC_CLIENT_ID;
    this.clientSecret = config.BC_CLIENT_SECRET;
    this.environment = config.BC_ENVIRONMENT || 'Production';
    this.companyId = config.BC_COMPANY_ID;

    this.baseUrl = `https://api.businesscentral.dynamics.com/v2.0/${this.tenantId}/${this.environment}/api/v2.0`;
    this.financeApiUrl = `https://api.businesscentral.dynamics.com/v2.0/${this.tenantId}/${this.environment}/api/microsoft/reportsFinance/beta`;

    this.token = null;
    this.tokenExpiry = null;
  }

  // ===== Authentication =====

  async getToken() {
    // Reuse token if still valid (with 5 min buffer)
    if (this.token && this.tokenExpiry && Date.now() < this.tokenExpiry - 300000) {
      return this.token;
    }

    const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: 'https://api.businesscentral.dynamics.com/.default',
    });

    try {
      const response = await axios.post(tokenUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      this.token = response.data.access_token;
      this.tokenExpiry = Date.now() + response.data.expires_in * 1000;
      console.log('[BCClient] Token acquired, expires in', response.data.expires_in, 'seconds');
      return this.token;
    } catch (error) {
      console.error('[BCClient] Token acquisition failed:', error.response?.data || error.message);
      throw new Error('Failed to authenticate with Business Central');
    }
  }

  async request(url, params = {}) {
    const token = await this.getToken();

    // Build OData query string
    const queryParts = [];
    if (params.$filter) queryParts.push(`$filter=${params.$filter}`);
    if (params.$select) queryParts.push(`$select=${params.$select}`);
    if (params.$orderby) queryParts.push(`$orderby=${params.$orderby}`);
    if (params.$top) queryParts.push(`$top=${params.$top}`);
    if (params.$skip) queryParts.push(`$skip=${params.$skip}`);
    if (params.$expand) queryParts.push(`$expand=${params.$expand}`);

    const fullUrl = queryParts.length > 0 ? `${url}?${queryParts.join('&')}` : url;

    try {
      const response = await axios.get(fullUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
      return response.data.value || response.data;
    } catch (error) {
      if (error.response?.status === 429) {
        // Rate limited — wait and retry
        const retryAfter = parseInt(error.response.headers['retry-after'] || '5', 10);
        console.warn(`[BCClient] Rate limited, retrying in ${retryAfter}s`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        return this.request(url, params);
      }
      console.error('[BCClient] API request failed:', error.response?.data || error.message);
      throw error;
    }
  }

  // ===== Standard API v2.0 Endpoints =====

  companyUrl(endpoint) {
    return `${this.baseUrl}/companies(${this.companyId})/${endpoint}`;
  }

  financeUrl(endpoint) {
    return `${this.financeApiUrl}/companies(${this.companyId})/${endpoint}`;
  }

  /**
   * 損益表 (Income Statement)
   * @param {string} dateFilter - e.g. '2025-01-01..2025-01-31' or '2025-01-01..2025-12-31'
   */
  async getIncomeStatement(dateFilter) {
    return this.request(this.companyUrl('incomeStatement'), {
      $filter: dateFilter ? `dateFilter eq '${dateFilter}'` : undefined,
    });
  }

  /**
   * 資產負債表 (Balance Sheet)
   * @param {string} dateFilter - e.g. '..2025-03-31' (up to a date)
   */
  async getBalanceSheet(dateFilter) {
    return this.request(this.companyUrl('balanceSheet'), {
      $filter: dateFilter ? `dateFilter eq '${dateFilter}'` : undefined,
    });
  }

  /**
   * 試算表 (Trial Balance)
   */
  async getTrialBalance(dateFilter) {
    return this.request(this.companyUrl('trialBalance'), {
      $filter: dateFilter ? `dateFilter eq '${dateFilter}'` : undefined,
    });
  }

  /**
   * 總帳分錄 (General Ledger Entries)
   * For detailed EBITDA calculation
   */
  async getGeneralLedgerEntries(startDate, endDate, options = {}) {
    const filters = [];
    if (startDate) filters.push(`postingDate ge ${startDate}`);
    if (endDate) filters.push(`postingDate le ${endDate}`);
    if (options.accountNumber) filters.push(`accountNumber eq '${options.accountNumber}'`);

    return this.request(this.companyUrl('generalLedgerEntries'), {
      $filter: filters.length > 0 ? filters.join(' and ') : undefined,
      $orderby: 'postingDate desc',
      $top: options.top || 5000,
    });
  }

  /**
   * 會計科目表 (Chart of Accounts)
   */
  async getAccounts() {
    return this.request(this.companyUrl('accounts'), {
      $select: 'id,number,displayName,category,subCategory,blocked',
      $filter: "blocked eq false",
    });
  }

  // ===== Advanced Finance APIs (reportsFinance/beta) =====

  /**
   * GL Entries with dimensions — for more granular reporting
   */
  async getGLEntriesWithDimensions(startDate, endDate) {
    return this.request(this.financeUrl('generalLedgerEntries'), {
      $filter: `postingDate ge ${startDate} and postingDate le ${endDate}`,
    });
  }

  /**
   * GL Budgets
   */
  async getGLBudgets() {
    return this.request(this.financeUrl('generalLedgerBudgets'));
  }

  // ===== Helper Methods =====

  /**
   * 取得指定月份的日期範圍
   */
  static getMonthRange(year, month) {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
    return { start, end, filter: `${start}..${end}` };
  }

  /**
   * 取得到指定月底的日期（資產負債表用）
   */
  static getEndOfMonth(year, month) {
    const lastDay = new Date(year, month, 0).getDate();
    return `..${year}-${String(month).padStart(2, '0')}-${lastDay}`;
  }
}

module.exports = BCClient;
