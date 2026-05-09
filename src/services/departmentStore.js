// src/services/departmentStore.js
// Company-scoped department master data.

const fs = require('fs');
const path = require('path');
const { resolveDataFile } = require('./dataDir');

const DEPARTMENTS_FILE = resolveDataFile('departments.json');

const DEFAULT_DEPARTMENTS = ['業務部', '財務部', '管理部', '營運部', '物流部', '客服部', '採購部', '資訊部'];

function readData() {
  try {
    if (!fs.existsSync(DEPARTMENTS_FILE)) return { departments: [] };
    const raw = JSON.parse(fs.readFileSync(DEPARTMENTS_FILE, 'utf8'));
    return { departments: Array.isArray(raw.departments) ? raw.departments : [] };
  } catch {
    return { departments: [] };
  }
}

function writeData(data) {
  const dir = path.dirname(DEPARTMENTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DEPARTMENTS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function cleanText(value) {
  return String(value || '').trim();
}

function uniqueNames(names) {
  return [...new Set(names.map(cleanText).filter(Boolean))];
}

const departmentStore = {
  getRawData() {
    return readData();
  },

  listItems(companyId, { includeInactive = true } = {}) {
    const cid = cleanText(companyId);
    return readData().departments
      .filter(d => (!cid || d.companyId === cid) && (includeInactive || d.active !== false))
      .map(d => ({
        companyId: cleanText(d.companyId),
        name: cleanText(d.name),
        active: d.active !== false,
      }))
      .filter(d => d.companyId && d.name)
      .sort((a, b) => `${a.companyId}:${a.name}`.localeCompare(`${b.companyId}:${b.name}`, 'zh-Hant'));
  },

  list(companyId, { includeInactive = false } = {}) {
    const cid = cleanText(companyId);
    const data = readData();
    const names = data.departments
      .filter(d => (!cid || d.companyId === cid) && (includeInactive || d.active !== false))
      .map(d => d.name);
    if (!data.departments.length) return DEFAULT_DEPARTMENTS;
    return uniqueNames(names);
  },

  ensure(companyId, name) {
    const cid = cleanText(companyId);
    const deptName = cleanText(name);
    if (!cid || !deptName) return null;
    const data = readData();
    const existing = data.departments.find(d => d.companyId === cid && d.name === deptName);
    if (existing) {
      if (existing.active === false) existing.active = true;
      writeData(data);
      return existing;
    }
    const item = { companyId: cid, name: deptName, active: true };
    data.departments.push(item);
    writeData(data);
    return item;
  },

  create(companyId, name) {
    const cid = cleanText(companyId);
    const deptName = cleanText(name);
    if (!cid) throw new Error('公司為必填');
    if (!deptName) throw new Error('部門名稱為必填');

    const data = readData();
    const existing = data.departments.find(d => d.companyId === cid && d.name === deptName);
    if (existing) throw new Error('此公司已存在相同部門');

    const item = { companyId: cid, name: deptName, active: true };
    data.departments.push(item);
    writeData(data);
    return item;
  },

  update(companyId, originalName, fields = {}) {
    const cid = cleanText(companyId);
    const oldName = cleanText(originalName);
    if (!cid || !oldName) throw new Error('缺少部門識別資料');

    const data = readData();
    const item = data.departments.find(d => d.companyId === cid && d.name === oldName);
    if (!item) throw new Error('Department not found');

    const newName = cleanText(fields.name !== undefined ? fields.name : item.name);
    if (!newName) throw new Error('部門名稱為必填');
    const duplicate = data.departments.find(d => d.companyId === cid && d.name === newName && d !== item);
    if (duplicate) throw new Error('此公司已存在相同部門');

    item.name = newName;
    if (fields.active !== undefined) item.active = Boolean(fields.active);
    writeData(data);
    return { companyId: cid, name: item.name, active: item.active !== false, oldName };
  },

  delete(companyId, name) {
    const cid = cleanText(companyId);
    const deptName = cleanText(name);
    if (!cid || !deptName) throw new Error('缺少部門識別資料');

    const data = readData();
    const idx = data.departments.findIndex(d => d.companyId === cid && d.name === deptName);
    if (idx === -1) throw new Error('Department not found');
    const [removed] = data.departments.splice(idx, 1);
    writeData(data);
    return removed;
  },
};

module.exports = departmentStore;
