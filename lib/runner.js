// A facade from the tap-parser to the Mocha "Runner" object.
// Note that pass/fail/suite events need to also mock the "Runnable"
// objects (either "Suite" or "Test") since these have functions
// which are called by the formatters.

module.exports = Runner

// relevant events:
//
// start()
//   Start of the top-level test set
//
// end()
//   End of the top-level test set.
//
// fail(test, err)
//   any "not ok" test that is not the trailing test for a suite
//   of >0 test points.
//
// pass(test)
//   any "ok" test point that is not the trailing test for a suite
//   of >0 tests
//
// pending(test)
//   Any "todo" test
//
// suite(suite)
//   A suite is a child test with >0 test points.  This is a little bit
//   tricky, because TAP will provide a "child" event before we know
//   that it's a "suite".  We see the "# Subtest: name" comment as the
//   first thing in the subtest.  Then, when we get our first test point,
//   we know that it's a suite, and can emit the event with the mock suite.
//
// suite end(suite)
//   Emitted when we end the subtest
//
// test(test)
//   Any test point which is not the trailing test for a suite.
//
// test end(test)
//   Emitted immediately after the "test" event because test points are
//   not async in TAP.

var util = require('util')
var Test = require('./test.js')
var Suite = require('./suite.js')
var Writable = require('stream').Writable
var Parser = require('tap-parser')

util.inherits(Runner, Writable)

function Runner (options) {
  if (!(this instanceof Runner))
    return new Runner(options)

  var parser = this.parser = new Parser(options)
  this.startTime = new Date()

  attachEvents(this, parser, 0)
  Writable.call(this, options)
}

Runner.prototype.write = function () {
  if (!this.emittedStart) {
    this.emittedStart = true
    this.emit('start')
  }

  return this.parser.write.apply(this.parser, arguments)
}

Runner.prototype.end = function () {
  return this.parser.end.apply(this.parser, arguments)
}

Parser.prototype.fullTitle = function () {
  if (!this.parent)
    return this.name || ''
  else
    return this.parent.fullTitle() + ' ' + (this.name || '').trim()
}

function attachEvents (runner, parser, level) {
  var events = [
    'version', 'plan', 'assert', 'comment',
    'complete', 'extra', 'bailout'
  ]

  parser.runner = runner

  if (level === 0) {
    parser.on('version', function (v) {
      runner.emit('version', v)
    })
  }

  parser.emittedSuite = false
  parser.didAssert = false
  parser.printed = false
  parser.name = ''
  parser.doingChild = null

  parser.on('finish', function () {
    if (!parser.parent)
      runner.emit('end')
  })

  parser.on('child', function (child) {
    //console.log('>>> child')
    child.parent = parser
    attachEvents(runner, child, level + 1)

    // if we're in a suite, but we haven't emitted it yet, then we
    // know that an assert will follow this child, even if there are
    // no others. That means that we will definitely have a 'suite'
    // event to emit.
    emitSuite(this)

    this.didAssert = true
    this.doingChild = child
  })

  parser.on('comment', function (c) {
    if (!this.printed && c.match(/^# Subtest: /)) {
      c = c.trim().replace(/^# Subtest: /, '')
      this.name = c
    }
  })

  // Just dump all non-parsing stuff to stderr
  parser.on('extra', function (c) {
    process.stderr.write(c)
  })

  parser.on('assert', function (result) {
    emitSuite(this)

    // no need to print the trailing assert for subtests
    // we've already emitted a 'suite end' event for this.
    if (this.doingChild && this.doingChild.didAssert &&
        this.doingChild.name === result.name) {
      this.doingChild = null
      return
    }

    this.didAssert = true
    this.doingChild = null

    emitTest(this, result)
  })

  parser.on('complete', function (results) {
    this.results = results
    if (this.suite)
      runner.emit('suite end', this.suite)
  })

  // proxy all stream events directly
  var streamEvents = [
    'pipe', 'prefinish', 'finish', 'unpipe', 'close'
  ]

  streamEvents.forEach(function (ev) {
    parser.on(ev, function () {
      var args = [ev]
      args.push.apply(args, arguments)
      runner.emit.apply(runner, args)
    })
  })
}

function emitSuite (parser) {
  //console.log('emitSuite', parser.emittedSuite, parser.level, parser.name)
  if (!parser.emittedSuite && parser.name) {
    parser.emittedSuite = true
    var suite = parser.suite = new Suite(parser)
    if (parser.parent && parser.parent.suite)
      parser.parent.suite.suites.push(suite)
    parser.runner.emit('suite', suite)
  }
}

function emitTest (parser, result) {
  var runner = parser.runner
  var test = new Test(result, parser)

  if (parser.suite) {
    //if (test.parent === parser)
    //  test.parent = parser.suite
    parser.suite.tests.push(test)
  }

  runner.emit('test', test)
  if (result.skip || result.todo) {
    runner.emit('pending', test)
  } else if (result.ok) {
    runner.emit('pass', test)
  } else {
    var error = getError(result)
    runner.emit('fail', test, error)
  }
  runner.emit('test end', test)
}

function getError (result) {
  if (result.diag && result.diag.error)
    return result.diag.error

  var err = {
    message: (result.name || '(unnamed error)').replace(/^Error: /, ''),
    toString: function () {
      return 'Error: ' + this.message
    }
  }

  if (result.diag.stack) {
    if (Array.isArray(result.diag.stack)) {
      err.stack = err.toString() + '\n' +
        result.diag.stack.map(function (s) {
          return '    at ' + s
        }).join('\n')
    } else if (typeof result.diag.stack === 'string') {
      err.stack = result.diag.stack
    }
  }

  var hasFound = Object.prototype.hasOwnProperty.call(result, 'found')
  var hasWanted = Object.prototype.hasOwnProperty.call(result, 'wanted')

  if (hasFound)
    err.actual = result.found

  if (hasWanted)
    err.expected = result.wanted

  if (hasFound && hasWanted)
    err.showDiff = true

  return err
}
