const path = require('path');
const fs = require('fs');
const ts = require('typescript');
const vm = require('vm');

function loadTsModule(filePath, cache = new Map()) {
  const resolved = path.resolve(filePath);
  if (cache.has(resolved)) return cache.get(resolved).exports;
  const source = fs.readFileSync(resolved, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: resolved,
  }).outputText;
  const module = { exports: {} };
  cache.set(resolved, module);
  const dirname = path.dirname(resolved);
  const customRequire = (specifier) => {
    if (specifier.startsWith('@/')) {
      return loadTsModule(path.join(process.cwd(), specifier.slice(2)) + '.ts', cache);
    }
    return require(specifier);
  };
  const script = new vm.Script(`(function(require,module,exports,__dirname,__filename){${transpiled}\n})`, { filename: resolved });
  script.runInThisContext()(customRequire, module, module.exports, dirname, resolved);
  return module.exports;
}

const constants = loadTsModule(path.join(process.cwd(), 'lib/schedule/constants.ts'));
const engine = loadTsModule(path.join(process.cwd(), 'lib/schedule/engine.ts'));

let state = JSON.parse(JSON.stringify(constants.defaultScheduleState));
state.year = 2026;
state.month = 4;
state.orders.morning = ['이주원','이지수','박재현','유연경','', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
state.orders.extension = ['반일훈','이현일','조용희','이완근','', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
state.orders.nightWeekday = ['이주원','구본준','이완근','조용희','정철원','황현우','', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
state.orders.evening = ['a','b','c','', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
state.orders.holidayDuty = ['h1','h2','h3','', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
state.orders.jcheck = ['j1','j2','j3','', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];

state = engine.sanitizeScheduleState(state);
state = engine.setMonthStartPointer(state, '2026-04', 'morning', 2); // 박재현
state = engine.setMonthStartPointer(state, '2026-04', 'extension', 1); // 이현일
state = engine.setMonthStartPointer(state, '2026-04', 'nightWeekday', 0); // 이주원

console.log('monthStartNames', state.monthStartNames);
console.log('monthStartPointers', state.monthStartPointers);
const result = engine.generateSchedule(state);
const first = result.state.generated.days[0];
const firstWeekday = result.state.generated.days.find((d) => d.dateKey === '2026-03-30');
console.log('firstDay', first.dateKey, first.assignments['조근'], first.assignments['연장'], first.assignments['야근']);
console.log('2026-03-30', firstWeekday.assignments['조근'], firstWeekday.assignments['연장'], firstWeekday.assignments['야근']);
console.log('first few night weekdays', result.state.generated.days.filter((d)=>!d.isWeekend && !d.isHoliday && d.month===4).slice(0,5).map((d)=>({date:d.dateKey, night:d.assignments['야근'], morning:d.assignments['조근'], ext:d.assignments['연장']})));
