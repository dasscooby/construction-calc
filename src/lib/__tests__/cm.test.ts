// Most of these are the worked examples from the Construction Master 5 (model 4050)
// Pocket Reference Guide: same keystrokes, same answers on the display.

import { DEFAULT_PREFS, Key, createState, initialState, pressAll, view } from '../cm';

const NAMED: Record<string, Key> = {
  ft: 'ft', in: 'in', yd: 'yd', m: 'm', cm: 'cm', mm: 'mm', bdft: 'bdft', w: 'weight',
  p: 'pitch', r: 'rise', R: 'run', d: 'diag', H: 'hip', j: 'jack', s: 'stair', C: 'circ', rw: 'rwall',
  conv: 'conv', rcl: 'rcl', 'm+': 'm+', o: 'onc', back: 'back', sqrt: 'sqrt',
  '%': '%', '+': '+', '-': '-', x: '*', '÷': '/', '=': '=',
};

/** "12 ft 6 in 3/4 +" → keys. Numbers are split into digit keys, "/" is the fraction bar. */
function keys(str: string): Key[] {
  return str
    .trim()
    .split(/\s+/)
    .flatMap((tok) => {
      if (NAMED[tok]) return [NAMED[tok]];
      if (/^[\d./]+$/.test(tok)) return tok.split('').map((c) => (c === '/' ? 'frac' : (c as Key)));
      throw new Error(`unknown key "${tok}"`);
    });
}

type Step = [keys: string, text: string, label?: string];

/** Press each group of keys and check the display after it. */
function walk(steps: Step[], start = initialState) {
  let s = start;
  for (const [k, text, label] of steps) {
    s = pressAll(keys(k), s);
    const v = view(s);
    const got = label === undefined ? { k, text: v.text } : { k, text: v.text, label: v.label };
    const want = label === undefined ? { k, text } : { k, text, label };
    expect(got).toEqual(want);
  }
  return s;
}

describe('the example from the original request', () => {
  test(`12' 6 3/4" + 3' 8 1/2" = 16' 3 1/4"`, () => {
    walk([
      ['12 ft 6 in 3/4', '12 FEET 6-3/4 INCH'],
      ['+ 3 ft 8 in 1/2 =', '16 FEET 3-1/4 INCH'],
      ['conv ft', '16.27083 FEET'],
      ['conv in', '195-1/4 INCH'],
      ['conv yd', '5.423611 YD'],
      ['conv m', '4.959 M'],
    ]);
  });

  test('10 ft x 10 ft x 4 in = 1.23 cubic yards (33.33 cubic feet)', () => {
    const s = walk([['10 ft x 10 ft x 4 in =', '1.234568 CU YD']]);
    expect(view(s).extra).toBe('= 33.33333 CU FEET');
    walk([['conv ft', '33.33333 CU FEET']], s);
  });
});

describe('entering dimensions (manual p.13)', () => {
  test.each([
    ['5 yd', '5 YD'],
    ['5 ft 1 in 1/2', '5 FEET 1-1/2 INCH'],
    ['17.5 m', '17.5 M'],
    ['5 yd yd yd', '5 CU YD'],
    ['130 ft ft', '130 SQ FEET'],
    ['33 m m', '33 SQ M'],
  ])('%s shows %s', (k, text) => {
    walk([[k, text]]);
  });

  test('a fraction with no unit is inches, and a missing denominator uses 16ths', () => {
    walk([['44/64', '0-44/64 INCH']]);
    walk([['3/ =', '0-3/16 INCH']]);
  });

  test('backspace removes one key at a time', () => {
    walk([
      ['12 ft 6 in 3/4', '12 FEET 6-3/4 INCH'],
      ['back', '12 FEET 6-3/ INCH'],
      ['back', '12 FEET 6 INCH 3'],
      ['back back', '12 FEET 6'],
      ['in', '12 FEET 6 INCH'],
    ]);
  });
});

describe('conversions (manual p.14-15)', () => {
  test('10 feet 6 inches to yards, inches and metric', () => {
    walk([
      ['o o', '0'],
      ['10 ft 6 in', '10 FEET 6 INCH'],
      ['conv yd', '3.5 YD'],
      ['conv in', '126 INCH'],
      ['conv m', '3.200 M'],
      ['conv cm', '320.04 CM'],
      ['conv mm', '3200.4 MM'],
    ]);
  });

  test('feet-inches to decimal feet and back', () => {
    walk([['o o 14 ft 7 in 1/2', '14 FEET 7-1/2 INCH'], ['conv ft', '14.625 FEET']]);
    walk([['o o 22.75 ft', '22.75 FEET'], ['conv ft', '22 FEET 9 INCH']]);
  });

  test('square and cubic', () => {
    walk([['o o 14 ft ft', '14 SQ FEET'], ['conv yd', '1.555556 SQ YD']]);
    walk([['o o 25 yd yd', '25 SQ YD'], ['conv ft', '225 SQ FEET']]);
    walk([['o o 12 ft ft ft', '12 CU FEET'], ['conv yd', '0.444444 CU YD']]);
  });
});

describe('basic math (manual p.15-18)', () => {
  test.each([
    ['3 + 2 =', '5'],
    ['3 - 2 =', '1'],
    ['3 x 2 =', '6'],
    ['3 ÷ 2 =', '1.5'],
  ])('%s %s', (k, text) => {
    walk([[k, text]]);
  });

  test('adding and subtracting strings of dimensions', () => {
    walk([
      ['o o', '0'],
      ['6 ft 2 in 1/2 +', '6 FEET 2-1/2 INCH'],
      ['11 ft 5 in 1/4 +', '17 FEET 7-3/4 INCH'],
      ['18.25 in =', '19 FEET 2 INCH'],
      ['- 2 in 1/8 =', '18 FEET 11-7/8 INCH'],
    ]);
  });

  test('multiplying dimensions', () => {
    walk([
      ['o o 3 x 15 ft 3 in 3/4 =', '45 FEET 11-1/4 INCH'],
      ['5 ft 3 in x 11 ft 6 in 1/2 =', '60.59375 SQ FEET'],
    ]);
  });

  test('dividing dimensions', () => {
    walk([['o o 15 ft 3 in 3/4 ÷ 3 =', '5 FEET 1-1/4 INCH']]);
    walk([['o o 25 ft ÷ 3 ft 6 in =', '7.142857']]);
  });

  test('percent', () => {
    walk([['o o 2.78 yd yd yd + 10 %', '3.058 CU YD']]);
    walk([['o o 1575 x 25 %', '393.75']]);
    walk([['o o 55 ft ft + 10 %', '60.5 SQ FEET'], ['150 ft ft ft + 20 %', '180 CU FEET']]);
  });

  test('square area with x²', () => {
    walk([['o o 15 ft 8 in 1/2 conv sqrt', '246.7517 SQ FEET']]);
  });

  test('square root of an area is a length', () => {
    walk([['o o 100 ft ft sqrt', '10 FEET 0 INCH']]);
  });

  test('rectangular area and volume', () => {
    walk([
      ['o o 20 ft 6 in 1/2 x', '20 FEET 6-1/2 INCH'],
      ['12 ft 8 in 1/2 x', '261.0503 SQ FEET'],
      ['10 in =', '8.057109 CU YD'],
      ['conv ft', '217.542 CU FEET'],
    ]);
  });

  test('1/x, +/- and pi', () => {
    walk([['8 conv ÷', '0.125']]);
    walk([['o o 5 ft conv -', '−5 FEET']]);
    walk([['o o conv +', '3.141593'], ['x 2 =', '6.283185']]);
  });
});

describe('weight (manual p.19-20)', () => {
  test('converting 150 pounds', () => {
    walk([
      ['o o 150 w w', '150 LB'],
      ['conv w', '0.068039 MET Ton'],
      ['w', '68.03886 kG'],
      ['w', '0.075 Ton'],
    ]);
  });

  test('weight per volume, default 1.5 tons per cubic yard, then 2 tons', () => {
    walk([
      ['o o 20 yd yd yd', '20 CU YD'],
      ['conv w', '30 Ton'],
      ['w', '60000 LB'],
      ['w', '27.21554 MET Ton'],
      ['w', '27215.54 kG'],
      ['2 conv 0', '2 Ton Per CU YD'],
      ['20 yd yd yd conv w', '40 Ton'],
      ['w', '80000 LB'],
      ['w', '36.28739 MET Ton'],
      ['w', '36287.39 kG'],
      ['conv x', 'ALL CLEARED'],
      ['20 yd yd yd conv w', '30 Ton'],
    ]);
  });

  test('pressing 0 after storing weight per volume changes its units', () => {
    walk([['o o 4000 conv 0', '4000 Ton Per CU YD'], ['0', '4000 LB Per CU YD'], ['rcl 0', '4000 LB Per CU YD']]);
  });
});

describe('memory (manual p.21)', () => {
  test('add, subtract, total, average, count, clear', () => {
    const s = walk([
      ['o o 355 m+', '355', 'M+'],
      ['255 m+', '255', 'M+'],
      ['745 conv m+', '745', 'M-'],
      ['rcl m+', '−135', 'TTL'],
      ['m+', '−45', 'AVG'],
      ['m+', '3', 'CNT'],
      ['rcl rcl', '−135', 'M+'],
    ]);
    expect(s.memory).toBeNull();
  });

  test('Conv Rcl clears memory without changing the display', () => {
    const s = walk([['o o 5 m+ 7', '7'], ['conv rcl', '7']]);
    expect(s.memory).toBeNull();
  });

  test('memory refuses to mix units', () => {
    walk([['o o 5 ft m+ 3 ft ft m+', 'DIM Error']]);
  });
});

describe('board feet and cost (manual p.22)', () => {
  test('2x4x16, 2x10x18 and 2x12x20 at $275 per thousand', () => {
    walk([
      ['o o 2 x 4 x 16 bdft m+', '10.66667 BDFT'],
      ['2 x 10 x 18 bdft m+', '30 BDFT'],
      ['2 x 12 x 20 bdft m+', '40 BDFT'],
      ['rcl rcl', '80.66667 BDFT'],
      ['x 275 conv .', '22.18', '$'],
    ]);
  });
});

describe('carpentry examples (manual p.22-23)', () => {
  test('number of studs', () => {
    walk([
      ['o o 18 ft 7 in 1/2', '18 FEET 7-1/2 INCH'],
      ['÷ 16 in =', '13.96875'],
      ['+ 1 =', '14.96875'],
    ]);
  });

  test('baluster spacing', () => {
    walk([
      ['o o 156 in ÷', '156 INCH'],
      ['5 in 1/2 =', '28.36364'],
      ['1 in 1/2 x', '1-1/2 INCH'],
      ['28 =', '42 INCH'],
      ['156 in -', '156 INCH'],
      ['42 in =', '114 INCH'],
      ['114 in ÷', '114 INCH'],
      ['29 =', '3-15/16 INCH'],
    ]);
  });
});

describe('circles and concrete (manual p.24-27)', () => {
  test('circle area and circumference', () => {
    walk([
      ['o o 25 in C', '25 INCH', 'DIA'],
      ['C', '490.8739 SQ INCH', 'AREA'],
      ['C', '78-9/16 INCH', 'CIRC'],
    ]);
  });

  test('arc angle from diameter and arc length', () => {
    walk([
      ['o o 5 ft C', '5 FEET 0 INCH', 'DIA'],
      ['3 ft 3 in', '3 FEET 3 INCH'],
      ['conv C', '74.48°', 'ARC'],
    ]);
  });

  test('arc length from an angle', () => {
    walk([['o o 10 ft C 90 conv C', '7 FEET 10-1/4 INCH', 'ARC']]);
  });

  test('driveway volume and cost', () => {
    walk([
      ['o o 45 ft 5 in', '45 FEET 5 INCH'],
      ['x 13 ft 6 in', '13 FEET 6 INCH'],
      ['x 5 in =', '9.461806 CU YD'],
      ['x 65 conv .', '615.02', '$'],
    ]);
  });

  test('five round columns', () => {
    const s = walk([
      ['o o 3 ft 4 in 1/2 C', '3 FEET 4-1/2 INCH', 'DIA'],
      ['C', '8.946176 SQ FEET', 'AREA'],
      ['x 11 ft 6 in =', '3.810408 CU YD'],
    ]);
    expect(view(s).extra).toBe('= 102.881 CU FEET'); // the manual shows this one first
    walk([['x 5 =', '19.05204 CU YD']], s);
  });

  test('odd-shaped patio using memory', () => {
    walk([
      ['o o 38 ft 2 in - 4 ft 2 in =', '34 FEET 0 INCH'],
      ['x 27 ft =', '918 SQ FEET'],
      ['m+', '918 SQ FEET', 'M+'],
      ['4 ft 2 in', '4 FEET 2 INCH'],
      ['x 8 ft 6 in =', '35.41667 SQ FEET'],
      ['m+', '35.41667 SQ FEET', 'M+'],
      ['9 ft', '9 FEET'],
      ['x 9 ft 6 in =', '85.5 SQ FEET'],
      ['m+', '85.5 SQ FEET', 'M+'],
      ['rcl rcl', '1038.917 SQ FEET', 'M+'],
      ['x 4 in 1/2 =', '14.4294 CU YD'],
    ]);
  });
});

describe('right angle and roof framing (manual p.28-34)', () => {
  test('squaring up a foundation', () => {
    walk([
      ['o o 15 ft 6 in R', '15 FEET 6 INCH', 'RUN'],
      ['10 ft 2 in r', '10 FEET 2 INCH', 'RISE'],
      ['d', '18 FEET 6-7/16 INCH', 'DIAG'],
    ]);
  });

  test('pitch from a roof angle', () => {
    walk([
      ['o o 30.25 p', '30.25°', 'PTCH'],
      ['p', '58.31828', '%GRD'],
      ['p', '0.583183', 'SLP'],
      ['p', '7 INCH', 'PTCH'],
    ]);
  });

  test('pitch from a slope ratio', () => {
    walk([
      ['o o .625 conv p', '0.625', 'SLP'],
      ['p', '7-1/2 INCH', 'PTCH'],
      ['p', '32.01°', 'PTCH'],
      ['p', '62.5', '%GRD'],
    ]);
  });

  test('pitch entered as a percent grade', () => {
    walk([['o o 75 % p', '75', '%GRD'], ['p', '0.75', 'SLP'], ['p', '9 INCH', 'PTCH']]);
  });

  test('common rafter length on a 7/12 roof with a 28 ft span', () => {
    walk([
      ['o o 7 in p', '7 INCH', 'PTCH'],
      ['28 ft ÷ 2 =', '14 FEET 0 INCH'],
      ['R', '14 FEET 0 INCH', 'RUN'],
      ['r', '8 FEET 2 INCH', 'RISE'],
      ['d', '16 FEET 2-1/2 INCH', 'DIAG'],
    ]);
  });

  test('regular hip/valley and jack rafters', () => {
    walk([
      ['o o 6 ft R', '6 FEET 0 INCH', 'RUN'],
      ['9 in p', '9 INCH', 'PTCH'],
      ['d', '7 FEET 6 INCH', 'DIAG'],
      ['H', '9 FEET 7-1/4 INCH', 'H/V'],
      ['j', '16 INCH', 'JKOC'],
      ['j', '5 FEET 10 INCH', 'JK 1'],
      ['j', '4 FEET 2 INCH', 'JK 2'],
      ['j', '2 FEET 6 INCH', 'JK 3'],
      ['j', '0 FEET 10 INCH', 'JK 4'],
      ['j', '0 FEET 0 INCH', 'JK 5'],
      ['j', '16 INCH', 'JKOC'],
    ]);
  });

  test('jack spacing can be changed (24 inch o.c.)', () => {
    walk([['o o 24 in conv 5', '24 INCH', 'o.c.'], ['6 ft R 9 in p j j', '5 FEET 0 INCH', 'JK 1'], ['rcl 5', '24 INCH', 'o.c.']]);
  });

  test('irregular hip/valley and jacks', () => {
    walk([
      ['o o 7 in p', '7 INCH', 'PTCH'],
      ['15 ft 7 in R', '15 FEET 7 INCH', 'RUN'],
      ['d', '18 FEET 0-1/2 INCH', 'DIAG'],
      ['8 in conv H', '8 INCH', 'IPCH'],
      ['H', '22 FEET 7-3/8 INCH', 'IH/V'],
      ['conv j', '16 INCH', 'IJOC'],
      ['j', '14 FEET 11-13/16 INCH', 'IJ 1'],
      ['j', '13 FEET 7 INCH', 'IJ 2'],
      ['j', '12 FEET 2-3/16 INCH', 'IJ 3'],
      ['j', '10 FEET 9-3/8 INCH', 'IJ 4'],
      ['j', '9 FEET 4-1/2 INCH', 'IJ 5'],
    ]);
  });

  test('rake wall with no base', () => {
    walk([
      ['o o 3 ft 6 in r', '3 FEET 6 INCH', 'RISE'],
      ['6 ft R', '6 FEET 0 INCH', 'RUN'],
      ['rw', '16 INCH', 'RWOC'],
      ['rw', '2 FEET 8-11/16 INCH', 'RW 1'],
      ['rw', '1 FEET 11-5/16 INCH', 'RW 2'],
      ['rw', '1 FEET 2 INCH', 'RW 3'],
      ['rw', '0 FEET 4-11/16 INCH', 'RW 4'],
      ['rw', '0 FEET 0 INCH', 'BASE'],
      ['rw', '30.26°', 'RW'],
    ]);
  });

  test('rake wall with a base adds it to every stud', () => {
    walk([['o o 3 ft 6 in r 6 ft R 5 ft rw rw', '7 FEET 8-11/16 INCH', 'RW 1']]);
  });
});

describe('stairs (manual p.35-37)', () => {
  test('given rise and run', () => {
    const s = walk([
      ['o o 10 ft 1 in r', '10 FEET 1 INCH', 'RISE'],
      ['12 ft 5 in R', '12 FEET 5 INCH', 'RUN'],
      ['rcl s', '7-1/2 INCH', 'R-HT'],
      ['s', '7-9/16 INCH', 'R-HT'],
    ]);
    expect(view(s).mark).toBe('▲'); // more than the 7-1/2" target
    walk(
      [
        ['s', '16', 'RSRS'],
        ['s', '0 INCH', 'R+/–'],
        ['s', '9-15/16 INCH', 'T-WD'],
        ['s', '15', 'TRDS'],
        ['s', '0-1/16 INCH', 'T+/–'],
        ['s', '15 FEET 7-5/16 INCH', 'STRG'],
        ['s', '37.27°', 'INCL'],
      ],
      s,
    );
  });

  test('given only the rise, with an 8 inch desired riser', () => {
    walk([
      ['o o 8 in conv 7', '8 INCH', 'R-HT'],
      ['12 ft 6 in r', '12 FEET 6 INCH', 'RISE'],
      ['s', '7-7/8 INCH', 'R-HT'],
      ['s', '19', 'RSRS'],
      ['s', '−0-3/8 INCH', 'R+/–'],
      ['s', '10 INCH', 'T-WD'],
      ['s', '18', 'TRDS'],
      ['s', '0 INCH', 'T+/–'],
      ['s', '19 FEET 1-1/8 INCH', 'STRG'],
      ['s', '38.22°', 'INCL'],
      ['s', '15 FEET 0 INCH', 'RUN'],
      ['s', '12 FEET 6 INCH', 'RISE'],
      ['s', '8 INCH', 'R-HT'],
      ['s', '10 INCH', 'T-WD'],
    ]);
  });

  test('stairs need a rise', () => {
    walk([['o o s', 'NEED DATA']]);
  });
});

describe('fractional resolution (manual p.38)', () => {
  test('answers keep 64ths when 64ths were typed; Conv 1/2/3/4/6/8 shows other fractions', () => {
    const s = walk([
      ['o o 44/64', '0-44/64 INCH'],
      ['+ 1/64 =', '0-45/64 INCH'],
      ['conv 1', '0-11/16 INCH'],
      ['conv 2', '0-1/2 INCH'],
      ['conv 3', '0-23/32 INCH'],
      ['conv 4', '0-3/4 INCH'],
      ['conv 6', '0-45/64 INCH'],
      ['conv 8', '0-3/4 INCH'],
      ['o o', '0'],
    ]);
    expect(s.tempDenom).toBeNull();
  });

  test('preference: round to 1/4 inch', () => {
    walk([['10 in ÷ 3 =', '3-1/4 INCH']], createState({ ...DEFAULT_PREFS, denom: 4 }));
  });

  test('preference: constant fractions', () => {
    walk([['1/2 =', '0-8/16 INCH']], createState({ ...DEFAULT_PREFS, fracMode: 'const' }));
  });

  test('preference: areas in square yards', () => {
    walk([['9 ft x 9 ft =', '9 SQ YD']], createState({ ...DEFAULT_PREFS, area: 'sqyd' }));
  });
});

describe('paperless tape (manual p.10)', () => {
  test('records each entry and the total', () => {
    const s = walk([
      ['o o 6 ft +', '6 FEET 0 INCH'],
      ['5 ft +', '11 FEET 0 INCH'],
      ['4 ft =', '15 FEET 0 INCH'],
    ]);
    expect(s.tape).toEqual([
      { tag: '', text: '6 FEET 0 INCH' },
      { tag: '+', text: '5 FEET 0 INCH' },
      { tag: '+', text: '4 FEET 0 INCH' },
      { tag: 'TTL=', text: '15 FEET 0 INCH' },
    ]);
    const t = pressAll(keys('rcl ='), s);
    expect(t.ui).toBe('tape');
    walk([['+ 10 ft =', '25 FEET 0 INCH']], t);
  });
});

describe('errors and clearing', () => {
  test('adding feet to a plain number is a dimension error', () => {
    const s = walk([['5 ft + 3 =', 'DIM Error']]);
    expect(view(s).info).toMatch(/length/);
    walk([['7', '7']], s); // typing starts over
  });

  test('divide by zero', () => {
    walk([['8 ÷ 0 =', 'DIV Error'], ['o', '0']]);
  });

  test('On/C once clears the entry, twice clears stored rise/run but keeps the pitch', () => {
    let s = walk([['7 in p 10 ft R', '10 FEET 0 INCH', 'RUN'], ['5', '5'], ['o', '0']]);
    expect(s.tri.run).toBeDefined();
    s = walk([['o', '0']], s);
    expect(s.tri.run).toBeUndefined();
    expect(s.tri.pitch).toBeCloseTo(7 / 12);
  });

  test('changing your mind about the operator', () => {
    walk([['10 + x 3 =', '30']]);
  });

  test('On/C once while typing the second number keeps the + waiting', () => {
    walk([['5 + 3 o', '0'], ['4 =', '9']]);
  });
});
