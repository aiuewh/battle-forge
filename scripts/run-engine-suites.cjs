// Run the existing TS behavior suites with the installed compiler, without Bun.
const fs=require('fs');const path=require('path');const Module=require('module');const ts=require('typescript');
const root=path.resolve(__dirname,'..');const resolve=Module._resolveFilename;
Module._resolveFilename=function(name,...args){return resolve.call(this,name.startsWith('@/')?path.join(root,'src',name.slice(2)):name,...args);};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const allowed=['engine-tests','adversarial-tests','semantics-tests'];
if(!allowed.includes(process.argv[2]))throw Error('Choose a known engine suite');
require('./'+process.argv[2]+'.ts');
