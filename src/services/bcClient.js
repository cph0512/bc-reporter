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

    this.token = null;
    this.tokenExpiry = null;
    this._accountsCache = new Map(); // keyed by companyId
  }

  // ===== Authentication =====

  async getToken() {
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
        const retryAfter = parseInt(error.response.headers['retry-after'] || '5', 10);
        console.warn(`[BCClient] Rate limited, retrying in ${retryAfter}s`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        return this.request(url, params);
      }
      throw error;
    }
  }

  /**
   * 分頁查詢所有資料（處理 @odata.nextLink）
   */
  async requestAll(url, params = {}) {
    const token = await this.getToken();

    const queryParts = [];
    if (params.$filter) queryParts.push(`$filter=${params.$filter}`);
    if (params.$select) queryParts.push(`$select=${params.$select}`);
    if (params.$orderby) queryParts.push(`$orderby=${params.$orderby}`);
    if (params.$expand) queryParts.push(`$expand=${params.$expand}`);

    let fullUrl = queryParts.length > 0 ? `${url}?${queryParts.join('&')}` : url;
    let allResults = [];

    while (fullUrl) {
      const response = await axios.get(fullUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
      const data = response.data;
      allResults = allResults.concat(data.value || []);
      fullUrl = data['@odata.nextLink'] || null;
    }

    console.log(`[BCClient] requestAll fetched ${allResults.length} records`);
    return allResults;
  }

  // ===== Standard API v2.0 Endpoints =====

  companyUrl(endpoint, companyId) {
    const cid = companyId || this.companyId;
    return `${this.baseUrl}/companies(${cid})/${endpoint}`;
  }

  /**
   * 損益表 — 先嘗試標準 API，失敗則用 GL Entries 建構
   */
  async getIncomeStatement(dateFilter, options = {}) {
    try {
      return await this.request(this.companyUrl('incomeStatement', options.companyId), {
        $filter: dateFilter ? `dateFilter eq '${dateFilter}'` : undefined,
      });
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('[BCClient] incomeStatement API not available, building from GL entries');
        return null; // reportEngine will handle fallback
      }
      throw error;
    }
  }

  /**
   * 資產負債表 — 先嘗試標準 API，失敗則用 GL Entries 建構
   */
  async getBalanceSheet(dateFilter, options = {}) {
    try {
      return await this.request(this.companyUrl('balanceSheet', options.companyId), {
        $filter: dateFilter ? `dateFilter eq '${dateFilter}'` : undefined,
      });
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('[BCClient] balanceSheet API not available, building from GL entries');
        return null;
      }
      throw error;
    }
  }

  /**
   * 總帳分錄 (General Ledger Entries)
   * options.accountNumber — 單一科目篩選
   * options.accountNumbers — 多科目篩選 (陣列)
   */
  async getGeneralLedgerEntries(startDate, endDate, options = {}) {
    const filters = [];
    if (startDate) filters.push(`postingDate ge ${startDate}`);
    if (endDate) filters.push(`postingDate le ${endDate}`);
    if (options.accountNumber) filters.push(`accountNumber eq '${options.accountNumber}'`);
    if (options.accountNumbers?.length > 0) {
      const acctFilter = options.accountNumbers.map(n => `accountNumber eq '${n}'`).join(' or ');
      filters.push(`(${acctFilter})`);
    }

    if (options.fetchAll) {
      return this.requestAll(this.companyUrl('generalLedgerEntries', options.companyId), {
        $filter: filters.length > 0 ? filters.join(' and ') : undefined,
        $orderby: 'entryNumber asc',
        $expand: options.expand || undefined,
      });
    }

    return this.request(this.companyUrl('generalLedgerEntries', options.companyId), {
      $filter: filters.length > 0 ? filters.join(' and ') : undefined,
      $orderby: 'postingDate desc',
      $top: options.top || 5000,
      $expand: options.expand || undefined,
    });
  }

  /**
   * 會計科目表 (Chart of Accounts) — 含快取
   */
  async getAccounts(options = {}) {
    const cid = options.companyId || this.companyId;
    if (this._accountsCache.has(cid)) return this._accountsCache.get(cid);

    const accounts = await this.request(this.companyUrl('accounts', cid), {
      $select: 'id,number,displayName,category,subCategory,blocked,accountType',
      $filter: "blocked eq false",
    });
    this._accountsCache.set(cid, accounts);
    return accounts;
  }

  /**
   * 建構帳戶分類 Map（accountNumber → category info）
   */
  async getAccountsMap(options = {}) {
    const accounts = await this.getAccounts(options);
    const map = {};
    for (const a of accounts) {
      map[a.number] = {
        displayName: a.displayName,
        category: a.category,
        subCategory: a.subCategory || '',
        accountType: a.accountType,
      };
    }
    return map;
  }

  /**
   * 客戶列表 (Customers) — Top 5 + AR
   */
  async getCustomers(options = {}) {
    try {
      const customers = await this.requestAll(this.companyUrl('customers', options.companyId), {
        $select: 'id,number,displayName,balanceDue',
      });
      return (customers || []).map(c => ({
        ...c,
        balance: c.balance ?? c.balanceDue ?? 0,
      }));
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('[BCClient] customers API not available');
        return null;
      }
      throw error;
    }
  }

  /**
   * 供應商列表 (Vendors) — Top 5 + AP
   */
  async getVendors(options = {}) {
    try {
      return await this.requestAll(this.companyUrl('vendors', options.companyId), {
        $select: 'id,number,displayName,balance',
      });
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('[BCClient] vendors API not available');
        return null;
      }
      throw error;
    }
  }

  // ===== Sales & Purchasing Endpoints =====

  /**
   * 銷售發票 (Sales Invoices)
   */
  async getSalesInvoices(startDate, endDate, options = {}) {
    try {
      const filters = [];
      if (startDate) filters.push(`postingDate ge ${startDate}`);
      if (endDate) filters.push(`postingDate le ${endDate}`);

      return await this.requestAll(
        this.companyUrl('salesInvoices', options.companyId),
        {
          $filter: filters.length > 0 ? filters.join(' and ') : undefined,
          $select: 'id,number,invoiceDate,postingDate,customerNumber,customerName,totalAmountExcludingTax,totalTaxAmount,totalAmountIncludingTax,salespersonCode,status',
        }
      );
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('[BCClient] salesInvoices API not available');
        return null;
      }
      throw error;
    }
  }

  /**
   * 銷售發票含明細 (Sales Invoices with Lines via $expand)
   * 用於品項分析，某些 BC 租戶不支援 $expand
   */
  async getSalesInvoicesWithLines(startDate, endDate, options = {}) {
    try {
      const filters = [];
      if (startDate) filters.push(`postingDate ge ${startDate}`);
      if (endDate) filters.push(`postingDate le ${endDate}`);

      return await this.requestAll(
        this.companyUrl('salesInvoices', options.companyId),
        {
          $filter: filters.length > 0 ? filters.join(' and ') : undefined,
          $select: 'id,number,postingDate,customerNumber,customerName,totalAmountExcludingTax,salespersonCode',
          $expand: 'salesInvoiceLines($select=lineType,lineObjectNumber,description,quantity,unitPrice,netAmount)',
        }
      );
    } catch (error) {
      if (error.response?.status === 404 || error.response?.status === 400) {
        console.log('[BCClient] salesInvoices with $expand not available');
        return null;
      }
      throw error;
    }
  }

  /**
   * 採購發票 (Purchase Invoices)
   */
  async getPurchaseInvoices(startDate, endDate, options = {}) {
    try {
      const filters = [];
      if (startDate) filters.push(`invoiceDate ge ${startDate}`);
      if (endDate) filters.push(`invoiceDate le ${endDate}`);

      return await this.requestAll(
        this.companyUrl('purchaseInvoices', options.companyId),
        {
          $filter: filters.length > 0 ? filters.join(' and ') : undefined,
          $select: 'id,number,invoiceDate,vendorNumber,vendorName,totalAmountExcludingTax,purchaser',
        }
      );
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('[BCClient] purchaseInvoices API not available');
        return null;
      }
      throw error;
    }
  }

  /**
   * 未結採購訂單 (Purchase Orders — Open status)
   */
  async getPurchaseOrders(options = {}) {
    try {
      return await this.requestAll(
        this.companyUrl('purchaseOrders', options.companyId),
        {
          $select: 'id,number,orderDate,vendorNumber,vendorName,status,totalAmountExcludingTax',
          $filter: "status eq 'Open'",
        }
      );
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('[BCClient] purchaseOrders API not available');
        return null;
      }
      throw error;
    }
  }

  // ===== Ledger / Audit Read-Only Endpoints =====

  /**
   * 試算表 (Trial Balance) — 唯讀
   */
  async getTrialBalance(dateFilter, options = {}) {
    try {
      const result = await this.request(this.companyUrl('trialBalance', options.companyId), {
        $filter: dateFilter ? `dateFilter eq '${dateFilter}'` : undefined,
      });
      if (result && result.length > 0) return result;
    } catch (error) {
      if (error.response?.status !== 404) throw error;
      console.log('[BCClient] trialBalance API not available, building from GL entries');
    }

    // Fallback: build trial balance from GL entries
    try {
      let startDate, endDate;
      if (dateFilter && dateFilter.includes('..')) {
        [startDate, endDate] = dateFilter.split('..');
      }

      // Fetch period entries (for netChange within the selected range)
      const periodEntries = await this.getGeneralLedgerEntries(startDate, endDate, {
        ...options, fetchAll: true,
      });
      if (!periodEntries || !periodEntries.length) return [];

      // Fetch cumulative entries (for balance: all entries up to endDate)
      // If no date filter, balance = netChange (all-time totals are the same)
      let balanceEntries = periodEntries;
      if (startDate && endDate) {
        try {
          balanceEntries = await this.getGeneralLedgerEntries(null, endDate, {
            ...options, fetchAll: true,
          });
        } catch {
          balanceEntries = periodEntries; // fallback: use period entries
        }
      }

      // Also get chart of accounts for display names and categories
      let accountMap = {};
      try {
        const accounts = await this.getAccounts(options);
        if (accounts) accounts.forEach(a => { accountMap[a.number] = a; });
      } catch {}

      // Aggregate netChange from period entries
      const agg = {};
      periodEntries.forEach(e => {
        const num = e.accountNumber || '';
        if (!agg[num]) {
          const acct = accountMap[num] || {};
          agg[num] = {
            number: num,
            displayName: acct.displayName || e.accountName || num,
            accountCategory: acct.category || '',
            netChange: 0,
            balance: 0,
          };
        }
        agg[num].netChange += (e.debitAmount || 0) - (e.creditAmount || 0);
      });

      // Aggregate balance from cumulative entries (up to endDate)
      balanceEntries.forEach(e => {
        const num = e.accountNumber || '';
        if (!agg[num]) {
          const acct = accountMap[num] || {};
          agg[num] = {
            number: num,
            displayName: acct.displayName || e.accountName || num,
            accountCategory: acct.category || '',
            netChange: 0,
            balance: 0,
          };
        }
        agg[num].balance += (e.debitAmount || 0) - (e.creditAmount || 0);
      });

      // Sort by account number
      return Object.values(agg).sort((a, b) => a.number.localeCompare(b.number));
    } catch (fallbackErr) {
      console.error('[BCClient] Trial balance fallback failed:', fallbackErr.message);
      return [];
    }
  }

  /**
   * 日記帳列表 (Journals) — 唯讀
   */
  async getJournals(options = {}) {
    try {
      return await this.request(this.companyUrl('journals', options.companyId), {
        $select: 'id,code,displayName,balancingAccountNumber,lastModifiedDateTime',
      });
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('[BCClient] journals API not available');
        return null;
      }
      throw error;
    }
  }

  /**
   * 日記帳明細行 (Journal Lines) — 唯讀
   */
  async getJournalLines(journalId, options = {}) {
    try {
      return await this.requestAll(
        this.companyUrl(`journals(${journalId})/journalLines`, options.companyId),
        {
          $select: 'id,journalDisplayName,lineNumber,accountId,accountNumber,postingDate,documentNumber,externalDocumentNumber,amount,description,comment,lastModifiedDateTime',
        }
      );
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('[BCClient] journalLines API not available');
        return null;
      }
      throw error;
    }
  }

  /**
   * 客戶付款日記帳 (Customer Payment Journals) — 唯讀
   */
  async getCustomerPaymentJournals(options = {}) {
    try {
      return await this.request(this.companyUrl('customerPaymentJournals', options.companyId), {
        $select: 'id,code,displayName,balancingAccountNumber,lastModifiedDateTime',
      });
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('[BCClient] customerPaymentJournals API not available');
        return null;
      }
      throw error;
    }
  }

  /**
   * 供應商付款日記帳 (Vendor Payment Journals) — 唯讀
   */
  async getVendorPaymentJournals(options = {}) {
    try {
      return await this.request(this.companyUrl('vendorPaymentJournals', options.companyId), {
        $select: 'id,code,displayName,balancingAccountNumber,lastModifiedDateTime',
      });
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('[BCClient] vendorPaymentJournals API not available');
        return null;
      }
      throw error;
    }
  }

  /**
   * 品項分類帳 (Item Ledger Entries) — 唯讀
   */
  async getItemLedgerEntries(startDate, endDate, options = {}) {
    try {
      const filters = [];
      if (startDate) filters.push(`postingDate ge ${startDate}`);
      if (endDate) filters.push(`postingDate le ${endDate}`);

      return await this.requestAll(
        this.companyUrl('itemLedgerEntries', options.companyId),
        {
          $filter: filters.length > 0 ? filters.join(' and ') : undefined,
        }
      );
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('[BCClient] itemLedgerEntries API not available');
        return null;
      }
      throw error;
    }
  }

  // ===== Helper Methods =====

  static getMonthRange(year, month) {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
    return { start, end, filter: `${start}..${end}` };
  }

  static getEndOfMonth(year, month) {
    const lastDay = new Date(year, month, 0).getDate();
    return `..${year}-${String(month).padStart(2, '0')}-${lastDay}`;
  }
}

module.exports = BCClient;
