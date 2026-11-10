const fs = require('fs');
const path = require('path');
const vm = require('vm');
let ts;
try {
  ts = require('typescript');
} catch {
  ts = require(path.join(__dirname, '../node_modules/typescript'));
}

function makeLoader(stubs = {}) {
  const cache = new Map();

  function resolveTs(request, fromDir) {
    const isRelative = request.startsWith('.') || request.startsWith('/');
    if (!isRelative) return null;
    const base = path.resolve(fromDir, request);
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      path.join(base, 'index.ts'),
      path.join(base, 'index.tsx'),
      path.join(base, 'index.js'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
    return null;
  }

  function evaluate(filePath) {
    if (cache.has(filePath)) return cache.get(filePath).exports;

    const ext = path.extname(filePath);
    if (ext !== '.ts' && ext !== '.tsx') {
      const mod = require(filePath);
      cache.set(filePath, { exports: mod });
      return mod;
    }

    const source = fs.readFileSync(filePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        jsx: ts.JsxEmit.React,
      },
      fileName: filePath,
      reportDiagnostics: false,
    }).outputText;

    const module = { exports: {} };
    cache.set(filePath, module);

    const dirname = path.dirname(filePath);
    const localRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
      const resolved = resolveTs(request, dirname);
      if (resolved && Object.prototype.hasOwnProperty.call(stubs, resolved)) return stubs[resolved];
      if (resolved) return evaluate(resolved);
      return require(request);
    };

    const wrapper = `(function (exports, require, module, __filename, __dirname) { ${transpiled}\n})`;
    const compiled = vm.runInThisContext(wrapper, { filename: filePath });
    compiled(module.exports, localRequire, module, filePath, dirname);
    return module.exports;
  }

  return {
    load: (absoluteFilePath) => evaluate(absoluteFilePath),
  };
}

module.exports = { makeLoader };
