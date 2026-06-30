const fs = require('fs');
const path = require('path');

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      walk(p);
    } else if (p.endsWith('.js')) {
      let content = fs.readFileSync(p, 'utf8');
      if (content.includes('\\n')) {
         
         let changed = false;
         
         // In JS objects usually we have `,\\n  ` or `: "...",\\n  `
         const regex = /([;},">])\\n(\s+)/g;
         if (regex.test(content)) {
             content = content.replace(regex, '$1\n$2');
             changed = true;
         }

         const regex2 = /""\\n(\s+)/g;
         if (regex2.test(content)) {
             content = content.replace(regex2, '""\n$1');
             changed = true;
         }

         // Look for `,\\n  property:`
         const regex4 = /\\n(\s*[a-zA-Z0-9_]+\s*:)/g; 
         if (regex4.test(content)) {
             content = content.replace(regex4, '\n$1');
             changed = true;
         }
         
         // Look for `)\\n` like after `z.string()`
         const regex5 = /\)\\n(\s*)/g;
         if (regex5.test(content)) {
             content = content.replace(regex5, ')\n$1');
             changed = true;
         }

         if (changed) {
            fs.writeFileSync(p, content);
            console.log("Safely Patched \\n in", p);
         }
      }
    }
  }
}

walk('src');
