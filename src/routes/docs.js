// src/routes/docs.js
// 文件下載路由 — 提供 .docx 格式說明書

const express = require('express');
const router = express.Router();
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType } = require('docx');
const fs = require('fs');
const path = require('path');

router.get('/azure-ad-setup-guide.docx', async (req, res) => {
  try {
    const mdPath = path.join(__dirname, '../../docs/azure-ad-setup-guide.md');
    const mdContent = fs.readFileSync(mdPath, 'utf8');

    // Parse markdown and build docx
    const children = [];

    // Title page
    children.push(new Paragraph({ children: [new TextRun({ text: 'Azure AD Application 設定說明書', bold: true, size: 36 })], alignment: AlignmentType.CENTER, spacing: { after: 200 } }));
    children.push(new Paragraph({ children: [new TextRun({ text: 'BC Financial Reporter — Azure Active Directory 應用程式註冊指南', size: 22, color: '666666' })], alignment: AlignmentType.CENTER, spacing: { after: 200 } }));
    children.push(new Paragraph({ children: [new TextRun({ text: `產出日期：${new Date().toLocaleDateString('zh-TW')}`, size: 18, color: '999999' })], alignment: AlignmentType.CENTER, spacing: { after: 400 } }));

    // Parse MD lines
    const lines = mdContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
        children.push(new Paragraph({ text: trimmed.replace('# ', ''), heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }));
      } else if (trimmed.startsWith('## ')) {
        children.push(new Paragraph({ text: trimmed.replace('## ', ''), heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 150 } }));
      } else if (trimmed.startsWith('### ')) {
        children.push(new Paragraph({ text: trimmed.replace('### ', ''), heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 } }));
      } else if (trimmed.startsWith('```')) {
        // Skip code blocks markers
        continue;
      } else if (trimmed.startsWith('- [ ] ') || trimmed.startsWith('- [x] ')) {
        const checked = trimmed.startsWith('- [x] ');
        const text = trimmed.replace(/^- \[.\] /, '');
        children.push(new Paragraph({
          children: [new TextRun({ text: (checked ? '☑ ' : '☐ ') + cleanMd(text), size: 20 })],
          spacing: { before: 40 },
          indent: { left: trimmed.startsWith('  ') ? 720 : 360 },
        }));
      } else if (trimmed.startsWith('- ')) {
        children.push(new Paragraph({
          children: [new TextRun({ text: '• ' + cleanMd(trimmed.replace('- ', '')), size: 20 })],
          spacing: { before: 40 },
          indent: { left: 360 },
        }));
      } else if (trimmed.startsWith('> ')) {
        children.push(new Paragraph({
          children: [new TextRun({ text: cleanMd(trimmed.replace('> ', '')), size: 20, italics: true, color: '666666' })],
          spacing: { before: 80, after: 80 },
          indent: { left: 360 },
        }));
      } else if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        // Simple table row — skip separator rows
        if (trimmed.includes('---')) continue;
        const cells = trimmed.split('|').filter(c => c.trim()).map(c => c.trim());
        if (cells.length >= 2) {
          children.push(new Paragraph({
            children: cells.map((c, i) => new TextRun({
              text: cleanMd(c) + (i < cells.length - 1 ? '  |  ' : ''),
              size: 18,
              bold: i === 0,
            })),
            spacing: { before: 40 },
            indent: { left: 200 },
          }));
        }
      } else if (trimmed === '' || trimmed === '---') {
        children.push(new Paragraph({ text: '', spacing: { before: 100 } }));
      } else if (trimmed.length > 0) {
        children.push(new Paragraph({
          children: [new TextRun({ text: cleanMd(trimmed), size: 20 })],
          spacing: { before: 60 },
        }));
      }
    }

    const doc = new Document({
      sections: [{ properties: {}, children }],
    });

    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="Azure-AD-Setup-Guide.docx"');
    res.send(buffer);
  } catch (error) {
    console.error('[Docs] DOCX generation error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

function cleanMd(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1');
}

module.exports = router;
