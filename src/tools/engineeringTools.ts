// Engineering checks: footing size from soil bearing, cylinder breaks, post-tension elongation,
// and form pressure. The math and code references live in src/lib/engineering.ts.

import {
  Binder,
  C39_RANGE_6X12_FIELD_PCT,
  CYLINDERS_PER_TEST,
  CYLINDER_DIAMETER_IN,
  CylinderSize,
  FormElement,
  IRC_MIN_FOOTING_THICKNESS_IN,
  IRC_MIN_FOOTING_WIDTH_IN,
  MAX_JACKING_STRESS_KSI,
  Placement,
  PressureCase,
  SHORT_TENDON_FT,
  average,
  chemistryCoefficient,
  cylinderPsi,
  formPressure,
  nearest10,
  netBearingPsf,
  padFootingSideFt,
  percentDiff,
  ptElongationIn,
  roundUpToInch,
  singleTestLimitPsi,
  soilPressurePsf,
  spreadPct,
  wallFootingWidthFt,
} from '../lib/engineering';
import { commas, dec, ftIn, inches, pct } from './format';
import { CHECK_IT } from './concreteShared';
import { ResultRow, Tool } from './types';

const psf = (n: number) => `${commas(n)} psf`;
const psi = (n: number) => `${commas(n)} psi`;
const CHECK_ONLY = 'A check only. The engineer’s plans win.';

// ---------------------------------------------------------------------------------------------

const footingSize: Tool = {
  id: 'footing-size',
  title: 'Footing Size',
  blurb: 'Footing width or pad size from load and soil',
  fields: [
    {
      key: 'type',
      label: 'Footing',
      kind: 'choice',
      options: [
        { value: 'wall', label: 'Wall footing' },
        { value: 'pad', label: 'Square pad' },
      ],
      default: 'wall',
    },
    { key: 'load', label: 'Load', kind: 'number', unit: 'lb', help: 'Wall footing: lb per foot of wall. Pad: total lb.' },
    { key: 'bearing', label: 'Soil bearing', kind: 'number', unit: 'psf', default: '1500', help: 'From the soils report. No report: clay 1,500, sand 2,000, gravel 3,000.' },
    { key: 'thick', label: 'Footing thickness', kind: 'length', optional: true, help: 'Takes off the footing’s own weight' },
  ],
  compute: (inp) => {
    const load = inp.num('load');
    const bearing = inp.num('bearing');
    const thickFt = inp.len('thick');
    if (load <= 0) return { error: 'The load must be more than 0.' };
    if (bearing <= 0) return { error: 'The soil bearing must be more than 0.' };
    const net = netBearingPsf(bearing, thickFt);
    if (net <= 0) return { error: 'The footing’s own weight uses up all the soil bearing. Check the numbers.' };

    const rows: ResultRow[] = [];
    const warnings: string[] = [];
    let sizeIn: number;
    if (inp.choice('type') === 'wall') {
      sizeIn = roundUpToInch(wallFootingWidthFt(load, net));
      rows.push(
        { label: 'Footing width', value: `${inches(sizeIn)} (${ftIn(sizeIn / 12)})`, big: true },
        { label: 'Soil pressure', value: psf(soilPressurePsf(load, sizeIn / 12, thickFt)), note: `Soil can take ${psf(bearing)}` },
      );
    } else {
      sizeIn = roundUpToInch(padFootingSideFt(load, net));
      rows.push(
        { label: 'Pad size', value: `${ftIn(sizeIn / 12)} square`, big: true },
        { label: 'Soil pressure', value: psf(soilPressurePsf(load, (sizeIn / 12) ** 2, thickFt)), note: `Soil can take ${psf(bearing)}` },
      );
    }
    if (sizeIn < IRC_MIN_FOOTING_WIDTH_IN) warnings.push(`Code minimum is ${IRC_MIN_FOOTING_WIDTH_IN}" wide.`);
    if (inp.has('thick') && thickFt * 12 < IRC_MIN_FOOTING_THICKNESS_IN - 1e-9) warnings.push(`Code minimum is ${IRC_MIN_FOOTING_THICKNESS_IN}" thick.`);
    return { rows, warnings };
  },
  notes: ['Rounded up to the next inch.', CHECK_ONLY],
};

// ---------------------------------------------------------------------------------------------

const cylinderBreak: Tool = {
  id: 'cylinder-break',
  title: 'Cylinder Breaks',
  blurb: 'Break load to psi, average, pass or fail',
  fields: [
    {
      key: 'size',
      label: 'Cylinder size',
      kind: 'choice',
      options: [
        { value: '4x8', label: '4" × 8"' },
        { value: '6x12', label: '6" × 12"' },
      ],
      default: '4x8',
    },
    { key: 'load1', label: 'Break load 1', kind: 'number', unit: 'lb' },
    { key: 'load2', label: 'Break load 2', kind: 'number', unit: 'lb', optional: true },
    { key: 'load3', label: 'Break load 3', kind: 'number', unit: 'lb', optional: true },
    { key: 'fc', label: 'Design strength', kind: 'number', unit: 'psi', default: '3000' },
  ],
  compute: (inp) => {
    const size = inp.choice('size') as CylinderSize;
    const d = CYLINDER_DIAMETER_IN[size];
    const fc = inp.num('fc');
    if (fc <= 0) return { error: 'Design strength must be more than 0.' };
    const loads = ['load1', 'load2', 'load3'].filter((k) => inp.has(k)).map((k) => inp.num(k));
    if (loads.some((l) => l <= 0)) return { error: 'Break loads must be more than 0.' };

    const strengths = loads.map((l) => cylinderPsi(l, d));
    const avg = average(strengths);
    const rows: ResultRow[] = strengths.map((s, i) => ({ label: `Cylinder ${i + 1}`, value: psi(nearest10(s)) }));
    const limit = singleTestLimitPsi(fc);
    const verdict =
      avg >= fc
        ? { value: 'Passes', note: undefined }
        : avg >= limit
          ? { value: 'A little low', note: `Within ${commas(fc - limit)} psi, so OK this once. 3 tests in a row must average at least ${psi(fc)}.` }
          : { value: 'Too low', note: `More than ${commas(fc - limit)} psi low. Tell the engineer.` };
    rows.push(
      { label: loads.length > 1 ? 'Average' : 'Strength', value: psi(nearest10(avg)), big: true, note: `${pct((avg / fc) * 100, 1)} of design` },
      { label: 'Result', value: verdict.value, big: true, note: verdict.note },
    );

    const warnings: string[] = [];
    // A 4×8 at 3,000 psi breaks near 38,000 lb. Under 1,000 is nearly always kips off the tester's screen.
    const small = loads.find((l) => l < 1000);
    if (small !== undefined) warnings.push(`A break load of ${dec(small)} lb is tiny. If the tester shows kips, ${dec(small)} kips = ${commas(small * 1000)} lb. ${CHECK_IT}`);
    const needed = CYLINDERS_PER_TEST[size];
    if (loads.length < needed) warnings.push(`A full test is ${needed} cylinders for ${size === '4x8' ? '4×8' : '6×12'}. You entered ${loads.length}.`);
    const range = C39_RANGE_6X12_FIELD_PCT[loads.length];
    if (size === '6x12' && range && spreadPct(strengths) > range) {
      warnings.push(`These cylinders are ${dec(spreadPct(strengths), 1)}% apart, more than normal. Check how they were made and cured.`);
    }
    if (avg > 15000) warnings.push('That’s far stronger than normal concrete. Check the break load.');
    return { rows, warnings };
  },
  notes: ['Passes when 3 tests in a row average at least design strength and no test is more than 500 psi low.'],
};

// ---------------------------------------------------------------------------------------------

const ptElongation: Tool = {
  id: 'pt-elongation',
  title: 'PT Elongation',
  blurb: 'Post-tension cable stretch: calculated vs measured',
  fields: [
    { key: 'length', label: 'Cable length', kind: 'length' },
    { key: 'force', label: 'Jack force', kind: 'number', unit: 'kips', default: '33', help: '33 for 1/2" strand' },
    { key: 'area', label: 'Strand area', kind: 'number', unit: 'sq in', default: '0.153', help: '0.153 for 1/2" strand' },
    { key: 'modulus', label: 'Strand E (stiffness)', kind: 'number', unit: 'ksi', default: '28500', help: 'From the mill cert (28,500 is typical)' },
    { key: 'required', label: 'Required elongation', kind: 'number', unit: 'in', optional: true, help: 'From the shop drawings' },
    { key: 'measured', label: 'Measured elongation', kind: 'number', unit: 'in', optional: true, help: 'Both ends added together' },
  ],
  compute: (inp) => {
    const lengthFt = inp.len('length');
    const force = inp.num('force');
    const area = inp.num('area');
    const e = inp.num('modulus');
    if (lengthFt <= 0 || force <= 0 || area <= 0 || e <= 0) return { error: 'Length, force, area and E must all be more than 0.' };

    const calc = ptElongationIn(force, lengthFt, area, e);
    const hasRequired = inp.has('required');
    const target = hasRequired ? inp.num('required') : calc;
    if (target <= 0) return { error: 'The required elongation must be more than 0.' };

    const rows: ResultRow[] = [{ label: 'Calculated elongation', value: inches(calc), big: !hasRequired }];
    if (hasRequired) rows.push({ label: 'Required elongation', value: inches(target), big: true });
    rows.push({ label: 'OK range (±7%)', value: `${inches(target * 0.93)} to ${inches(target * 1.07)}` });

    if (inp.has('measured')) {
      const diff = percentDiff(inp.num('measured'), target);
      const ok = Math.abs(diff) <= 7 + 1e-9;
      rows.push(
        { label: 'Measured is', value: `${diff >= 0 ? '+' : '−'}${dec(Math.abs(diff), 1)}%`, note: diff >= 0 ? 'Long' : 'Short' },
        { label: 'Result', value: ok ? 'OK' : 'Out of range', big: true, note: ok ? undefined : 'Find out why before cutting tails. Tell the engineer.' },
      );
    }

    const warnings: string[] = [];
    if (force / area > MAX_JACKING_STRESS_KSI + 1e-6) warnings.push('That force is over the strand limit (33 kips on 1/2" strand).');
    if (lengthFt < SHORT_TENDON_FT) warnings.push(`Short cable (under ${SHORT_TENDON_FT} ft): wedge seating throws the numbers off, so ±7% is hard to hit.`);
    return { rows, warnings };
  },
  notes: ['Use the shop drawing number when you have it. This simple math leaves out friction.', 'Some specs allow ±10%. Follow your engineer.'],
};

// ---------------------------------------------------------------------------------------------

const GOVERNS: Record<PressureCase, string> = {
  eqB: 'ACI formula',
  eqC: 'ACI formula for tall or fast pours',
  minimum: '600 psf minimum',
  liquidCap: 'Full liquid (the formula came out higher)',
  liquidMix: 'Full liquid (SCC, high slump or deep vibrating)',
  liquidRate: 'Full liquid (poured faster than 15 ft/hr)',
  pumped: 'Full liquid + 25% for pumping from the bottom',
};

const formPressureTool: Tool = {
  id: 'form-pressure',
  title: 'Form Pressure',
  blurb: 'How hard fresh concrete pushes on wall or column forms',
  fields: [
    {
      key: 'element',
      label: 'Form',
      kind: 'choice',
      options: [
        { value: 'wall', label: 'Wall' },
        { value: 'column', label: 'Column' },
      ],
      default: 'wall',
    },
    { key: 'height', label: 'Pour height', kind: 'length' },
    { key: 'rate', label: 'Pour rate', kind: 'number', unit: 'ft/hr', help: 'How fast the concrete rises in the form' },
    { key: 'temp', label: 'Concrete temp', kind: 'number', unit: '°F', default: '70' },
    { key: 'weight', label: 'Concrete weight', kind: 'number', unit: 'pcf', default: '150' },
    {
      key: 'cement',
      label: 'Cement',
      kind: 'choice',
      options: [
        { value: 'plain', label: 'Type I, II or III' },
        { value: 'blend', label: 'Other or blended' },
        { value: 'highScm', label: 'Lots of fly ash or slag' },
      ],
      default: 'plain',
    },
    {
      key: 'retarder',
      label: 'Retarder in the mix?',
      kind: 'choice',
      options: [
        { value: 'no', label: 'No' },
        { value: 'yes', label: 'Yes' },
      ],
      default: 'no',
    },
    {
      key: 'placement',
      label: 'Pour',
      kind: 'choice',
      options: [
        { value: 'normal', label: 'Normal' },
        { value: 'liquid', label: 'SCC or high slump' },
        { value: 'pumped', label: 'Pumped from the bottom' },
      ],
      default: 'normal',
    },
  ],
  compute: (inp) => {
    const heightFt = inp.len('height');
    const rate = inp.num('rate');
    const temp = inp.num('temp');
    const w = inp.num('weight');
    if (heightFt <= 0) return { error: 'Pour height must be more than 0.' };
    if (rate <= 0) return { error: 'Pour rate must be more than 0.' };
    if (temp <= 32) return { error: 'Concrete temp must be above freezing.' };
    if (w <= 0) return { error: 'Concrete weight must be more than 0.' };

    const cc = chemistryCoefficient(inp.choice('cement') as Binder, inp.choice('retarder') === 'yes');
    const r = formPressure({
      element: inp.choice('element') as FormElement,
      heightFt,
      rateFtPerHr: rate,
      tempF: temp,
      unitWeightPcf: w,
      cc,
      placement: inp.choice('placement') as Placement,
    });
    return {
      rows: [
        { label: 'Form pressure', value: psf(r.pressurePsf), big: true, note: GOVERNS[r.governs] },
        { label: 'Full liquid', value: psf(r.hydrostaticPsf) },
        { label: 'Max pressure starts at', value: ftIn(r.depthToMaxFt), note: 'Below the top of the concrete' },
      ],
    };
  },
  notes: ['Planning number only. Forms and ties must be designed by someone qualified.'],
};

export const ENGINEERING_TOOLS: Tool[] = [footingSize, cylinderBreak, ptElongation, formPressureTool];
