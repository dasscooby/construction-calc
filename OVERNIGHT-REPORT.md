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

Reply "ship it" to send to your phone, or "scrap it" to throw it away.
