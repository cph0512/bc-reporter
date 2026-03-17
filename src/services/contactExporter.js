// src/services/contactExporter.js
// Export contacts to vCard (.vcf) and CSV formats

/**
 * Generate vCard 3.0 string for a single contact
 */
function toVCard(contact) {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];

  // Name
  const ln = contact.last_name || '';
  const fn = contact.first_name || contact.full_name || '';
  lines.push(`N:${escVCard(ln)};${escVCard(fn)};;;`);
  lines.push(`FN:${escVCard(contact.full_name || `${fn} ${ln}`.trim())}`);

  // Org & Title
  if (contact.company) lines.push(`ORG:${escVCard(contact.company)}`);
  if (contact.job_title) lines.push(`TITLE:${escVCard(contact.job_title)}`);
  if (contact.department) lines.push(`X-DEPARTMENT:${escVCard(contact.department)}`);

  // Emails
  (contact.emails || []).forEach(e => {
    if (e.value) {
      const type = e.is_primary ? 'INTERNET;TYPE=PREF' : 'INTERNET';
      lines.push(`EMAIL;TYPE=${type}:${e.value}`);
    }
  });

  // Phones
  (contact.phones || []).forEach(p => {
    if (p.value) {
      const label = (p.label || '').toUpperCase();
      const type = label === '手機' || label === 'MOBILE' || label === 'CELL' ? 'CELL' :
                   label === '公司' || label === 'WORK' ? 'WORK' : 'VOICE';
      lines.push(`TEL;TYPE=${type}:${p.value}`);
    }
  });

  // Address
  if (contact.address) {
    lines.push(`ADR;TYPE=WORK:;;${escVCard(contact.address)};;;;`);
  }

  // Website
  if (contact.website) lines.push(`URL:${contact.website}`);

  // Notes
  if (contact.notes) lines.push(`NOTE:${escVCard(contact.notes)}`);

  lines.push('END:VCARD');
  return lines.join('\r\n');
}

/**
 * Generate vCard batch (multiple contacts in one .vcf file)
 */
function toVCardBatch(contacts) {
  return contacts.map(c => toVCard(c)).join('\r\n');
}

/**
 * Generate CSV string with UTF-8 BOM for Excel compatibility
 */
function toCSV(contacts, categories = []) {
  const BOM = '\uFEFF';
  const headers = ['全名', '公司', '職稱', '部門', 'Email', '電話', '地址', '網站', '分類', '標籤', '備註', '來源', '建立日期'];

  const catMap = {};
  categories.forEach(c => { catMap[c.id] = c.name; });

  const rows = contacts.map(c => [
    c.full_name || '',
    c.company || '',
    c.job_title || '',
    c.department || '',
    (c.emails || []).map(e => e.value).join('; '),
    (c.phones || []).map(p => p.value).join('; '),
    c.address || '',
    c.website || '',
    catMap[c.category_id] || '',
    (c.tags || []).join(', '),
    c.notes || '',
    c.source_type || '',
    c.created_at ? c.created_at.slice(0, 10) : '',
  ]);

  const csvLines = [headers, ...rows].map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  );

  return BOM + csvLines.join('\r\n');
}

/**
 * Generate Salesforce autofill JavaScript snippet
 */
function toSalesforceScript(contact, options = {}) {
  const fields = {
    lastName: contact.last_name || contact.full_name || '',
    firstName: contact.first_name || '',
    company: contact.company || '',
    title: contact.job_title || '',
    email: (contact.emails || []).find(e => e.is_primary)?.value || (contact.emails || [])[0]?.value || '',
    phone: (contact.phones || []).find(p => p.is_primary)?.value || (contact.phones || [])[0]?.value || '',
    street: contact.address || '',
    description: contact.notes || '',
    website: contact.website || '',
    leadSource: options.lead_source || '',
  };

  return `// Salesforce Auto-Fill Script
// Contact: ${contact.full_name}
// Generated: ${new Date().toISOString()}
(function() {
  function fill(label, value) {
    if (!value) return;
    const inputs = document.querySelectorAll('input, textarea, select');
    for (const el of inputs) {
      const lbl = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').toLowerCase();
      if (lbl.includes(label.toLowerCase())) {
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
  }
  fill('Last Name', ${JSON.stringify(fields.lastName)});
  fill('First Name', ${JSON.stringify(fields.firstName)});
  fill('Company', ${JSON.stringify(fields.company)});
  fill('Title', ${JSON.stringify(fields.title)});
  fill('Email', ${JSON.stringify(fields.email)});
  fill('Phone', ${JSON.stringify(fields.phone)});
  fill('Street', ${JSON.stringify(fields.street)});
  fill('Website', ${JSON.stringify(fields.website)});
  fill('Description', ${JSON.stringify(fields.description)});
  console.log('✅ Auto-fill complete for ${contact.full_name}');
})();`;
}

function escVCard(str) {
  return (str || '').replace(/[\\;,]/g, c => '\\' + c).replace(/\n/g, '\\n');
}

module.exports = { toVCard, toVCardBatch, toCSV, toSalesforceScript };
