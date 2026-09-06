/* Shared harness of the model tests: assert(cond, msg) prints PASS or FAIL and counts, near(a, b, tol) compares
   numbers, summary(name) prints "<name>: N passed, M failed" and throws when anything failed, which gives the
   engine a non-zero exit status (tests/run.sh collects them). Load it first: load('tests/harness.js'). Any
   engine with load() and print() works; the tests use JavaScriptCore's jsc. */
var passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) passed++; else failed++;
  print((cond ? 'PASS ' : 'FAIL ') + msg);
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }
function summary(name) {
  print(name + ': ' + passed + ' passed, ' + failed + ' failed');
  if (failed) throw new Error(name + ': ' + failed + ' test(s) failed');
}
