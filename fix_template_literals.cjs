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
      let changed = false;
      
      // Replace \` with `
      if (content.includes('\\`')) {
          content = content.replace(/\\`/g, '`');
          changed = true;
      }
      
      // Replace \$ with $
      if (content.includes('\\$')) {
          content = content.replace(/\\\$/g, '$');
          changed = true;
      }

      if (changed) {
          fs.writeFileSync(p, content);
          console.log("Patched", p);
      }
    }
  }
}

walk('src');
