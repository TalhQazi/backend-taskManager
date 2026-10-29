const fs = require('fs');

const files = [
  'src/models/LegalCalendar.js',
  'src/models/LegalContact.js',
  'src/models/LegalDeadline.js',
  'src/models/LegalDocument.js',
  'src/models/LegalEvidence.js',
  'src/models/LegalFiling.js',
  'src/models/LegalNote.js',
  'src/models/LegalNotification.js',
  'src/models/LegalReport.js',
  'src/models/LegalTask.js',
  'src/routes/LegalCalendar.js',
  'src/routes/LegalContact.js',
  'src/routes/LegalDeadline.js',
  'src/routes/LegalDocument.js',
  'src/routes/LegalEvidence.js',
  'src/routes/LegalFiling.js',
  'src/routes/LegalNote.js',
  'src/routes/LegalNotification.js',
  'src/routes/LegalReport.js',
  'src/routes/LegalTask.js'
];

for (const p of files) {
  let content = fs.readFileSync(p, 'utf8');
  content = content.replace(/\\n/g, '\n');
  fs.writeFileSync(p, content);
  console.log('Fixed \\n in', p);
}
