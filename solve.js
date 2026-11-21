// csv-fast: a fast drop-in for csv-reader 1.0.0, make.fun's own CSV reader.
//
// run(input) returns exactly what csv-reader 1.0.0 returns for
// {text, header}: {columns, rows, errors}. The policy is the one RULES.txt
// states: the text is read once, left to right; a U+FEFF at the very start
// is dropped; a record ends at LF or CRLF and a line left with no
// characters is no record; outside quotes a CR not followed by LF is dropped
// (stray_cr); a field that opens with a quote runs to the next quote that is
// not doubled, "" inside it is one quote and each CRLF or lone CR inside it
// is read as LF; what follows its closing quote, up to the next comma or
// line break, is appended as it stands (quote_junk, when the field ends); a
// quote that never closes is a literal character and the text after it is
// read again as unquoted (unterminated_quote); a quote inside an unquoted
// field is a literal character; fields stay strings, never trimmed or
// converted; columns is the first record when header is true, else null;
// rows holds the records after it, each padded (short_row, with fields: its
// field count) or cut (long_row, with extra: the cut fields) to the first
// record's width; each error is {code, line, row} in the order met, a
// record's short_row or long_row when it ends, line the 1-based line its
// record starts on and row its record's index in rows (null for the header).
//
// Speed comes from never reading a character twice: a record with no quote
// and no stray CR is split natively, and every other field is found with
// indexOf jumps, each bounded by the field or the record, instead of a
// character loop. Nothing is allocated on the common path beyond the fields
// themselves.

const COMMA = 44; // ,
const LF = 10; // \n
const CR = 13; // \r
const QUOTE = 34; // "

/** csv-reader 1.0.0's answer for one case's input, {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on, and the index in rows it
  // takes (null for the header). Errors name these, never the line an
  // error's character sits on.
  let recordLine = 1;
  let recordRow = null;

  // Reads an unquoted field starting at pos, with `value` as its prefix
  // ('' for a fresh field, '"' after an unterminated quote, the quoted
  // content for junk after a closing quote). Returns {value, ended, added}:
  // ended 0 = comma, 1 = line break, 2 = end of text; added counts the
  // characters this call kept (the prefix is not counted).
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      // The field ends at the nearest comma or LF, or at the end of the text.
      const ci = text.indexOf(',', pos);
      const ni = text.indexOf('\n', pos);
      let end;
      if (ci === -1) end = ni === -1 ? len : ni;
      else if (ni === -1) end = ci;
      else end = ci < ni ? ci : ni;
      const seg = text.slice(pos, end);
      const k = seg.indexOf('\r');
      if (k === -1) {
        if (seg.length !== 0) {
          value += seg;
          added += seg.length;
        }
        if (end >= len) {
          pos = len;
          return { value, ended: 2, added };
        }
        if (text.charCodeAt(end) === COMMA) {
          pos = end + 1;
          return { value, ended: 0, added };
        }
        pos = end + 1;
        line += 1;
        return { value, ended: 1, added };
      }
      if (k === seg.length - 1 && end < len && text.charCodeAt(end) === LF) {
        // CRLF: the CR is the line break's first half.
        if (k !== 0) {
          value += seg.slice(0, k);
          added += k;
        }
        pos = end + 1;
        line += 1;
        return { value, ended: 1, added };
      }
      // A lone CR: dropped, and the error is recorded (stray_cr).
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      if (k !== 0) {
        value += seg.slice(0, k);
        added += k;
      }
      pos += k + 1;
    }
  }

  // Appends one quoted segment, text[a..b), to `chunks`, reading each CRLF
  // or lone CR inside it as one LF and counting the line breaks it holds.
  function flushQuoted(chunks, a, b) {
    if (b <= a) return;
    const seg = text.slice(a, b);
    if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) {
      chunks.push(seg);
      return;
    }
    let breaks = 0;
    const conv = seg.replace(/\r\n?|\n/g, () => {
      breaks += 1;
      return '\n';
    });
    line += breaks;
    chunks.push(conv);
  }

  // Reads a quoted field whose opening quote is at pos. Returns
  // {value, ended}: ended 0 = comma, 1 = line break, 2 = end of text.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    const chunks = [];
    let segStart = pos;
    let closedAt = -1;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) break; // no closing quote anywhere: unterminated
      if (text.charCodeAt(q + 1) === QUOTE) {
        // "" inside quotes is one quote.
        flushQuoted(chunks, segStart, q);
        chunks.push('"');
        pos = q + 2;
        segStart = pos;
        continue;
      }
      closedAt = q;
      break;
    }
    if (closedAt === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      const reread = readUnquoted('"');
      return { value: reread.value, ended: reread.ended };
    }
    flushQuoted(chunks, segStart, closedAt);
    const value = chunks.length === 1 ? chunks[0] : chunks.join('');
    const after = closedAt + 1;
    if (after >= len) {
      pos = after;
      return { value, ended: 2 };
    }
    const c = text.charCodeAt(after);
    if (c === COMMA) {
      pos = after + 1;
      return { value, ended: 0 };
    }
    if (c === LF) {
      pos = after + 1;
      line += 1;
      return { value, ended: 1 };
    }
    if (c === CR && text.charCodeAt(after + 1) === LF) {
      pos = after + 2;
      line += 1;
      return { value, ended: 1 };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    pos = after;
    const junk = readUnquoted(value);
    if (junk.added > 0) {
      errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    }
    return { value: junk.value, ended: junk.ended };
  }

  // Reads one record field by field, for a record the fast path refused
  // (a quote, or a CR that is not its CRLF terminator, sits in it).
  // Returns {fields, quoted}: the fields, and whether the last field
  // opened with a quote.
  function slowRecord() {
    const fields = [];
    let quoted = false;
    for (;;) {
      if (text.charCodeAt(pos) === QUOTE) {
        quoted = true;
        const f = readQuoted();
        fields.push(f.value);
        if (f.ended !== 0) return { fields, quoted };
      } else {
        quoted = false;
        const f = readUnquoted('');
        fields.push(f.value);
        if (f.ended !== 0) return { fields, quoted };
      }
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos += 1;
        line += 1;
      } else if (c === CR && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a record with no quote and no stray CR splits natively.
    // The only CR it may hold is the CRLF terminator's, at the very end
    // of its span (and only when a real LF follows it).
    const nl = text.indexOf('\n', pos);
    const spanEnd = nl === -1 ? len : nl;
    const seg = text.slice(pos, spanEnd);
    let fields;
    let lastQuoted = false;
    if (seg.indexOf('"') === -1) {
      const cr = seg.indexOf('\r');
      if (cr === -1) {
        fields = seg.split(',');
        if (nl === -1) {
          pos = len;
        } else {
          pos = nl + 1;
          line += 1;
        }
      } else if (cr === seg.length - 1 && nl !== -1) {
        fields = seg.slice(0, -1).split(',');
        pos = nl + 1;
        line += 1;
      } else {
        const rec = slowRecord();
        fields = rec.fields;
        lastQuoted = rec.quoted;
      }
    } else {
      const rec = slowRecord();
      fields = rec.fields;
      lastQuoted = rec.quoted;
    }

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
