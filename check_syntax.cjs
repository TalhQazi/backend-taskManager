const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      walk(p);
    } else if (p.endsWith('.js')) {
      try {
        cp.execSync('node -c "' + p + '"', {stdio: 'ignore'});
      } catch (e) {
        console.log('SyntaxError:', p);
      }
    }
  }
}

walk('src');
