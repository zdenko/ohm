// --------------------------------------------------------------------
// Imports
// --------------------------------------------------------------------

var common = require('./common.js');
var errors = require('./errors.js');
var nodes = require('./nodes.js');
var pexprs = require('./pexprs.js');
var InputStream = require('./InputStream.js');

var awlib = require('awlib');
var browser = awlib.browser;

// --------------------------------------------------------------------
// Operations
// --------------------------------------------------------------------

pexprs.PExpr.prototype.eval = common.abstract;

pexprs.anything.eval = function(recordFailures, syntactic, grammar, inputStream, bindings) {
  if (syntactic) {
    grammar.skipSpaces(inputStream);
  }
  var origPos = inputStream.pos;
  var value = inputStream.next();
  if (value === common.fail) {
    if (recordFailures) {
      inputStream.recordFailure(origPos, this);
    }
    return false;
  } else {
    bindings.push(new nodes.ValueNode(value, inputStream.intervalFrom(origPos)));
    return true;
  }
};

pexprs.end.eval = function(recordFailures, syntactic, grammar, inputStream, bindings) {
  if (syntactic) {
    grammar.skipSpaces(inputStream);
  }
  if (inputStream.atEnd()) {
    bindings.push(new nodes.ValueNode(undefined, inputStream.intervalFrom(inputStream.pos)));
    return true;
  } else {
    if (recordFailures) {
      inputStream.recordFailure(inputStream.pos, this);
    }
    return false;
  }
};

pexprs.fail.eval = function(recordFailures, syntactic, grammar, inputStream, bindings) {
  if (recordFailures) {
    inputStream.recordFailure(inputStream.pos, this);
  }
  return false;
};

pexprs.Prim.prototype.eval = function(recordFailures, syntactic, grammar, inputStream, bindings) {
  if (syntactic) {
    grammar.skipSpaces(inputStream);
  }
  var origPos = inputStream.pos;
  if (this.match(inputStream) === common.fail) {
    if (recordFailures) {
      inputStream.recordFailure(origPos, this);
    }
    return false;
  } else {
    bindings.push(new nodes.ValueNode(this.obj, inputStream.intervalFrom(origPos)));
    return true;
  }
};

pexprs.Prim.prototype.match = function(inputStream) {
  return inputStream.matchExactly(this.obj);
};

pexprs.StringPrim.prototype.match = function(inputStream) {
  return inputStream.matchString(this.obj);
};

pexprs.RegExpPrim.prototype.eval = function(recordFailures, syntactic, grammar, inputStream, bindings) {
  if (syntactic) {
    grammar.skipSpaces(inputStream);
  }
  var origPos = inputStream.pos;
  if (inputStream.matchRegExp(this.obj) === common.fail) {
    if (recordFailures) {
      inputStream.recordFailure(origPos, this);
    }
    return false;
  } else {
    bindings.push(new nodes.ValueNode(inputStream.source[origPos], inputStream.intervalFrom(origPos)));
    return true;
  }
};

pexprs.Alt.prototype.eval = function(recordFailures, syntactic, grammar, inputStream, bindings) {
  var origPos = inputStream.pos;
  var origNumBindings = bindings.length;
  for (var idx = 0; idx < this.terms.length; idx++) {
    if (syntactic) {
      grammar.skipSpaces(inputStream);
    }
    if (this.terms[idx].eval(recordFailures, syntactic, grammar, inputStream, bindings)) {
      return true;
    } else {
      inputStream.pos = origPos;
      // Note: while the following assignment could be done unconditionally, only doing it when necessary is
      // better for performance. This is b/c assigning to an array's length property is more expensive than a
      // typical assignment.
      if (bindings.length > origNumBindings) {
        bindings.length = origNumBindings;
      }
    }
  }
  return false;
};

pexprs.Seq.prototype.eval = function(recordFailures, syntactic, grammar, inputStream, bindings) {
  if (syntactic) {
    grammar.skipSpaces(inputStream);
  }
  var origPos = inputStream.pos;
  for (var idx = 0; idx < this.factors.length; idx++) {
    if (idx > 0 && syntactic) {
      grammar.skipSpaces(inputStream);
    }
    var factor = this.factors[idx];
    if (!factor.eval(recordFailures, syntactic, grammar, inputStream, bindings)) {
      return false;
    }
  }
  return true;
};

pexprs.Many.prototype.eval = function(recordFailures, syntactic, grammar, inputStream, bindings) {
  var arity = this.getArity();
  if (arity === 0) {
    // TODO: make this a static check w/ a nice error message, then remove the dynamic check.
    // cf. pexprs-check.js for Many
    throw 'fix me!';
  }

  var columns = common.repeatFn(function() { return []; }, arity);
  var numMatches = 0;
  var origPos = inputStream.pos;
  while (true) {
    var backtrackPos = inputStream.pos;
    var row = [];
    if (syntactic) {
      grammar.skipSpaces(inputStream);
    }
    if (!this.expr.eval(recordFailures, syntactic, grammar, inputStream, row)) {
      inputStream.pos = backtrackPos;
      break;
    } else {
      numMatches++;
      for (var idx = 0; idx < row.length; idx++) {
        columns[idx].push(row[idx]);
      }
    }
  }
  if (numMatches < this.minNumMatches) {
    return false;
  } else {
    for (var idx = 0; idx < columns.length; idx++) {
      bindings.push(new nodes.ListNode(columns[idx], inputStream.intervalFrom(origPos)));
    }
    return true;
  }
};

pexprs.Opt.prototype.eval = function(recordFailures, syntactic, grammar, inputStream, bindings) {
  var origPos = inputStream.pos;
  var row = [];
  var arity = this.getArity();
  if (!this.expr.eval(recordFailures, syntactic, grammar, inputStream, row)) {
    inputStream.pos = origPos;
    row = common.repeat(new nodes.ValueNode(undefined, inputStream.intervalFrom(origPos)), arity);
  }
  for (var idx = 0; idx < arity; idx++) {
    bindings.push(row[idx]);
  }
  return true;
};

pexprs.Not.prototype.eval = function(recordFailures, syntactic, grammar, inputStream, bindings) {
  var origPos = inputStream.pos;
  if (this.expr.eval(false, syntactic, grammar, inputStream, [])) {
    if (recordFailures) {
      inputStream.recordFailure(origPos, this);
    }
    return false;
  } else {
    inputStream.pos = origPos;
    return true;
  }
};

pexprs.Lookahead.prototype.eval = function(recordFailures, syntactic, grammar, inputStream, bindings) {
  var origPos = inputStream.pos;
  if (this.expr.eval(recordFailures, syntactic, grammar, inputStream, bindings)) {
    inputStream.pos = origPos;
    return true;
  } else {
    return false;
  }
};

pexprs.Listy.prototype.eval = function(recordFailures, syntactic, grammar, inputStream, bindings) {
  if (syntactic) {
    grammar.skipSpaces(inputStream);
  }
  var obj = inputStream.next();
  if (obj instanceof Array || typeof obj === 'string') {
    var objInputStream = InputStream.newFor(obj);
    return this.expr.eval(recordFailures, syntactic, grammar, objInputStream, bindings) && objInputStream.atEnd();
  } else {
    return false;
  }
};

pexprs.Obj.prototype.eval = function(recordFailures, syntactic, grammar, inputStream, bindings) {
  var origPos = inputStream.pos;
  if (syntactic) {
    grammar.skipSpaces(inputStream);
  }
  var obj = inputStream.next();
  if (obj !== common.fail && obj && (typeof obj === 'object' || typeof obj === 'function')) {
    var numOwnPropertiesMatched = 0;
    for (var idx = 0; idx < this.properties.length; idx++) {
      var property = this.properties[idx];
      if (!obj.hasOwnProperty(property.name)) {
        return false;
      }
      var value = obj[property.name];
      var valueInputStream = InputStream.newFor([value]);
      var matched =
          property.pattern.eval(recordFailures, syntactic, grammar, valueInputStream, bindings) &&
          valueInputStream.atEnd();
      if (!matched) {
        return false;
      }
      numOwnPropertiesMatched++;
    }
    if (this.isLenient) {
      var remainder = {};
      for (var p in obj) {
        if (obj.hasOwnProperty(p) && this.properties.indexOf(p) < 0) {
          remainder[p] = obj[p];
        }
      }
      bindings.push(new nodes.ValueNode(remainder, inputStream.intervalFrom(origPos)));
      return true;
    } else {
      return numOwnPropertiesMatched === Object.keys(obj).length;
    }
  } else {
    return false;
  }
};

pexprs.Apply.prototype.eval = function(recordFailures, syntactic, grammar, inputStream, bindings) {
  function useMemoizedResult(memoRecOrLR) {
    inputStream.pos = memoRecOrLR.pos;
    if (memoRecOrLR.value) {
      bindings.push(memoRecOrLR.value);
      return true;
    } else {
      return false;
    }
  }

  var ruleName = this.ruleName;
  var origPosInfo = inputStream.getCurrentPosInfo();

  var memoRec = origPosInfo.memo[ruleName];
  if (memoRec && origPosInfo.shouldUseMemoizedResult(memoRec)) {
    return useMemoizedResult(memoRec);
  } else if (origPosInfo.isActive(ruleName)) {
    var currentLR = origPosInfo.getCurrentLeftRecursion();
    if (currentLR && currentLR.name === ruleName) {
      origPosInfo.updateInvolvedRules();
      return useMemoizedResult(currentLR);
    } else {
      origPosInfo.startLeftRecursion(ruleName);
      return false;
    }
  } else {
    var body = grammar.ruleDict[ruleName];
    if (!body) {
      throw new errors.UndeclaredRule(ruleName);
    }
    var origPos = inputStream.pos;
    origPosInfo.enter(ruleName);
    var rf = recordFailures && !body.description;
    var ruleIsSyntactic = common.isSyntactic(ruleName);
    var value = this.evalOnce(body, rf, ruleIsSyntactic, grammar, inputStream);
    var currentLR = origPosInfo.getCurrentLeftRecursion();
    if (currentLR) {
      if (currentLR.name === ruleName) {
        value = this.handleLeftRecursion(body, rf, ruleIsSyntactic, grammar, inputStream, origPos, currentLR, value);
        origPosInfo.memo[ruleName] =
          {pos: inputStream.pos, value: value, involvedRules: currentLR.involvedRules};
        origPosInfo.endLeftRecursion(ruleName);
      } else if (!currentLR.involvedRules[ruleName]) {
        // Only memoize if this rule is not involved in the current left recursion
        origPosInfo.memo[ruleName] = {pos: inputStream.pos, value: value};
      }
    } else {
      origPosInfo.memo[ruleName] = {pos: inputStream.pos, value: value};
    }
    origPosInfo.exit(ruleName);
    if (value) {
      bindings.push(value);
      return true;
    } else {
      if (recordFailures && body.description) {
        var errorPos;
        if (body.description && ruleIsSyntactic) {
          inputStream.pos = origPos;
          grammar.skipSpaces(inputStream);
          errorPos = inputStream.pos;
        } else {
          errorPos = origPos;
        }
        inputStream.recordFailure(errorPos, this);
      }
      return false;
    }
  }
};

pexprs.Apply.prototype.evalOnce = function(expr, recordFailures, syntactic, grammar, inputStream) {
  var origPos = inputStream.pos;
  var bindings = [];
  if (expr.eval(recordFailures, syntactic, grammar, inputStream, bindings)) {
    return new nodes.RuleNode(grammar, this.ruleName, bindings, inputStream.intervalFrom(origPos));
  } else {
    return false;
  }
};

pexprs.Apply.prototype.handleLeftRecursion = function(body, recordFailures, syntactic, grammar, inputStream, origPos, currentLR, seedValue) {
  var value = seedValue;
  if (seedValue) {
    currentLR.value = seedValue;
    currentLR.pos = inputStream.pos;
    while (true) {
      inputStream.pos = origPos;
      value = this.evalOnce(body, recordFailures, syntactic, grammar, inputStream);
      if (value && inputStream.pos > currentLR.pos) {
        currentLR.value = value;
        currentLR.pos = inputStream.pos;
      } else {
        value = currentLR.value;
        inputStream.pos = currentLR.pos;
        break;
      }
    }
  }
  return value;
};

