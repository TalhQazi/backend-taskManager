const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, 'src', 'routes');

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;

  // 1. Replace the import statement
  // It might be requireAuth, requireRole, etc.
  // We'll just replace `requireRole` with `requireRole, requireSuperAdmin, requireAdmin, requireManager` if it doesn't already have them.
  if (content.includes('../middleware/auth')) {
    if (!content.includes('requireAdmin')) {
      content = content.replace(
        /const \{([^}]+)\} = require\("\.\.\/middleware\/auth"\);/g,
        (match, p1) => {
          const imports = p1.split(',').map(s => s.trim());
          const newImports = new Set([...imports, 'requireSuperAdmin', 'requireAdmin', 'requireManager']);
          return `const { ${Array.from(newImports).join(', ')} } = require("../middleware/auth");`;
        }
      );
    }
  }

  // 2. Replace the usages
  // Match arrays with varying spaces
  content = content.replace(/requireRole\(\s*\[\s*"super-admin"\s*,\s*"admin"\s*,\s*"manager"\s*\]\s*\)/g, 'requireManager');
  content = content.replace(/requireRole\(\s*\[\s*"admin"\s*,\s*"super-admin"\s*,\s*"manager"\s*\]\s*\)/g, 'requireManager');
  content = content.replace(/requireRole\(\s*\[\s*"manager"\s*,\s*"admin"\s*,\s*"super-admin"\s*\]\s*\)/g, 'requireManager');
  
  content = content.replace(/requireRole\(\s*\[\s*"super-admin"\s*,\s*"admin"\s*\]\s*\)/g, 'requireAdmin');
  content = content.replace(/requireRole\(\s*\[\s*"admin"\s*,\s*"super-admin"\s*\]\s*\)/g, 'requireAdmin');
  
  content = content.replace(/requireRole\(\s*\[\s*"super-admin"\s*\]\s*\)/g, 'requireSuperAdmin');
  
  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${path.basename(filePath)}`);
  }
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walkDir(fullPath);
    } else if (fullPath.endsWith('.js')) {
      processFile(fullPath);
    }
  }
}

walkDir(routesDir);
console.log('Done replacing roles.');
