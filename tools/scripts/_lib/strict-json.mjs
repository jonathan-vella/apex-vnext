/** Parse JSON while rejecting duplicate object keys. */

export function parseStrictJson(source) {
  let offset = 0;

  const fail = (code) => {
    throw new SyntaxError(code);
  };
  const whitespace = () => {
    while (source[offset] === " " || source[offset] === "\t" || source[offset] === "\n" || source[offset] === "\r") {
      offset += 1;
    }
  };
  const string = () => {
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      if (source[offset] === "\\") offset += 2;
      else if (source[offset] === '"') {
        offset += 1;
        try {
          return JSON.parse(source.slice(start, offset));
        } catch {
          fail("INVALID_JSON_STRING");
        }
      } else offset += 1;
    }
    fail("UNTERMINATED_JSON_STRING");
  };
  const object = () => {
    const result = {};
    const keys = new Set();
    offset += 1;
    whitespace();
    if (source[offset] === "}") {
      offset += 1;
      return result;
    }
    while (offset < source.length) {
      if (source[offset] !== '"') fail("INVALID_JSON_OBJECT_KEY");
      const key = string();
      if (keys.has(key)) fail("DUPLICATE_JSON_KEY");
      if (key === "__proto__" || key === "constructor" || key === "prototype") fail("DANGEROUS_JSON_KEY");
      keys.add(key);
      whitespace();
      if (source[offset] !== ":") fail("INVALID_JSON_OBJECT_SEPARATOR");
      offset += 1;
      Object.defineProperty(result, key, { value: value(), enumerable: true, configurable: true, writable: true });
      whitespace();
      if (source[offset] === "}") {
        offset += 1;
        return result;
      }
      if (source[offset] !== ",") fail("INVALID_JSON_OBJECT_SEPARATOR");
      offset += 1;
      whitespace();
    }
    fail("UNTERMINATED_JSON_OBJECT");
  };
  const array = () => {
    const result = [];
    offset += 1;
    whitespace();
    if (source[offset] === "]") {
      offset += 1;
      return result;
    }
    while (offset < source.length) {
      result.push(value());
      whitespace();
      if (source[offset] === "]") {
        offset += 1;
        return result;
      }
      if (source[offset] !== ",") fail("INVALID_JSON_ARRAY_SEPARATOR");
      offset += 1;
    }
    fail("UNTERMINATED_JSON_ARRAY");
  };
  const value = () => {
    whitespace();
    if (source[offset] === '"') return string();
    if (source[offset] === "{") return object();
    if (source[offset] === "[") return array();
    const match = source.slice(offset).match(/^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/);
    if (match === null) fail("INVALID_JSON_VALUE");
    offset += match[0].length;
    return JSON.parse(match[0]);
  };

  const parsed = value();
  whitespace();
  if (offset !== source.length) fail("TRAILING_JSON_DATA");
  return parsed;
}
