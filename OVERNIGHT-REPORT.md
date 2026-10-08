# Overnight report

Branch: `overnight-2026-10-06` (not main, nothing sent to your phone or the stores).

## Night of 2026-10-06

### What got better
- Typing 0 for a size or count no longer gives a 0-yard answer. Slab/Fill/Mesh/Poly areas, Piers, Steps, straight-run Footings, Excavation and Fill & Base Rock now say what to fix ("Area 2: length and width must be more than 0", "How many must be at least 1").
- Letters or a minus sign in a box: instead of "Check Length" it says "Length: type a number, like 12 or 6 1/2" or "Length can't be less than 0".
- Inches typed in the feet box get caught: a 4 ft slab, a 20 ft wide footing, a 12 ft pier, a 7 ft rise, an 18 ft deep trench or 4 ft of rock shows a yellow "Thickness is 4 feet. Did you mean 4 inches?". It also flags a slab side over 400 ft. The number is left as you typed it; this is only a heads-up.
- That yellow typo note also shows right above the answer at the bottom, so you see it while typing.
- Fill & Base Rock says how much extra for compaction is in the order, and what tons-per-yard the tons use.
- Plain words: Stirrups "Clear" is now "Cover" (1-1/2" is common). The Footings & Walls height and thickness boxes say what each means for a wall and a footing, with a normal size.
- Phone: the Remove buttons and the filler ✕ are easier to hit, with the same look. The bigger touch area never reaches over a box you type in.
- Phone: tab names shrink a little instead of being cut off ("Concr…", "Engin…") on narrow phones, mostly Android. Not yet seen on a real phone.
- New tests with real job sizes, worked out by hand: a 120 ft footing trench, 4 pier holes, 6" rock under a garage and apron, and 4 front steps with and without a landing.

### Tests
- Before: 421 passing (29 suites). After: 438 passing. Typecheck clean.
- Tonight's main had moved on (round steps, layout rebar, etc.), so I merged it in. With main's new tests: 476 passing (main alone has 459).

### Math I think might be off (nothing changed)
1. **Fill & Base Rock tons may come out low for crushed rock.** It does compacted yards × (1 + 20%) × 1.4 tons per yard. That works out to 1.68 tons per compacted yard, about 124 lb per cu ft. Compacted crushed base usually runs about 135–145 lb per cu ft (1.8–2.0 tons per compacted yard).
   Worked example: 40 × 30 at 4" = 400 cu ft compacted. The app says **24.9 tons**. At 140 lb per cu ft it's 400 × 140 = 56,000 lb = **28 tons**, about 3 tons more. Fix by raising "Extra for compaction" to about 35%, or by asking your supplier for tons per compacted yard. Your call; I didn't change the defaults.
2. **Forms & Stakes counts 2 stakes at each corner.** Each side gets a stake at both of its ends, so every corner gets two.
   Worked example: 20 × 20 slab, stakes every 4 ft: each side is 20 ÷ 4 = 5 spaces → 6 stakes, × 4 sides = **24**. With one shared stake per corner it would be **20**. Many crews do stake both boards at a corner, so this may be what you want. Tell me which.
3. **Footing depth assumed 10".** In the foundation layout, when there's no footing item to copy from, the footing is taken as 16" wide × 10" deep. Please confirm 10" is right for your area (frost depth and the engineer's plans win). I didn't touch it; the layout screens were off limits.

### Left alone on purpose
- Wall Forms (aluminum) and add-on walls / second-pour slabs, as asked.
- The new foundation layout screens and their drawings.

### Ideas for you
- Android number boxes open the full keyboard, so fractions like 6 1/2 can be typed. A number keypad would be nicer, but Android's keypad has no "/" or space. Worth a look if your crew types fractions on Android.
- The "Cubic yards" answer shows "1.36" with the unit only in the label. Adding "cu yd" after the number would mean touching the layout reports' tests, so I left it.
- On the web/home-screen version the tab names still get cut off at "Concr…" (the shrink-to-fit only works in the phone app).

## Night of 2026-10-07

Same branch, built on last night's work. Today's main (round steps, layout rebar, bids and more) is merged in. I didn't touch the layout screens.

### What got better
- More "did you mean…?" checks, all shown in yellow by the answer with the number left as typed:
  - Slope & Fall: 2 typed with "inches per foot" picked (very steep) asks if you meant 2% and to pick "percent".
  - Grade Rod: a rod reading over 25 ft (462 for 4.62) asks if you missed a decimal point.
  - Forms & Stakes: a 4 ft form height (meant 4"), or stakes every 40 ft.
  - Every concrete tool: waste over 30% (100 for 10), or a truck over 15 yd (100 for 10).
  - Round steps: a main diameter over 30 ft.
  - Cylinder Breaks: a break load under 1,000 lb ("If the tester shows kips, 37.7 kips = 37,700 lb") before you call a pour failed.
  - Footing Size: soil bearing under 500 psf (15 for 1,500).
  - Excavation: swell over 60% (250 for 25).
- Rebar Weight: 0 bars or a 0 ft length says what to fix instead of showing 0 lb.
- Form Pressure: a freezing temperature now says "Type it in °F" (21 °C reads as below freezing).
- Plain words: "Mats" is now "Mats (layers of bars)" and "Strand E" is now "Strand E (stiffness)". Beam & Footing Bars says "all the way around the footing" instead of "perimeter".
- Steps: the zero checks now work with the new round steps too.
- New tests for the unit conversions every tool uses (feet, yards, metric, square and cubic sizes, rounding, fractions).

### Tests
- Before tonight: 476 on this branch (main alone: 459). After: 492 passing (35 suites). Typecheck clean.

### Math I think might be off (nothing changed)
- Nothing new tonight. Last night's three items (Fill & Base Rock tons, 2 stakes per corner, 10" layout footing depth) still need your answer.

### Ideas for you
- The same "did you mean inches?" check could go on Wall Forms (panel height typed in feet) and the add-on / second-slab boxes. Those were off limits, so I didn't touch them.
- Rebar Cut List can't tell an 18" dowel typed as 18 ft from a real 18 ft bar. A "Did you mean 18 inches?" for short-bar marks would need you to say what's normal.

## Night of 2026-10-08

Same branch. Main hadn't changed since last night, so there was nothing to merge.

### What got better
- Bars on center under 4" now get a yellow "On center is in inches (18, not 1.5)". This covers Slab Rebar, Slab, and wall verticals in Footings & Walls. The bars are left as typed.
- Stirrups: a beam width or depth of 4 or less (feet typed in an inches box) adds "Beam width and depth are in inches (12, not 1)" to the no-room message.
- Answers that now say what they mean:
  - Form Pressure "Full liquid": the most it could push, with the whole pour still soft.
  - Rebar Weight "Common laps": 40, 48 and 60 times the bar size; your plans say which.
- New tests on everyday jobs, checked by hand:
  - nine 10" deck sonotubes 4 ft deep, with the 80, 60 and 40 lb bag counts (36 / 48 / 72)
  - a 24 × 24 garage poured mono with a 12" × 18" edge: 11.09 yd before waste, order 12.25 yd, 2 trucks
  - that garage edge's rebar: 2 #4 with corner L-bars, 12 sticks, 157 lb
- Checked at small-phone width (iPhone SE): Jobs, Preferences, Form Pressure, Rebar Cut List and Grade Rod screens. Nothing was cut off, so nothing needed changing.

### Tests
- Before tonight: 492 passing. After: 498 passing (35 suites). Typecheck clean.

### Stopped early
8 commits. The safe, worthwhile fixes are running out. What's left either needs your answer (below) or is in parts I was told to leave alone (Wall Forms, add-on walls / second slabs, the layout).

### Still waiting on you (nothing changed)
1. **Rock tons / compaction:** 40 × 30 at 4" shows 24.9 tons; at a usual compacted weight it's about 28 tons. Raise "Extra for compaction" to about 35%?
2. **Stake corners:** a 20 × 20 slab gets 24 stakes (2 per corner) instead of 20. Which do you want?
3. **10" footing:** the layout assumes a 10" deep footing when there's nothing to copy it from. Right for your area?

Reply "ship it" to send to your phone, or "scrap it" to throw it away.
