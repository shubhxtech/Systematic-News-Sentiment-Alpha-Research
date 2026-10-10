/**
 * query.js
 * A simple parser and evaluator for the Screener query language.
 * E.g., "RSI < 35 AND Signal = Buy"
 */

export function parseQuery(queryString) {
  if (!queryString || !queryString.trim()) return [];
  
  // Basic regex to split on AND/OR.
  // This handles simple flat queries without parentheses for now.
  const conditions = queryString.split(/\s+(AND|OR)\s+/i);
  
  const parsed = [];
  let currentLogic = 'AND';
  
  for (let i = 0; i < conditions.length; i++) {
    const term = conditions[i].trim();
    if (term.toUpperCase() === 'AND' || term.toUpperCase() === 'OR') {
      currentLogic = term.toUpperCase();
      continue;
    }
    
    // Parse condition: field op value
    const match = term.match(/^(.+?)\s*(>=|<=|>|<|!=|=)\s*(.+)$/);
    if (match) {
      parsed.push({
        logic: currentLogic,
        field: match[1].trim().toLowerCase(),
        op: match[2],
        value: match[3].trim()
      });
    }
  }
  return parsed;
}

export function evaluateCondition(row, condition) {
  const { field, op, value } = condition;
  
  const normalizedField = field.replace(/\s+/g, '');
  
  // Map friendly field names to our internal data keys
  const fieldMap = {
    'marketcap': 'marketCap',
    'mcap': 'marketCap',
    'price': 'ltp',
    'change': 'changePct',
    'rsi': 'rsi',
    'signal': 'signal',
    'sentiment': 'nlpSentiment',
    'volume': 'volume'
  };
  
  const key = fieldMap[normalizedField] || normalizedField;
  const rowVal = row[key];
  
  if (rowVal === undefined || rowVal === null) return false;
  
  // See if right-hand side is also a field (e.g. 'price > sma200')
  const normalizedValueField = value.replace(/['"]/g, '').replace(/\s+/g, '').toLowerCase();
  const rhsKey = fieldMap[normalizedValueField] || normalizedValueField;
  let rhsVal = row[rhsKey];
  
  // If not a field, just use the raw value
  if (rhsVal === undefined) {
    rhsVal = value.replace(/['"]/g, '');
  }
  
  // Handle string values (like 'Buy', 'Sell') vs numbers
  const isStringComparison = isNaN(Number(rowVal)) || isNaN(Number(rhsVal));
  const numRowVal = isStringComparison ? String(rowVal).toLowerCase() : Number(rowVal);
  const numVal = isStringComparison ? String(rhsVal).toLowerCase() : Number(rhsVal);
  
  switch (op) {
    case '>': return numRowVal > numVal;
    case '<': return numRowVal < numVal;
    case '>=': return numRowVal >= numVal;
    case '<=': return numRowVal <= numVal;
    case '=': return numRowVal === numVal;
    case '!=': return numRowVal !== numVal;
    default: return false;
  }
}

export function filterDataByQuery(dataArray, queryString) {
  const conditions = parseQuery(queryString);
  if (conditions.length === 0) return dataArray;
  
  return dataArray.filter(row => {
    let result = true;
    for (const cond of conditions) {
      const match = evaluateCondition(row, cond);
      if (cond.logic === 'AND') {
        result = result && match;
      } else if (cond.logic === 'OR') {
        result = result || match;
      }
    }
    return result;
  });
}
