// minimal mock of the mocha Test class for formatters

module.exports = Test

function Test (result, parent) {
  this.result = result
  this._slow = 75
  this.duration = result.time
  this.title = result.name
  Object.defineProperty(this, 'parent', {
    value: parent,
    writable: true,
    configurable: true,
    enumerable: false
  })
}

Test.prototype.fullTitle = function () {
  return (this.parent.fullTitle() + ' ' + (this.title || '')).trim()
}

Test.prototype.slow = function (ms){
  return 75
}

Test.prototype.fn = {
  toString: 'function () {}'
}