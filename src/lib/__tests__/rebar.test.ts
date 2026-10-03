import {
  anchorsPerWall,
  BARS,
  beamBars,
  countAlong,
  getBar,
  hook180ExtIn,
  hook90ExtIn,
  lapIn,
  minBendDiaIn,
  minSticks,
  piecesPerRun,
  piecesToCover,
  planRun,
  slabGrid,
  sticksToCut,
  tieBendDiaIn,
  tieCutLengthIn,
  tieHookExtIn,
  weightLb,
} from '../rebar';

describe('bar table (ASTM A615 Table 1)', () => {
  test.each([
    // size, diameter in, area sq in, lb/ft
    [3, 0.375, 0.11, 0.376],
    [4, 0.5, 0.2, 0.668],
    [5, 0.625, 0.31, 1.043],
    [6, 0.75, 0.44, 1.502],
    [7, 0.875, 0.6, 2.044],
    [8, 1.0, 0.79, 2.67],
    [9, 1.128, 1.0, 3.4],
    [10, 1.27, 1.27, 4.303],
    [11, 1.41, 1.56, 5.313],
  ])('#%d', (size, dia, area, w) => {
    expect(getBar(size)).toEqual({ size, diaIn: dia, areaSqIn: area, lbPerFt: w });
  });

  test('weights agree with the diameters (steel = 490 lb per cubic foot)', () => {
    // 1 sq in × 1 ft of steel = 490 / 144 = 3.40 lb.  #4: π/4 × 0.5² = 0.196 sq in × 3.40 = 0.668 lb/ft
    for (const b of BARS) {
      const fromDia = ((Math.PI / 4) * b.diaIn ** 2 * 490) / 144;
      expect(Math.abs(fromDia - b.lbPerFt) / b.lbPerFt).toBeLessThan(0.005);
      expect(Math.abs((Math.PI / 4) * b.diaIn ** 2 - b.areaSqIn)).toBeLessThan(0.006);
    }
  });

  test('lookup by text and unknown sizes', () => {
    expect(getBar('5').size).toBe(5);
    expect(getBar('#6').size).toBe(6);
    expect(() => getBar(12)).toThrow();
  });

  test('weight', () => {
    expect(weightLb(getBar(5), 20)).toBeCloseTo(20.86, 6); // 20' × 1.043
  });
});

describe('laps', () => {
  test('40 bar diameters by default', () => {
    expect(lapIn(getBar(3))).toBe(15);
    expect(lapIn(getBar(4))).toBe(20);
    expect(lapIn(getBar(5))).toBe(25);
    expect(lapIn(getBar(8))).toBe(40);
    expect(lapIn(getBar(5), 48)).toBe(30);
  });
});

describe('countAlong (spaces rounded up, plus one)', () => {
  test('exact fit', () => {
    expect(countAlong(234, 18)).toBe(14); // 234 ÷ 18 = 13 spaces → 14 bars
  });
  test('rounds the spaces up so the spacing is never more than asked', () => {
    expect(countAlong(240, 18)).toBe(15); // 13.3 → 14 spaces → 15 bars, 17.1" apart
    expect(countAlong(10, 18)).toBe(2); // shorter than one space: a bar at each end
  });
  test('floating point does not add a bar', () => {
    expect(countAlong(0.1 * 3, 0.1)).toBe(4); // 0.30000000000000004 ÷ 0.1 is still 3 spaces
  });
  test('nothing to span = one', () => {
    expect(countAlong(0, 18)).toBe(1);
    expect(countAlong(-5, 18)).toBe(1);
  });
  test('spacing must be positive', () => {
    expect(() => countAlong(10, 0)).toThrow();
  });
});

describe('anchorsPerWall (IRC R403.1.6: at least 2, one near each end)', () => {
  test('30 ft wall, 6 ft apart, 12" from the ends', () => {
    // (30 − 2 × 1) ÷ 6 = 4.67 → 5 spaces → 6 bolts
    expect(anchorsPerWall(30, 6, 1)).toBe(6);
  });
  test('exact multiple', () => {
    expect(anchorsPerWall(26, 6, 1)).toBe(5); // 24 ÷ 6 = 4 spaces
  });
  test('never fewer than 2', () => {
    expect(anchorsPerWall(7, 6, 1)).toBe(2); // 5 ÷ 6 → 1 space → 2
    expect(anchorsPerWall(1.5, 6, 1)).toBe(2); // shorter than 2 × end distance
    expect(anchorsPerWall(8.5, 6, 1)).toBe(3); // 6.5 ÷ 6 = 1.08 → 2 spaces → 3
  });
});

describe('runs longer than a stock bar', () => {
  const lap25 = 25 / 12;

  test('fits in one bar = no lap', () => {
    expect(piecesPerRun(19.5, 20, lap25)).toBe(1);
    expect(piecesPerRun(20, 20, lap25)).toBe(1);
  });

  test('50 ft run, 20 ft bars, 25" laps', () => {
    // (50 − 2.083) ÷ (20 − 2.083) = 47.917 ÷ 17.917 = 2.67 → 3 bars, 2 laps
    expect(piecesPerRun(50, 20, lap25)).toBe(3);
    const p = planRun(50, 20, lap25);
    expect(p.laps).toBe(2);
    expect(p.barFt).toBeCloseTo(50 + 2 * lap25, 9); // 54.17 ft of steel
    expect(p.tailFt).toBeCloseTo(50 + 2 * lap25 - 40, 9); // 2 full bars + one 14.17 ft piece
  });

  test('exactly two bars long is two bars, not three', () => {
    expect(piecesPerRun(40 - lap25, 20, lap25)).toBe(2);
    expect(planRun(40 - lap25, 20, lap25).tailFt).toBeCloseTo(20, 9);
    expect(piecesPerRun(40 - lap25 + 0.01, 20, lap25)).toBe(3);
  });

  test('lap as long as the bar is impossible', () => {
    expect(() => piecesPerRun(50, 20, 20)).toThrow();
  });
});

describe('sticksToCut', () => {
  test('identical pieces', () => {
    expect(sticksToCut([{ lengthFt: 6, count: 10 }], 20)).toBe(4); // 3 per bar → 3 full + 1
    expect(sticksToCut([{ lengthFt: 20, count: 5 }], 20)).toBe(5);
    expect(sticksToCut([], 20)).toBe(0);
  });

  test('leftovers get used for shorter pieces', () => {
    // 42 pieces of 11.17' leave 42 leftovers of 8.83'; the 42 pieces of 8' fit in those
    expect(sticksToCut([{ lengthFt: 11 + 1 / 6, count: 42 }, { lengthFt: 8, count: 42 }], 20)).toBe(42);
    // 3 × 15' leaves three 5' scraps: the 4' pieces use those first
    expect(sticksToCut([{ lengthFt: 15, count: 3 }, { lengthFt: 4, count: 2 }], 20)).toBe(3);
    expect(sticksToCut([{ lengthFt: 15, count: 3 }, { lengthFt: 4, count: 5 }], 20)).toBe(4);
  });

  test('leftovers too short are scrap', () => {
    // 21 × 19.5' (0.5' scraps) + 14 × 11.17' (one per bar)
    expect(sticksToCut([{ lengthFt: 19.5, count: 21 }, { lengthFt: 11 + 1 / 6, count: 14 }], 20)).toBe(35);
  });

  test('piece longer than the stock bar', () => {
    expect(() => sticksToCut([{ lengthFt: 21, count: 1 }], 20)).toThrow();
  });

  test('same answer as cutting piece by piece (longest first, into the shortest leftover that fits)', () => {
    const bestFitSticks = (groups: { lengthFt: number; count: number }[], stock: number) => {
      const pieces = groups.flatMap((g) => Array<number>(g.count).fill(g.lengthFt)).sort((a, b) => b - a);
      const left: number[] = [];
      for (const p of pieces) {
        let best = -1;
        for (let i = 0; i < left.length; i++) if (left[i] >= p - 1e-9 && (best < 0 || left[i] < left[best])) best = i;
        if (best < 0) left.push(stock - p);
        else left[best] -= p;
      }
      return left.length;
    };
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let trial = 0; trial < 300; trial++) {
      const stock = [20, 30, 40, 60][Math.floor(rand() * 4)];
      const groups = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => ({
        lengthFt: Math.round((0.5 + rand() * (stock - 0.5)) * 12) / 12, // whole inches
        count: Math.floor(rand() * 30),
      }));
      expect(sticksToCut(groups, stock)).toBe(bestFitSticks(groups, stock));
    }
  });

  test('bare minimum if every scrap is used', () => {
    expect(minSticks(845.83, 20)).toBe(43);
    expect(minSticks(40, 20)).toBe(2);
    expect(minSticks(0, 20)).toBe(0);
  });
});

describe('hooks and bends (ACI 318-19 Tables 25.3.1 and 25.3.2)', () => {
  test('stirrup/tie hook extensions: 6 bar diameters, at least 3"', () => {
    expect(tieHookExtIn(getBar(3), 135)).toBe(3); // 6 × 0.375 = 2.25 → 3" minimum
    expect(tieHookExtIn(getBar(4), 135)).toBe(3); // 6 × 0.5 = 3
    expect(tieHookExtIn(getBar(5), 135)).toBe(3.75); // 6 × 0.625
    expect(tieHookExtIn(getBar(3), 90)).toBe(3);
    expect(tieHookExtIn(getBar(5), 90)).toBe(3.75);
  });

  test('#6–#8 ties: 90° = 12 bar diameters, 135° = 6', () => {
    expect(tieHookExtIn(getBar(6), 90)).toBe(9);
    expect(tieHookExtIn(getBar(6), 135)).toBe(4.5);
    expect(() => tieHookExtIn(getBar(9), 135)).toThrow();
  });

  test('tie bend diameters', () => {
    expect(tieBendDiaIn(getBar(3))).toBe(1.5); // 4 bar diameters
    expect(tieBendDiaIn(getBar(5))).toBe(2.5);
    expect(tieBendDiaIn(getBar(6))).toBe(4.5); // 6 bar diameters
  });

  test('standard hooks on main bars', () => {
    expect(hook90ExtIn(getBar(4))).toBe(6); // 12 × 0.5
    expect(hook90ExtIn(getBar(9))).toBeCloseTo(13.536, 9);
    expect(hook180ExtIn(getBar(3))).toBe(2.5); // 4 × 0.375 = 1.5 → 2.5" minimum
    expect(hook180ExtIn(getBar(5))).toBe(2.5);
    expect(hook180ExtIn(getBar(6))).toBe(3);
    expect(hook180ExtIn(getBar(8))).toBe(4);
    expect(minBendDiaIn(getBar(4))).toBe(3); // 6 bar diameters
    expect(minBendDiaIn(getBar(8))).toBe(6);
    expect(minBendDiaIn(getBar(9))).toBeCloseTo(9.024, 9); // 8 bar diameters
    expect(minBendDiaIn(getBar(11))).toBeCloseTo(11.28, 9);
  });

  test('tie cut length = outside perimeter + 2 hooks', () => {
    // 12" × 24" beam, 1-1/2" cover → 9" × 21" tie: 2 × 9 + 2 × 21 + 2 × 3 = 66"
    expect(tieCutLengthIn(12, 24, 1.5, getBar(3), 135)).toBe(66);
    // 16" × 30", 2" cover, #5, 90°: 2 × 12 + 2 × 26 + 2 × 3.75 = 83.5"
    expect(tieCutLengthIn(16, 30, 2, getBar(5), 90)).toBe(83.5);
  });
});

describe('slabGrid', () => {
  // 30' × 20' slab, #4 at 18", 3" edge cover, 20' bars, 20" laps (40 × 1/2"), chairs every 4'
  const base = {
    lengthFt: 30,
    widthFt: 20,
    bar: getBar(4),
    spacingIn: 18,
    coverIn: 3,
    stockFt: 20,
    lapIn: 20,
    layers: 1,
    chairSpacingFt: 4,
  };

  test('worked example', () => {
    const g = slabGrid(base);
    // Lengthwise bars: spread over 240 − 6 = 234" → 13 spaces → 14 bars, each 30 − 0.5 = 29.5' long.
    //   29.5' > 20': (29.5 − 1.667) ÷ (20 − 1.667) = 1.52 → 2 bars, 1 lap → 31.17' of steel per run
    expect(g.alongLength).toMatchObject({ count: 14, runFt: 29.5, pieces: 2, laps: 1 });
    expect(g.alongLength.barFt).toBeCloseTo(29.5 + 20 / 12, 9);
    // Widthwise bars: spread over 360 − 6 = 354" → 19.67 → 20 spaces → 21 bars, each 19.5' (one stick)
    expect(g.alongWidth).toMatchObject({ count: 21, runFt: 19.5, pieces: 1, laps: 0, barFt: 19.5 });
    expect(g.laps).toBe(14);
    // 14 × 31.167 + 21 × 19.5 = 436.33 + 409.5 = 845.83 ft
    expect(g.totalFt).toBeCloseTo(845.8333, 3);
    // 14 full sticks (one per lap) + 21 sticks for the 19.5' bars + 14 for the 11.17' pieces
    expect(g.sticks).toBe(49);
    expect(g.minSticks).toBe(43); // 845.83 ÷ 20 = 42.3
    expect(g.lb).toBeCloseTo(845.8333 * 0.668, 3); // 565.0 lb
    // Chairs: 29.5 ÷ 4 = 7.4 → 8 spaces → 9;  19.5 ÷ 4 = 4.9 → 5 spaces → 6;  9 × 6 = 54
    expect(g.chairs).toBe(54);
  });

  test('two layers double everything', () => {
    const g = slabGrid({ ...base, layers: 2 });
    expect(g.laps).toBe(28);
    expect(g.totalFt).toBeCloseTo(1691.6667, 3);
    expect(g.sticks).toBe(98);
    expect(g.minSticks).toBe(85);
    expect(g.chairs).toBe(108);
  });

  test('no chairs when chair spacing is 0', () => {
    expect(slabGrid({ ...base, chairSpacingFt: 0 }).chairs).toBe(0);
  });

  test('40 ft stock: no laps, leftovers too short to reuse', () => {
    const g = slabGrid({ ...base, stockFt: 40 });
    expect(g.laps).toBe(0);
    expect(g.totalFt).toBeCloseTo(14 * 29.5 + 21 * 19.5, 9); // 822.5
    // 14 × 29.5' (one per bar, 10.5' scraps) + 21 × 19.5' (two per bar → 11 bars)
    expect(g.sticks).toBe(25);
    expect(g.minSticks).toBe(21);
  });
});

describe('beamBars', () => {
  test('100 ft perimeter footing, 4 #5 bars, 20 ft stock, 25" laps, 4 corners', () => {
    const lap = 25 / 12;
    const r = beamBars(100, 4, getBar(5), 20, lap, 4);
    // (100 − 2.083) ÷ (20 − 2.083) = 5.47 → 6 bars per line, 5 laps → 110.42 ft per line
    expect(r.run.pieces).toBe(6);
    expect(r.laps).toBe(20);
    expect(r.continuousFt).toBeCloseTo(4 * (100 + 5 * lap), 9); // 441.67
    // 4 corners × 4 bars = 16 corner bars, each 2 × 25" = 50" (4.17 ft) → 66.67 ft
    expect(r.cornerBars).toBe(16);
    expect(r.cornerBarFt).toBeCloseTo(50 / 12, 9);
    expect(r.cornerFt).toBeCloseTo(66.6667, 3);
    expect(r.totalFt).toBeCloseTo(508.3333, 3);
    // 20 full sticks; the four 10.42' end pieces take 4 sticks (9.58' scraps hold 2 corner bars each = 8);
    // the other 8 corner bars come 4 to a stick → 2 more.  20 + 4 + 2 = 26
    expect(r.sticks).toBe(26);
    expect(r.minSticks).toBe(26); // 508.33 ÷ 20 = 25.4
    expect(r.lb).toBeCloseTo(508.3333 * 1.043, 3); // 530.2 lb
  });

  test('run shorter than a stock bar', () => {
    const r = beamBars(15, 4, getBar(5), 20, 25 / 12, 0);
    expect(r.laps).toBe(0);
    expect(r.continuousFt).toBe(60);
    expect(r.cornerFt).toBe(0);
    expect(r.sticks).toBe(4); // a 15' piece per stick
    expect(r.minSticks).toBe(3);
  });
});

describe('piecesToCover', () => {
  test('rounds up, but not on an exact fit', () => {
    expect(piecesToCover(1200, 42.75)).toBe(29); // 28.07
    expect(piecesToCover(1950, 1950)).toBe(1);
    expect(piecesToCover(0, 10)).toBe(0);
    expect(() => piecesToCover(100, 0)).toThrow();
  });
});
