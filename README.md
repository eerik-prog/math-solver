# Math Solver

A fast web app that solves math problems and explains every step. Type a problem the way you would write it (`x^2 - 5x + 6 = 0`, `derivative of x^2 sin x`, `integrate x e^x dx`) and get exact answers, a step-by-step explanation and an interactive graph.

Everything runs in the browser: there is no server, no account and no network request after the page loads.

## What it solves

| Area                                                      | Examples                                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Arithmetic (exact fractions, big integers)                | `(3/4 + 5/6) * 12 - 2^3`, `2^100`, `20!`, `gcd(84, 36)`, `15% * 80`                                                            |
| Simplify / expand / factor                                | `simplify (x^2 - 9)/(x - 3)`, `expand (2x - 3)^3`, `factor x^4 - 16`, `factor 360`                                             |
| Linear, quadratic and polynomial equations                | `3(x - 2) = 2x + 5`, `2x^2 + 3x - 1 = 0`, `x^3 - 6x^2 + 11x - 6 = 0`                                                           |
| Rational, radical, exponential, log, trig, absolute value | `1/x + 1/(x+1) = 1`, `sqrt(x + 3) = x - 3`, `e^(2x) - 3e^x + 2 = 0`, `sin(x) = 1/2`, `\|2x - 1\| = 5`                          |
| Inequalities (incl. compound)                             | `3 - 2x > 7`, `(x - 1)/(x + 2) >= 0`, `1 < 2x + 3 <= 9`                                                                        |
| Systems                                                   | `x + y = 10, x - y = 4`, `2x + 3y - z = 1; x - y + 2z = 3; 3x + y + z = 6`, `x + y = 5 and xy = 6`                             |
| Derivatives                                               | `derivative of x^2 sin(x)`, `d/dx ln(x^2 + 1)`, `second derivative of e^(2x)`                                                  |
| Integrals                                                 | `integrate x e^x dx`, `integrate 1/(x^2 - 1) dx`, `integrate x^2 from 0 to 3`, `integrate e^(-x^2) from -infinity to infinity` |
| Limits                                                    | `limit of sin(x)/x as x -> 0`, `lim x->infinity (3x^2 + 1)/(2x^2 - 5)`, `limit of 1/x as x -> 0+`                              |

Answers are exact whenever possible (fractions, radicals, π, e, logarithms, complex roots) with a decimal approximation alongside. When no exact method applies, the solver says so and falls back to careful numerical methods.

## How it works

The math engine (`src/engine`) is written from scratch in TypeScript, with no runtime dependencies:

- **Parser** (`parser.ts`): forgiving input with implicit multiplication (`2x`, `x sin x`), `sin^2 x`, `log_2(8)`, `|x|`, `√`, `π`, `°`, `%`.
- **Exact arithmetic** (`rational.ts`): `bigint` rationals, so `0.1 + 0.2 = 3/10` and `2^100` are exact.
- **Simplifier** (`simplify.ts`): canonical form, like terms, radicals (`√72 = 6√2`), exact trig and log values.
- **Polynomials** (`poly.ts`): rational root theorem, factoring over ℚ, quadratic formula, Durand–Kerner for the rest.
- **Solvers**: equations (`solve.ts`), inequalities with sign charts (`inequality.ts`), systems by Gauss–Jordan elimination or substitution (`systems.ts`).
- **Calculus**: rule-based differentiation (`diff.ts`); integration by table, substitution, partial fractions and by parts (`integrate.ts`); limits by substitution, factoring and L'Hôpital (`limit.ts`).
- **Self-checking**: every solution is substituted back into the original equation (which removes extraneous roots), every antiderivative is differentiated back and compared with the integrand, and every definite integral and limit is cross-checked numerically. An answer that fails its check is never shown.

The UI (`src/App.tsx`, `src/components`) is React. The engine runs in a Web Worker with a timeout, so the page never freezes. KaTeX (math rendering) is loaded on demand to keep the first load small (about 77 kB of gzipped JavaScript). Problems solve as you type, the URL holds the current problem so it can be shared, and recent problems are kept in local storage.

## Development

Requires Node 22 (see `.nvmrc`).

```bash
npm install
npm run dev          # start the dev server
npm run check        # type check + lint + format check + unit tests
npm run coverage     # unit tests with coverage thresholds
npm run e2e          # Playwright end-to-end tests (desktop + mobile)
npm run build        # production build into dist/
npm run size         # enforce the bundle size budget
```

### Quality gates

- **Unit tests** (Vitest): solver behaviour, step explanations, and property tests that generate random polynomials and expressions and check the answers independently (finite differences, re-substitution, round-tripping through the printer). Coverage thresholds are enforced.
- **Component tests** (Testing Library + jsdom) for the main user flows.
- **End-to-end tests** (Playwright) in desktop and mobile viewports, including a check for horizontal overflow.
- **Type checking** with strict TypeScript, **linting** with oxlint (warnings fail the build), **formatting** with Prettier.
- **Bundle size budget** (`scripts/check-size.mjs`).

CI (`.github/workflows/ci.yml`) runs all of the above on every pull request and push to `main`. Dependabot keeps dependencies and actions up to date.

## Deploying

`npm run build` produces a static site in `dist/` that can be hosted anywhere (Netlify, Vercel, Cloudflare Pages, any static file server). Asset paths are relative, so it also works from a sub-path.

The GitHub Pages workflow (`.github/workflows/deploy.yml`) publishes the site on every push to `main`, and can also be run by hand from the Actions tab. Enable Pages once under **Settings → Pages → Source: GitHub Actions**. Pages for private repositories requires a paid GitHub plan.
