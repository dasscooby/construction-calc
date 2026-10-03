# Construction Calc

Free construction calculator for iPhone, built for foundation and slab work.
Works offline. No ads, no accounts, no tracking.

**Your live app:** https://construction-calc-7815.netlify.app
(open it in Safari on the iPhone → Share → Add to Home Screen; it works offline after that)

## What's in it

| Tab | Tools |
| --- | --- |
| **Calc** | Works like a Construction Master 5: feet-inch-fraction math, conversions, Pitch/Rise/Run/Diag, hip/valley and jack rafters (regular and irregular), rake walls, stairs, circles and arcs, board feet, weight, cost, memory, tape |
| **Concrete** | Slab · Slab + beams (poured together) · Footings & walls · Piers & columns (straight, belled, square) · Steps. All give yards with waste, the order, trucks and bags |
| **Rebar** | Slab rebar · Beam & footing bars · Stirrups & ties · Rebar cut list · Rebar weight & chart · Dowels & anchor bolts · Wire mesh. Spacing is on center; laps are in inches |
| **Site** | Slope & fall · Grade rod (laser): rod reading for grade, cut or fill · Excavation · Fill & base rock · Squaring · Decimal feet ↔ feet-inches · Vapor barrier |
| **Engineer** | Footing size from soil bearing · Cylinder breaks · PT elongation (±7%) · Form pressure |

Numbers typed into the tools are kept on the phone. The engineering tools are field checks, not designs;
the engineer's plans, the soils report and the shop drawings always govern.

## Publish an update to the live app

```
cd C:\Users\great\construction-calc
npm run build:web
npx netlify-cli deploy --prod --dir dist --no-build --site construction-calc-7815
```
The phone picks up the new version after you open the app once or twice with signal.

## Run it in Expo Go (optional, for previewing changes; needs your PC on)

The PC is signed in to Expo as **dasscooby**, and this project is linked to your Expo project "aaron".
1. In Expo Go on the iPhone, tap the account icon (top right) and sign in as **dasscooby**.
2. On the PC, in PowerShell: `cd C:\Users\great\construction-calc` then `npx expo start --tunnel`.
3. Scan the QR code with the iPhone Camera and tap "Open in Expo Go".
   (Tunnel mode is needed because this PC's network is set to Public, so Windows Firewall
   blocks Expo's normal Wi-Fi connection.)

## Checks

```
npm test            # math tests (most are worked examples from the Construction Master 5 manual)
npm run typecheck   # TypeScript check
```

## Calculator quick reference

- `12 Feet 6 Inch 3 / 4` enters 12' 6-3/4". A fraction alone is inches; `3 /` with no bottom number = 3/16".
- `130 Feet Feet` = 130 sq ft, `5 Yds Yds Yds` = 5 cu yd.
- **Conv** + a unit key converts (Conv Feet toggles feet-inches / decimal feet).
- Right triangles: enter any two of Pitch / Rise / Run / Diag, then press the one you want.
- Hip/V, Jack, R/Wall and Stair: press repeatedly to step through the answers.
- Second functions (printed above the keys) = Conv first. Tap **Guide** in the app for the full list.

## Open source

Free to use, copy and change under the MIT License (see `LICENSE`).

Build it yourself:
```
npm install
npm test             # math tests
npx expo start       # run it in Expo Go
npm run build:web    # offline web app in dist/
```

How it's organized:
- `src/lib/` – the math (calculator engine, concrete, rebar, site, engineering), all with tests in `src/lib/__tests__/`
- `src/tools/` – each tool's input boxes and results; `src/tools/index.ts` lists which tools go on which tab
- `src/screens/` – the screens
- `store/` – Google Play listing text, graphics and privacy policy

The calculator follows the key layout and behavior of popular feet-inch construction calculators.
It is an independent project and is not affiliated with any calculator maker.
